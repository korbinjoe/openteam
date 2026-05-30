# Proposal: Adaptive Multi-Agent Orchestration

## Summary

Introduce a three-tier execution model that routes incoming requests to the
optimal execution path based on complexity analysis, eliminating overhead for
simple tasks while enabling structured workflows for complex ones.

## Motivation

Performance audit data (216 sessions, 11 days) reveals that ~50% of tasks
incur unnecessary orchestration overhead:

- **15% conversation-level** tasks (Q&A, explain code) go through full Expert
  subprocess lifecycle when a direct LLM response would suffice
- **35% simple single-agent** tasks go through Lead analysis + dispatch when
  the target agent is unambiguous
- **10% complex multi-step** tasks require sequential re-dispatching because
  no workflow primitive exists for "do A then B"

The current model is optimized for one scenario (Lead dispatches N parallel
experts) but pays full overhead for every other scenario.

## Goals

1. **Reduce latency** for simple tasks from ~20-30s to <3s (conversation) / <10s (single-agent)
2. **Reduce cost** by eliminating unnecessary Lead analysis for obvious single-agent tasks
3. **Enable structured workflows** for complex tasks (sequential, conditional, fan-out/fan-in)
4. **Maintain current strengths**: process-level parallelism, agent identity, human pulse-mode
5. **Backward compatible**: existing dispatch model remains the default multi-agent path

## Non-Goals

- Replacing the CLI subprocess model (process-level isolation is a strength)
- Building a generic graph computation engine (LangGraph-style — too complex)
- Building a custom LLM inference layer — all tiers use underlying CLI (Claude Code / Codex)
- Changing the AgentMessage protocol (already well-designed)

## Approach

Three execution tiers routed by an **Execution Mode Router**, plus an
**Agent-to-Agent Handoff** mechanism for mid-execution rerouting:

| Tier | When | How | Overhead |
|------|------|-----|----------|
| **T0: Conversation** | Q&A, explain, status queries | Lead answers directly (no Expert dispatch) | ~3-5s |
| **T1: Single Expert** | Clear single-agent task, no decomposition needed | Skip Lead, route directly to Expert | ~5-10s |
| **T2: Orchestrated** | Multi-agent or multi-step tasks | Lead dispatch (current model) + optional workflow DAG | ~15s+ |

All tiers use CLI subprocess execution (Claude Code / Codex). The router is
a lightweight classifier (regex + keyword matching, not LLM) that selects
which agent to spawn.

**Agent Handoff**: Any running agent can transfer its task to a more appropriate
peer. This provides the safety net when the router misclassifies, and enables
dynamic rerouting based on what the agent discovers during execution.

**Mailbox Deprecation**: The existing point-to-point Mailbox system is removed.
Its functions are already covered by WebSocket/SSE events (completion notification),
Whiteboard (structured artifacts), and the new Handoff API (directed transfer).
This simplifies the communication model from 5 channels to 4 with clear
single-responsibility boundaries.

## Risks

| Risk | Mitigation |
|------|-----------|
| Router misclassifies complex task as simple | Agent Handoff provides mid-execution escape valve; action verb counting as defense-in-depth |
| T0 conversation mode can't handle follow-up action requests | Lead transitions naturally to T2 dispatch when follow-up requires action |
| T1 bypass breaks Lead's coordination awareness | T1 results posted to whiteboard, Lead can review async |
| Handoff target spawn fails | Handoff is synchronous — Agent A stays alive until server confirms; continues working on failure |
| Handoff chain becomes infinite loop | Max chain depth enforced (1 hop; relaxable to 2 via config if data supports it) |
| Router fails on Chinese input | Bilingual (EN/ZH) keyword table from day one; conjunction/dependency detection in both languages |
| T0 latency overstated for cold chats | T0 warm (~2-5s) vs cold (~10-15s) clearly documented; cold still 2x faster than T2 |
| Workflow condition string enables code injection | Structured TaskCondition DSL with allowlisted fields replaces free-form JS eval |
| DAG Engine builds on deprecated Mailbox | Phase reordered: Mailbox Deprecation (Phase 4) before DAG Engine (Phase 5) |

## Alternatives Considered

1. **LangGraph-style graph engine**: Too much conceptual overhead. BSP superstep
   model requires upfront graph definition — doesn't fit OpenTeam's ad-hoc task style.

2. **crewAI-style Process enum**: Too rigid. Sequential/hierarchical as the only
   options doesn't cover OpenTeam's parallel + human-in-the-loop workflow.

3. **Do nothing, optimize Lead**: Diminishing returns. Lead optimization (dispatch
   decision tree, done in Phase 5) helps but can't eliminate structural overhead.

## References

- `openspec/changes/multi-agent-orchestration/research.md` — Framework comparison
- `openspec/changes/multi-agent-orchestration/analysis.md` — Current model analysis
- `openspec/changes/audit-agent-performance/design.md` — Performance audit data
