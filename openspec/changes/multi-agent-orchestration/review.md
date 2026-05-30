# Architecture Review Report — Adaptive Multi-Agent Orchestration

**Review date**: 2026-05-30
**Review scope**: Full change review (proposal + design + tasks)
**Review version**: Proposal v1 → v2 (all findings addressed)
**Reviewer**: architect
**Status**: All P0 and P1 findings resolved in v2. Proposal approved for implementation.

---

## I. Executive Summary

### Architecture Health Score

| Dimension | Score | Status |
|-----------|-------|--------|
| Layered Architecture & Separation of Concerns | A | OK |
| Module Boundaries & Cohesion | B | OK |
| Dependency Governance | B | Warning |
| Data Flow & State Management | B | Warning |
| API Design & Contracts | C | Warning |
| Error Handling & Resilience | C | Warning |
| Testability | B | OK |
| Security Architecture | D | Critical |
| Evolvability & Technical Debt | A | OK |
| **Overall Rating** | **B** | |

### Key Findings

1. [P0] **WorkflowEngine condition evaluation — code injection risk** — Condition strings evaluated as JS code without sandboxing (`design.md:245`)
2. [P0] **Router integration point misidentified** — Design targets `ExpertHandler.ts`, actual WebSocket dispatcher is `WSRouter.ts` (`design.md:78`)
3. [P1] **Phase dependency conflict** — Phase 4 (DAG) references mailbox (`tasks.md:48`), Phase 5 removes it
4. [P1] **T0 latency claims assume Lead is already running** — If Lead needs fresh spawn, T0 latency is ~10-15s, not ~2-5s (`design.md:147`)
5. [P1] **Frontend impact completely unaddressed** — No interface contracts for T1/T0/Handoff UI changes
6. [P1] **Handoff HTTP endpoint lacks WebSocket connection mapping** — HTTP POST can't map back to connectionId for new Expert spawn (`design.md:388-398`)
7. [P1] **Multilingual classification gap** — Router regex/keyword approach doesn't address Chinese input
8. [P2] **Max chain depth of 2 unjustified** — No concrete A→B→C scenario presented; depth 1 may suffice
9. [P3] **Minor data inaccuracies** — Message type count is 15 not 16; MailboxManager refs are 7 not 9

### Architecture Strengths (Worth Keeping)

1. **Three-tier routing model is data-driven** — 216-session audit provides solid evidence for the 15%/35%/40%/10% complexity distribution. This isn't speculation.
2. **Conservative by design** — T2 (current model) remains the default, new tiers are opt-in with confidence thresholds. The "always fall back to Lead" principle means misclassification is a performance issue, not a correctness issue.
3. **Mailbox deprecation is thoroughly justified** — The analysis of `ExpertExitHandler.ts:207-232` is verified: summary IS the last 300 chars, artifacts/modifiedFiles ARE always empty. All four replacement channels already exist.
4. **Communication architecture simplification** — Reducing from 5 channels (Whiteboard + Mailbox + SSE + Plan.md + Hooks) to 4 with clear single-responsibility boundaries improves cognitive load.
5. **Handoff fills a real architectural gap** — Agents currently have no way to self-correct routing mistakes. This is the most impactful primitive in the proposal.
6. **Phased rollout is well-sequenced** — Handoff first (safety net) → T1 (depends on safety net) → T0 (least risk) → DAG (most complex). Dependencies are correct.

---

## II. Detailed Findings

### Security Architecture

#### Finding-1: WorkflowEngine Condition Evaluation — Code Injection Risk

- **Severity**: [P0]
- **Location**: `design.md:229-249` (WorkflowTask.condition field)
- **Current state**: The design defines `condition?: string` with examples like:
  ```
  "condition": "t2.result.status !== 'completed' || t2.result.followUp?.length > 0"
  ```
  This implies the condition string is evaluated as JavaScript (via `eval()`, `new Function()`, or equivalent). The Lead LLM generates these condition strings.
- **Problem**: An LLM generating executable code that the server evaluates is a classic code injection vector. Even without adversarial intent, hallucinated conditions could:
  - Access `process.env` (exposing secrets)
  - Call `require()` or `import()` (arbitrary module loading)
  - Access `fs` (file system manipulation)
  - Infinite loop (DoS)
- **Impact**: Remote code execution on the server via crafted condition strings. Even in a trusted-LLM scenario, hallucination can produce dangerous expressions.
- **Recommendation**: Replace free-form JS conditions with a structured condition DSL:
  ```typescript
  interface TaskCondition {
    operator: 'eq' | 'neq' | 'and' | 'or' | 'has_followup'
    field: string        // restricted to "status", "followUp", "summary"
    value?: string
    children?: TaskCondition[]  // for and/or
  }
  ```
  Alternatively, use a sandboxed expression evaluator (e.g., `expr-eval` library) with a strict allowlist of accessible variables.
- **Change estimate**: 1 file (WorkflowEngine.ts), low complexity

---

### Module Boundaries & Integration Points

#### Finding-2: Router Integration Point Misidentified

- **Severity**: [P0]
- **Location**: `design.md:78` — "The router sits in the WebSocket message handler (`server/ws/ExpertHandler.ts`)"
- **Current state**: The actual WebSocket message dispatcher is `server/ws/WSRouter.ts`:
  ```typescript
  // WSRouter.ts:58
  if (type === 'expert:start') {
    this.expertHandler.handleStart(ws, payload, connectionId)
    return
  }
  ```
  `ExpertHandler.ts` is not the WebSocket handler — it's the Expert session manager that `WSRouter` delegates to.
- **Problem**: Placing the Router inside `ExpertHandler` means it runs AFTER WebSocket dispatch, which is functionally correct but architecturally misleading. The Router is a routing concern, and `WSRouter` is the existing routing layer. Putting routing logic in `ExpertHandler` (a lifecycle manager) violates separation of concerns.
- **Impact**: Future developers will look for routing logic in `WSRouter` (where it belongs) and miss the `ExecutionModeRouter` buried inside `ExpertHandler`.
- **Recommendation**: Two options:
  1. **Preferred**: Integrate `ExecutionModeRouter` into `WSRouter.ts` at line 58, before delegating to `ExpertHandler`. WSRouter already makes routing decisions — this is its job.
  2. **Alternative**: Add the Router to `ExpertHandler.handleStart()` as the first step, with a clear comment that this is a pre-dispatch routing layer. Acceptable but less clean.
- **Change estimate**: 1-2 files, low complexity

#### Finding-3: Handoff HTTP Endpoint Missing connectionId Mapping

- **Severity**: [P1]
- **Location**: `design.md:388-398` (handoff.sh → HTTP POST flow)
- **Current state**: The current Expert spawn flow in `ExpertLifecycle.handleStart()` requires:
  - `ws: WebSocket` — the connection to send status events back
  - `connectionId: string` — identifies which frontend tab to update
  - These are provided by `WSRouter` from the WebSocket message context
- **Problem**: The Handoff HTTP endpoint (`POST /api/expert/handoff`) receives a request from `curl` inside an Agent's CLI process. This HTTP request has:
  - `from`, `to`, `chatId`, `task`, `context` — all good
  - NO `connectionId` — the Agent doesn't know which frontend tab it belongs to
  - NO `WebSocket` reference — HTTP ≠ WebSocket
- **Impact**: The server can't call `ExpertLifecycle.handleStart()` for the target Agent without a WebSocket connection and connectionId. The spawned Expert won't have SSE event routing back to the frontend.
- **Recommendation**: The Handoff endpoint must:
  1. Look up the source Agent's `connectionId` from `ExpertSessionStore` using `chatId + from`
  2. Retrieve the WebSocket via `ExpertHandler.getConnectionWs(connectionId)`
  3. Spawn the target Expert under the SAME connectionId
  4. Add this resolution logic to the design as a concrete implementation step
- **Change estimate**: 2 files (endpoint + ExpertSessionStore lookup), medium complexity

---

### Data Flow & State Management

#### Finding-4: Phase Dependency Conflict — DAG References Mailbox After Deprecation Plan

- **Severity**: [P1]
- **Location**: `tasks.md:48` — "Integrate with existing SSE stream + mailbox for task completion detection"
- **Current state**: Phase 4 (Workflow DAG) task explicitly depends on mailbox for task completion detection. Phase 5 (Mailbox Deprecation) removes the mailbox.
- **Problem**: If implemented in sequence, Phase 4 builds on mailbox, then Phase 5 immediately rips it out. This is wasted work and creates a design inconsistency.
- **Impact**: Either Phase 4 ships with a dependency that's immediately deprecated, or Phase 4 must be rewritten after Phase 5.
- **Recommendation**: Reorder: move Mailbox Deprecation to Phase 3 or 4 (before DAG Engine). The DAG Engine should be designed against the post-deprecation communication model (SSE + Whiteboard). Update `tasks.md:48` to: "Integrate with SSE event stream + Whiteboard artifact entries for task completion detection."
- **Change estimate**: tasks.md rewrite only

#### Finding-5: T0 Latency Claims Depend on Lead Already Running

- **Severity**: [P1]
- **Location**: `design.md:147` — "~2-5s (no new spawn)" and `design.md:100` — "No Expert dispatch, no subprocess spawn"
- **Current state**: Lead is spawned via `ExpertLifecycle.handleStart()` just like any Expert — it's a CLI subprocess that is created per `expert:start` message. There is NO persistent Lead process. When a chat is idle and the user sends a new message, Lead must be spawned fresh.
- **Problem**: The cost table says T0 spawns "0 additional" processes and achieves "~2-5s" latency. This is only true if Lead is already running from a previous turn in the same chat session. For cold starts (new chat, or chat after Lead process exited), T0 still requires Lead subprocess spawn (~10-15s).
- **Impact**: The claimed 10x latency improvement (25s → 2-5s) is only achievable for warm chats. For cold chats, the improvement is more like 25s → 15s (still meaningful but overstated).
- **Recommendation**: Add a clarification to the cost table:
  - T0 warm (Lead already running): ~2-5s
  - T0 cold (Lead needs spawn): ~10-15s
  - Consider a future optimization: persistent Lead process per chat (keep-alive)
- **Change estimate**: Documentation only

---

### API Design & Contracts

#### Finding-6: Frontend Impact Completely Unaddressed

- **Severity**: [P1]
- **Location**: Entire design.md — no frontend changes described
- **Current state**: The frontend (`web/`) drives agent spawning via:
  - `expert:start` WebSocket message with `agentId` (currently always 'lead' for user messages)
  - Expert list rendering based on `expert:list-updated` events
  - Chat message display based on JSONL parsing per expert session
- **Problem**: T1 and Handoff fundamentally change what the frontend sees:
  - **T1**: An Expert starts without Lead. The frontend shows Expert running but no Lead session. Chat history needs to display T1 messages correctly.
  - **Handoff**: Agent A exits and Agent B starts mid-task. The frontend needs to show the transition, not display it as "Agent A failed + Agent B started independently."
  - **T0**: Lead answers directly. The frontend may need to distinguish "Lead answering" from "Lead coordinating" for UI clarity.
  - **DAG**: Workflow visualization (acknowledged in Phase 6 tasks, but no interface contract).
- **Impact**: Without frontend contracts, the server-side changes will work but the user experience will be confusing — agents appearing/disappearing without context.
- **Recommendation**: Add a "§11. Frontend Interface Contracts" section to design.md:
  1. New WebSocket event: `expert:handoff` (source agentId, target agentId, reason)
  2. New field in `expert:started`: `executionMode: 't0' | 't1' | 't2'` + `handoffFrom?: string`
  3. Specify which existing events are reused vs modified for each tier
- **Change estimate**: Design document addition; implementation is Phase 2-3 work

#### Finding-7: Multilingual Classification Gap

- **Severity**: [P1]
- **Location**: `design.md:39-40` — T1 match rules reference "conjunction (AND/和/同时/另外)" and "dependency language (然后/之后/完成后/then/after)"
- **Current state**: The match rules include a few Chinese keywords but the Router design is primarily regex + English keyword matching. The dispatch tree is extracted from Lead's SOUL.md which is written in English.
- **Problem**: If the primary user base communicates in Chinese (as the project context suggests), the Router's keyword classifier needs comprehensive Chinese keyword support:
  - Agent matching: "修复CSS" → ui-designer, "写个接口" → fullstack-engineer
  - Conjunction detection: "并且/同时/以及/还要" 
  - Dependency detection: "先...再/做完后/等...好了"
  - Negation/question detection: "为什么/什么是/怎么回事"
- **Impact**: Router may fail to classify Chinese input correctly, causing all Chinese messages to fall through to Lead (degrading T1 to T2 for Chinese users).
- **Recommendation**: The dispatch keyword table (`dispatchRules.ts`) should be bilingual from day one. Add a concrete task to Phase 2: "Build bilingual (EN/ZH) keyword classification table with test cases for both languages."
- **Change estimate**: 1 file (dispatchRules.ts), medium complexity

---

### Error Handling & Resilience

#### Finding-8: Handoff Failure Modes Not Specified

- **Severity**: [P1]
- **Location**: `design.md:363-373` (Handoff Execution Flow)
- **Current state**: The handoff flow is described as a happy path:
  1. Agent A calls handoff.sh
  2. Server spawns Agent B
  3. Agent A exits
- **Problem**: Several failure modes are unaddressed:
  - **Target Agent spawn fails**: Agent A has already summarized and exited. The task is now orphaned.
  - **Target Agent rejects/ignores the handoff context**: Agent B starts but doesn't continue where A left off.
  - **Network failure between curl and server**: handoff.sh returns error, Agent A is in an undefined state.
  - **Concurrent handoff**: Two agents try to handoff to the same target simultaneously.
- **Impact**: In failure cases, user's task is silently lost or duplicated.
- **Recommendation**: Add failure handling to the handoff protocol:
  1. Agent A should NOT exit until it receives handoff confirmation from the server
  2. Server should return handoff status (success/failure) synchronously in the HTTP response
  3. If spawn fails, Agent A receives failure and continues working (or reports to user)
  4. Add a `handoff:failed` whiteboard entry type for audit trail
- **Change estimate**: 2 files (handoff.sh + endpoint), medium complexity

---

### Evolvability

#### Finding-9: Max Handoff Chain Depth of 2 — Unjustified

- **Severity**: [P2]
- **Location**: `design.md:469` — "Max chain depth: 2 (A → B → C is allowed)"
- **Current state**: The design allows a handoff chain of up to 2 hops.
- **Problem**: No concrete scenario is presented where A → B → C is necessary:
  - The primary use case is Router misclassification correction: A → B (1 hop)
  - A 2-hop chain (A → B → C) implies two consecutive misclassifications — at that point, the task should probably be re-analyzed by Lead rather than continuing to hand off blindly
- **Impact**: A depth of 2 doubles the complexity of chain tracking without a clear benefit. It also increases the risk of context degradation (each handoff loses some context fidelity).
- **Recommendation**: Start with max depth 1. If real usage shows a need for depth 2, it's a trivial config change. Starting restrictive and relaxing is safer than starting permissive and tightening.
- **Change estimate**: Config change only

#### Finding-10: AgentMessage Type Count and File Reference Inaccuracies

- **Severity**: [P3]
- **Location**: `analysis.md:43`, `design.md:525`
- **Current state**: 
  - The proposal claims "16 message types." Actual count in `shared/agent-message-types.ts` is **15** (task:assign, task:accepted, task:progress, task:milestone, task:blocked, task:input_required, task:idle, task:rejected, task:completed, task:failed, task:delegated, query, response, handoff, artifact).
  - The tasks file claims "9 files reference [MailboxManager]." Actual count is **7** (excluding MailboxManager.ts itself): ExpertExitHandler, ExpertActivityHandler, ExpertEventWiring, ExpertLifecycle, ExpertHandler, index.ts, expertRoutes.ts.
- **Problem**: Minor inaccuracies that suggest the analysis was done partially from memory rather than exhaustive code scanning.
- **Impact**: Low — doesn't affect design correctness. But undermines confidence in other quantitative claims.
- **Recommendation**: Correct the numbers in the documents. For future proposals, use `grep -r` counts rather than manual enumeration.
- **Change estimate**: Documentation fixes only

---

## III. Scenario Analysis

### Scenario 1: Router Misclassification (T1 → should have been T2)

- **Trigger condition**: User sends "fix the login bug and update the documentation" — Router matches "fix" to fullstack-engineer and classifies as T1 (single expert)
- **Data flow path**: User → Router (T1, fullstack-engineer) → Expert spawns → Expert handles only "fix login bug" → Documentation task dropped
- **Issues discovered**: The conjunction detection (`AND/和/同时`) is the ONLY defense against this misclassification. If the conjunction appears in a subordinate clause ("fix the login bug, and let me know what changed"), it's ambiguous.
- **Recommendation**: Add a "task count" heuristic: if the input contains more than one action verb (fix + update, implement + test, etc.), route to Lead. This provides defense in depth beyond conjunction detection.

### Scenario 2: Handoff During T1 Execution

- **Trigger condition**: Router sends CSS task to fullstack-engineer (T1), but the engineer discovers it needs design system changes → handoff to ui-designer
- **Data flow path**: Router → fullstack-engineer → handoff.sh → HTTP POST → Server spawns ui-designer with context → fullstack-engineer exits
- **Issues discovered**: The `connectionId` resolution (Finding-3) is critical here. Also: ui-designer starts with HandoffContext, but has no access to fullstack-engineer's terminal history or partial file edits. If fullstack-engineer made uncommitted changes, ui-designer might not see them.
- **Recommendation**: HandoffContext should include a `git stash` reference or explicit list of uncommitted file changes, not just "relevantFiles."

### Scenario 3: Cold Chat T0 Response

- **Trigger condition**: User opens a chat that's been idle for 1 hour, asks "what's the project structure?"
- **Data flow path**: User → Router (not T1) → Lead spawn (cold start, ~10s) → Lead SOUL.md conversation mode → Direct answer (~2s) → Total ~12s
- **Issues discovered**: Finding-5 confirmed — T0 latency for cold chats is significantly higher than claimed. The improvement over T2 is still meaningful (12s vs 25s) but the cost table overstates the benefit.
- **Recommendation**: For true sub-5s Q&A, consider a future "T-1" tier: a lightweight server-side LLM call without any CLI subprocess. This is explicitly non-goal in the current proposal, but should be acknowledged as a future optimization path.

---

## IV. Anti-Pattern Detection

| Anti-Pattern | Detection Result | Severity | Location |
|-------------|-----------------|----------|----------|
| God Module | Absent | — | Router, WorkflowEngine, Handoff are well-scoped |
| Circular Dependencies | Absent | — | New modules (orchestration/) don't create import cycles |
| Shared Mutable State | Potential | P2 | WorkflowEngine's `results: Map` is in-memory shared state; needs persistence design |
| Error Swallowing | Present | P1 | Handoff failure modes unspecified (Finding-8) |
| Under/Over Abstraction | Potential | P2 | WorkflowDAG condition DSL needs careful scoping — too simple = useless, too complex = mini-language |
| Swiss Army Knife | Absent | — | No catch-all utilities introduced |
| Chatty API | Absent | — | Handoff is single HTTP call; DAG execution is server-internal |
| Distributed Monolith | Absent | — | Tiers are well-separated; no cross-tier coupling |

---

## V. Architecture Decision Records (ADR)

### ADR-1: Two-Level Routing (Server Router + Lead Judgment)

- **Context**: Need to route messages to the right execution tier without adding latency
- **Decision**: Server-side Router handles only T1 (clear single-agent); Lead handles T0/T2 discrimination internally
- **Alternatives**: (1) Server routes all three tiers — rejected because T0 detection requires LLM-level understanding; (2) Lead routes all — rejected because this doesn't reduce Lead overhead
- **Consequences**: (+) Minimal server-side complexity, conservative fallback to Lead. (–) T0 still requires Lead spawn; server can't fast-path pure Q&A without Lead.
- **Recommendation**: Keep. This is the right balance for the current stage. Revisit when T0 usage data shows whether a server-side T0 fast-path (no Lead spawn) is worth building.

### ADR-2: HTTP Handoff vs WebSocket Handoff

- **Context**: Need a mechanism for running Experts to transfer tasks to peers
- **Decision**: HTTP POST endpoint called from Agent's CLI process via curl
- **Alternatives**: (1) WebSocket message from Agent to server — rejected because Agents communicate via CLI stdout, not WebSocket; (2) Whiteboard-based signal — rejected because polling-based, too slow; (3) Mailbox-based — contradicts deprecation direction
- **Consequences**: (+) Simple for Agents (just curl). (–) HTTP endpoint lacks WebSocket context (connectionId), needs resolution logic.
- **Recommendation**: Keep, but address Finding-3 (connectionId mapping). The HTTP approach is pragmatic given the CLI subprocess architecture.

### ADR-3: Mailbox Deprecation

- **Context**: Mailbox is low-value (auto-generated content) and redundant (4 other channels cover same functions)
- **Decision**: Deprecate in 3 phases — stop writing → remove reading → delete code
- **Alternatives**: (1) Keep mailbox, improve content quality — rejected because the channel itself is redundant; (2) Immediate removal — too risky, need gradual verification
- **Consequences**: (+) Simpler communication model, less code to maintain. (–) Any undiscovered mailbox consumers will break.
- **Recommendation**: Keep. The evidence is strong. But add a pre-deprecation step: instrument MailboxManager.readMessages() to log all callers for 1 week before Phase 5, to catch any hidden consumers.

---

## VI. Summary Matrix

| Dimension | P0 | P1 | P2 | P3 | Status |
|-----------|----|----|----|----|--------|
| Layered Architecture | 0 | 0 | 0 | 0 | OK |
| Module Boundaries | 1 | 1 | 0 | 0 | Warning |
| Dependency Governance | 0 | 1 | 0 | 0 | Warning |
| Data Flow | 0 | 1 | 0 | 0 | Warning |
| API Design | 0 | 2 | 0 | 0 | Warning |
| Error Handling | 0 | 1 | 0 | 0 | Warning |
| Testability | 0 | 0 | 0 | 0 | OK |
| Security Architecture | 1 | 0 | 0 | 0 | Critical |
| Evolvability | 0 | 0 | 1 | 1 | OK |
| **Total** | **2** | **6** | **1** | **1** | |

---

## VII. Action Items

### Must Fix Before Implementation (P0)

- [ ] **Replace WorkflowEngine condition eval with structured DSL** — architect — 0.5d
  - Define `TaskCondition` interface with safe operators (eq/neq/and/or/has)
  - Use allowlisted field access only (status, followUp, summary)
  - No eval/Function/vm.runInNewContext with LLM-generated strings

- [ ] **Correct Router integration point** — fullstack-product-engineer — 0.5d
  - Integration goes in `WSRouter.ts:58` (before `expert:start` delegation), not inside `ExpertHandler`
  - Or explicitly in `ExpertHandler.handleStart()` with architectural justification

### Should Fix Before Phase 2 (P1)

- [ ] **Resolve Handoff connectionId mapping** — fullstack-product-engineer — 1d
  - Design the lookup: chatId + sourceAgentId → ExpertSessionStore → connectionId → WebSocket
  - Add to design.md §5.3 as explicit implementation step

- [ ] **Fix Phase dependency conflict** — proposal author — 0.5d
  - Either: Move Mailbox Deprecation before DAG Engine
  - Or: Rewrite DAG Engine tasks to not depend on Mailbox from the start

- [ ] **Clarify T0 cold vs warm latency** — proposal author — doc-only
  - Add warm/cold distinction to cost table in design.md §2.5

- [ ] **Add Frontend Interface Contracts** — fullstack-product-engineer — 1d
  - Define new WebSocket events for handoff, tier identification
  - Specify UI behavior changes per tier

- [ ] **Add bilingual keyword classification** — fullstack-product-engineer — 1d
  - Build ZH/EN dispatch keyword table for Phase 2 Router

- [ ] **Specify Handoff failure handling** — proposal author — doc-only
  - Agent A waits for confirmation before exiting
  - Server returns sync success/failure
  - Failure → Agent A continues or reports

### Backlog (P2+)

- [ ] **Start with max handoff chain depth = 1** — config change
- [ ] **Instrument MailboxManager callers before deprecation** — 0.5d
- [ ] **Consider persistent Lead process for true T0 fast-path** — future iteration
