# Design: Audit findings + minimum viable capture loop

This document holds the architectural review that motivates the proposal, followed by the concrete design for the Phase-1 capture loop.

---

## Part A — Architecture Review

Scope: the project's multi-agent memory mechanism and agent growth/evolution mechanism. Method: 9-dimension architectural review cross-referenced with the three feizhu-share surveys.

### 1. Inventory of what exists today

| Layer | Component | File | Status |
|------|------|------|------|
| Storage | `MemoryStore` (per-agent SQLite) | `server/stores/MemoryStore.ts` | Functional, **no auto-writer** |
| Storage | `GrowthStore` (per-agent SQLite, metric→value→level) | `server/stores/GrowthStore.ts` | Functional, **no auto-incrementer** |
| Schema | `agent_memories` (cap 2000, LRU by `updated_at`) | `migrations/` | OK |
| Schema | `agent_growth` (uncapped, one row per `(agent,metric)`) | `migrations/` | OK |
| API | `GET/POST/PUT/DELETE /api/agents/:id/memories` | `routes/agent/memoryRoutes.ts` | OK |
| API | `GET /api/agents/:id/growth`, `POST .../growth/:metric` | `routes/agent/memoryRoutes.ts` | OK |
| Prompt | `## Cross-Session Memory` block, top-20 by importance | `runtime/ConfigCompiler.ts:589-608` | Wired, **always empty** |
| Prompt | `## Workspace Path` pointer to `MEMORY.md` + `memory/YYYY-MM-DD.md` | `runtime/ConfigCompiler.ts:474-477` | Wired, target dir does not exist |
| Asset | Static `MEMORY.md` per agent | `~/.openteam/agents/<id>/MEMORY.md` | **Missing** for all 10 bundled agents |
| Asset | Per-day workspace log `memory/YYYY-MM-DD.md` | `~/.openteam/agents/<id>/memory/` | **Directory does not exist** |
| Asset | Cross-session war-room (per chat) | `~/.openteam/whiteboard/<chatId>/entries.jsonl` | **Functional** — entries appended |
| Asset | Mailbox JSONL (per chat × instance pair) | `~/.openteam/mailbox/<chatId>/<from>→<to>.jsonl` | **Functional** |
| UI | `EvolutionLog` timeline | `web/components/evolution/EvolutionLog.tsx` | Built, **no data source** |
| UI | `growthRecord` section in agent editor | `web/pages/AgentEditorPage.tsx:452` | Renders placeholder copy |
| Service | `SenseiUpgradeService` — user-triggered prompt rewriter | `server/services/update/SenseiUpgradeService.ts` | Throws on first call: prompt files missing |
| Hook | `wb-auto-extract.sh` — stop-hook fallback for war-room writes | `ai-assets/hooks/wb-auto-extract.sh` | Functional |
| Hook | `wb-post-tool-write.sh` — captures artifact / handoff from tool calls | `ai-assets/hooks/wb-post-tool-write.sh` | Functional |
| Skill | `whiteboard` — wb-write / wb-snapshot / wb-query / wb-supersede / wb-archive | `ai-assets/skills/whiteboard/` | Functional |

### 2. Mapping to the five-stage pipeline (feizhu §3.1)

```
                Extract  →  Consolidate  →  Store  →  Retrieve  →  Forget
OpenTeam today: manual    none           OK       importance     LRU cap
                (whiteboard via Skill)            DESC only      only
```

- **Extract**: the only path is an agent calling `wb-write.sh` itself or the stop-hook's regex match on the transcript. There is no LLM-driven fact extraction. The whiteboard entries that DO get captured never propagate to `MemoryStore`.
- **Consolidate**: none. No de-dup, no merge, no conflict resolution.
- **Store**: solid — two SQLite tables, cap, per-agent scoping, importance.
- **Retrieve**: `ORDER BY importance DESC, updated_at DESC LIMIT 20`. No semantic match, no time decay, no value/utility scoring. Acceptable for an empty store; not acceptable once data flows.
- **Forget**: only the implicit LRU cap on `MemoryStore` (max 2000 rows, evict by `updated_at`). No utility-driven pruning.

### 3. Mapping to CoALA's four memory types (feizhu §2.3)

| Type | OpenTeam today | Gap |
|------|----------|-----|
| Working memory | Conversation transcript (JSONL) + war-room snapshot | OK |
| Episodic memory | None at the cross-session layer; only in-chat war-room | **High** — `MemoryStore` is the natural home, currently empty |
| Semantic memory | None | **Medium** — could be reused from `MemoryStore.category='general'` once writers exist |
| Procedural memory | Skills directory (`ai-assets/skills/`) | Partial — static, no auto-generation; Sensei could generate but doesn't yet |

### 4. Multi-agent dimension (feizhu §6)

OpenTeam already has two of the three classical multi-agent memory primitives:

| Primitive | OpenTeam | Status |
|----------|----------|------|
| Shared blackboard | `WhiteboardManager` per chat | ✅ Functional, well-designed |
| Inter-agent messaging | `mailbox` JSONL pairs | ✅ Functional |
| Team-level long-term memory | Per-agent `MemoryStore` only | ❌ No team scope, no cross-agent broadcast |

The war-room covers the **in-task** shared context exceptionally well — it is the system's strongest piece. The gap is **cross-task knowledge accumulation** ("we tried this pattern in chat X, it failed, every agent should avoid it"). Phase-2 work, out of scope here.

### 5. Evolution / growth dimension (feizhu evolution §3-§5)

The evolution doc enumerates four levers: Memory → Strategy/Skill → Model → Architecture. OpenTeam's posture:

| Lever | OpenTeam | Status |
|------|----------|------|
| Memory evolution | `MemoryStore` schema | ❌ Storage only, no capture |
| Skill evolution | `ai-assets/skills/` (static), Sensei (user-triggered) | ❌ No auto-derivation from successful trajectories |
| Model evolution (RL/SFT) | n/a | Out of scope (correctly — sits behind closed-source CLIs) |
| Architecture evolution | n/a | Out of scope |

The evolution doc's headline finding ("non-parametric route first: experience + skills + memory") aligns with where OpenTeam should invest. The lowest-cost first step is **closing the memory + growth capture loop** — exactly this proposal's Phase 1.

### 6. Nine-dimension architectural scorecard

| Dimension | Score | Comment |
|----|----|----|
| 1. Layered separation | B | Stores / routes / runtime cleanly split; UI directly hits REST. |
| 2. Module boundaries | A | `MemoryStore` and `GrowthStore` are textbook small modules. |
| 3. Dependency governance | B | `ConfigCompiler` optionally depends on `MemoryStore` — clean injection. No cycles. |
| 4. Data flow | **D** | The data flow *to* the stores is broken (no writers). The flow *from* stores into prompts is wired but starved. |
| 5. API design | A | REST contracts are minimal, consistent, predictable. |
| 6. Error handling | C | No error path for "memory write failed" anywhere — but also no caller, so it has not mattered yet. |
| 7. Testability | B | Stores are unit-testable; the missing piece is integration tests for the (missing) capture pipeline. |
| 8. Security | B | Per-agent scoping in store queries is correct; REST is unauthenticated but matches the rest of the local-only API surface. |
| 9. Evolvability | C | Schema and storage are easy to extend; the *behavioral* gap (capture, retrieval, forget) is what limits evolvability today. |

**Headline**: the system has been over-invested in storage/UI and under-invested in capture and feedback. This proposal corrects the imbalance with the minimum possible code.

### 7. Comparison with the open-source ecosystem (memory survey §IV)

| Reference | What it does well | OpenTeam comparison |
|----|----|----|
| Mem0 | LLM fact-extraction; structured updates; multi-backend | OpenTeam has no fact-extraction. Could adopt the "summary write-back" pattern from `wb-auto-extract.sh` as a stepping stone. |
| Letta (MemGPT) | Stateful agent with self-modifying memory blocks | OpenTeam's `MEMORY.md` is conceptually similar but read-only at runtime today. |
| Claude Code memory | File-first (CLAUDE.md + ~/.claude/memory/), four typed memory categories | OpenTeam's `MemoryCategory` mirrors this well. The capture mechanism is the gap. |
| Graphiti / GraphRAG | Time-aware graph memory; facts can expire | Future state; not Phase-1. |
| MemoryOS (BAI-LAB) | STM / MTM / LPM three-tier | OpenTeam's working / war-room / `MemoryStore` is the same three tiers — but tier 3 has no input. |
| Hindsight | Self-reflecting memory updates | Sensei is positioned for this role but currently does only one-shot prompt rewriting; could become the reflection engine in a later phase. |

### 8. Latent bugs surfaced by the audit

| Bug | Location | Impact |
|----|----|----|
| `senseiPromptPaths` points at two files that do not exist | `server/index.ts:192-195`; `find ai-assets -name "AGENTS.md"` returns only `ai-assets/system/AGENTS.md` | First user-triggered Sensei upgrade throws "Failed to read sensei prompt"; UI shows the error. |
| `Cross-Session Memory` prompt section always empty | `runtime/ConfigCompiler.ts:589-608` | Silent — section is suppressed entirely when empty. No user-visible failure but the headline feature does nothing. |
| Workspace `memory/` directory not created | `server/services/WorkspaceSeeder.ts` | `BOOT.md` instructions ("log to memory/YYYY-MM-DD.md") fail silently when the agent tries to write. |
| `EvolutionLog` has no data source | `web/components/evolution/EvolutionLog.tsx` + `web/types/team.ts` | UI renders the "no records yet" placeholder forever. |

Phase 1 fixes all four.

### 9. Recommendations summary

1. **Close the capture loop** — Phase 1, this proposal.
2. **Add a feedback signal** — Phase 2; add per-message thumbs / per-task success rating; route into `MemoryStore` with `category='feedback'`. Aligns with the user's stated KPI "first-pass rate".
3. **Add LLM-driven extraction + consolidation** — Phase 3; replace the verbatim mirror of war-room entries with a periodic extraction job (Mem0 pattern).
4. **Add value-driven retrieval** — Phase 4; replace `ORDER BY importance DESC` with a small reranker that scores by recency × usage × declared importance. Needed only once memory volume justifies it.
5. **Add team-level memory** — Phase 5; promote high-importance per-agent memories to a team store that all agents see in their prompt prefix.
6. **Resolve Sensei's role** — decide whether Sensei is the reflection engine (Hindsight-style) or stays as the user-triggered prompt rewriter. Fix the broken prompt-path regardless.

---

## Part B — Phase 1 design (the capture loop)

### 1. Component diagram

```
                                                                ┌──────────────────┐
 mailbox `task:completed`  ──┐                                  │  GET             │
 (server/routes/agent/        │     ┌──────────────────────┐    │  /api/agents/    │
  expertRoutes.ts:296+)       ├───▶ │  MemoryGrowthCapture │    │  :id/evolution   │
                              │     │  (new service)        │    │                  │
 whiteboard entry append  ────┘     │                       │    │  (new route)     │
 (WhiteboardManager event)          │  - onTaskCompleted    │    └──────────────────┘
                                    │  - onWhiteboardEntry  │              ▲
                                    └──────┬────────────┬───┘              │
                                           │            │                  │
                                           ▼            ▼                  │
                                   ┌─────────────┐  ┌──────────────┐       │
                                   │ GrowthStore │  │ MemoryStore  │ ──────┘
                                   └─────────────┘  └──────────────┘
                                           │            │
                                           └──────┬─────┘
                                                  ▼
                                    ┌──────────────────────────┐
                                    │ ConfigCompiler            │
                                    │ buildMemoryPrompt         │
                                    │ → injects into next       │
                                    │   agent system prompt     │
                                    └──────────────────────────┘
```

### 2. `MemoryGrowthCapture` service

Location: `server/services/agent-evolution/MemoryGrowthCapture.ts`.

```ts
class MemoryGrowthCapture {
  constructor(
    private memoryStore: MemoryStore,
    private growthStore: GrowthStore,
    private whiteboardManager: WhiteboardManager,
    private agentRegistry: AgentRegistry,
  ) {}

  onTaskCompleted(agentId: string, taskId: string): void
  onTaskFailed(agentId: string, taskId: string): void
  onWhiteboardEntry(chatId: string, entry: WhiteboardEntry): void
}
```

- **`onTaskCompleted`**: `growthStore.increment(agentId, 'tasks_completed', 1)`. If the returned `level` is higher than the previously cached one, emit an internal event for the evolution feed.
- **`onTaskFailed`**: no-op in Phase 1 (avoids gaming and bad signal until we have a recovery-credit design).
- **`onWhiteboardEntry`**:
  - Filter `entry.type ∈ {decision, constraint, open_question}`.
  - Resolve `entry.by` (the writing agent's id). Skip if not a registered agent (`by:auto` from `wb-auto-extract.sh` is allowed and traces to the same agent base).
  - Compute `source = 'wb:' + chatId + ':' + entryId`. Skip if a memory already exists with that `source` (uniqueness check via a new `getBySource(agentId, source)` helper on `MemoryStore`).
  - Map `type → category`: `decision → context (importance=2)`, `constraint → context (importance=3)`, `open_question`-when-archived `→ feedback (importance=2)`.
  - `memoryStore.create(...)`.

Subscription wiring:

- `expertRoutes.ts` already parses `task:completed` mailbox events (line 296+); inject a callback or refactor the message handler to emit a typed event on a shared `EventEmitter` that `MemoryGrowthCapture` listens to.
- `WhiteboardManager` already broadcasts entry appends to the websocket layer; subscribe to the same event source (add a server-internal listener channel — no new wire format).

### 3. Schema notes

No migration. Use existing fields:

- `agent_memories.source TEXT NULL` — stores the dedup key `wb:<chatId>:<entryId>`.
- `agent_memories.chat_id TEXT NULL` — stores `chatId` for cross-reference.
- `agent_memories.importance INTEGER` — set 2 or 3 per the mapping above.

Add a query helper `MemoryStore.getBySource(agentId, source): AgentMemory | undefined` and an in-process map cache (`Map<agentId+source, true>`) initialized on boot from a single `SELECT agent_id, source FROM agent_memories WHERE source IS NOT NULL`. Avoids a UNIQUE-constraint migration; cap is small (≤ 2000 rows).

### 4. Evolution feed mapping

`GET /api/agents/:id/evolution` returns:

```ts
type EvolutionEntry = {
  id: string
  type: 'memory_updated' | 'milestone' | 'skill_acquired' | 'strategy_evolved'
  title: string
  description: string
  agentName: string
  timestamp: number
}
```

Phase-1 producers:

- `memory_updated` — one entry per row in `memoryStore.listByAgent(id)`, `title = category`, `description = content` (truncated to 160 chars), `timestamp = updatedAt`.
- `milestone` — one entry per growth metric whose `level >= 2` (crossed the first threshold of 10). `title = "Reached level N in <metric>"`.
- `skill_acquired` / `strategy_evolved` — empty in Phase 1; the types remain in the union so the UI does not need to change when later phases produce them.

Sorted by `timestamp DESC`. Capped at 100 entries (UI is a timeline — older entries are useless).

### 5. Workspace seeding

`WorkspaceSeeder` already runs at agent registration. Add a single line: `mkdir(join(workspaceDir, 'memory'), { recursive: true })`. No template `MEMORY.md` is generated — agents write to it on demand per the BOOT instructions.

### 6. Known limitations carried forward (Phase 2+ candidates)

- **No quality weighting on `tasks_completed`.** Fast-failing agents that complete many trivial tasks will level up faster than careful ones. Phase 2 should pair this with a `first_pass_rate` metric driven by review/verification outcomes — directly the user's stated KPI.
- **No utility-based retrieval.** The top-20-by-importance approximation will fail at high volume.
- **No cross-agent broadcast.** A decision written by `architect` does not appear in `fullstack-product-engineer`'s prompt. Acceptable since the war-room covers in-chat sharing.
- **No LLM-driven consolidation.** Two near-identical "decision" entries from the same agent on the same topic will both be stored; the LRU cap will eventually evict the older one but importance ordering may keep it in the top 20.

### 7. Adjacent bug-fix: Sensei prompt path

`server/index.ts:192-195` lists two non-existent paths. Two options:

1. **Create `ai-assets/agents/sensei/AGENTS.md`** with a minimal stub (Sensei already has `IDENTITY.md` + `SOUL.md`). Lowest risk; matches the pattern of other agents.
2. **Add a graceful fallback** in `SenseiUpgradeService.loadSenseiPrompt` returning a built-in default if all paths fail.

Recommend (1) — keeps the data alongside the agent, avoids carrying a default string in code. Phase 1 ships the stub; Phase-later work can refine the prompt without code changes.

---

## Decisions

### D1: Capture by mirroring the war-room, not by adding new agent prompts

Alternative considered: tell every agent in their system prompt to "after each turn, call `memoryStore.create` for anything worth remembering." Rejected because:

- The whiteboard already exists as the canonical durable-signal channel and agents already write to it.
- Per-agent prompt churn would inflate prompt size and break the user-confirmed behavior pattern.
- A server-side mirror is testable, observable, and easy to disable per agent.

### D2: Reuse existing `EventEmitter` plumbing, do not introduce a message bus

The codebase has `EventEmitter` instances in `WhiteboardManager` and `WSRouter`. Adding a single `internalEvents` emitter wired into `expertRoutes.ts` and `WhiteboardManager` is the minimum-blast-radius integration point. A pub/sub bus or queue would be over-engineering for two event types.

### D3: Derive evolution feed from existing stores, do not add a new table

A separate `evolution_events` table would duplicate data that already exists in `agent_memories` and `agent_growth`. A read-time derivation keeps the schema flat and avoids backfill on first deploy. If/when ordering, filtering, or pagination performance becomes an issue, a materialized view is the upgrade path.
