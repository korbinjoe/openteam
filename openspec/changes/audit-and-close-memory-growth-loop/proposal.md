# Proposal: Audit the agent memory & growth mechanism and close the capture loop

## Summary

This change does two things in one pass:

1. **Audit** the project's current multi-agent memory and growth mechanism against the patterns and benchmarks surveyed in `~/work/feizhu-share/Agent记忆系统调研.md`, `Agent自我进化机制调研.md`, and `agent-memory-research.md`. The full findings live in `design.md`.
2. **Close the smallest viable capture loop** so the existing `MemoryStore`, `GrowthStore`, `EvolutionLog` UI and `Cross-Session Memory` prompt section actually receive data. Today every one of those surfaces compiles and renders, but no code path inside the agent runtime writes to them — they are all silent.

The audit finds that OpenTeam already has the *storage* layer (SQLite-backed `MemoryStore` / `GrowthStore`, REST CRUD, prompt-injection point, UI surface) but is missing the **capture**, **retrieval**, and **evolution** stages of the standard five-stage memory pipeline (Extract → Consolidate → Store → Retrieve → Forget). This proposal wires the *capture* stage end-to-end and leaves Consolidate / Retrieve-by-value / Forget to follow-up changes once we have real data flowing.

## Motivation

### What works today

- `server/stores/MemoryStore.ts` — SQLite store with categories (`general | preference | context | feedback | skill`), importance, agent scoping.
- `server/stores/GrowthStore.ts` — per-metric value+level with `LEVEL_THRESHOLDS = [0,10,30,60,100,150,210,...]`.
- `server/routes/agent/memoryRoutes.ts` — REST CRUD for both stores.
- `server/runtime/ConfigCompiler.ts:469-477,589-608` — injects `## Cross-Session Memory` and `## Workspace Path` (with `MEMORY.md` / `memory/YYYY-MM-DD.md` pointers) into every agent's system prompt.
- `ai-assets/hooks/wb-auto-extract.sh` + `wb-post-tool-write.sh` — already capture `decision`, `constraint`, `open_question`, `goal`, `artifact`, `handoff`, `progress` into the war-room (per-chat `entries.jsonl`).
- `web/components/evolution/EvolutionLog.tsx` — fully-built timeline UI keyed on `EvolutionType = 'skill_acquired' | 'memory_updated' | 'strategy_evolved' | 'milestone'`.

### What is broken or empty

- **No automatic writers.** `grep -rn "memoryStore.create\|growthStore.increment"` returns zero matches outside `memoryRoutes.ts` and the stores themselves. Both stores are CRUD-only.
- **`Cross-Session Memory` prompt section is always empty** — `buildMemoryPrompt` returns `null` because `getForPromptInjection` finds zero rows.
- **`EvolutionLog` has no data source** — `EvolutionEntry` is declared in `web/types/team.ts`, the timeline UI consumes it, but no server endpoint or store produces it.
- **No agent workspace contains a `memory/` folder.** `~/.openteam/agents/<id>/` only holds the static `IDENTITY.md` / `SOUL.md` / `TOOLS.md` (`HEARTBEAT.md` and `BOOT.md` for a subset). The BOOT/HEARTBEAT scripts that say "log to today's memory/YYYY-MM-DD.md" never have a directory to write into.
- **Sensei upgrade path is broken at load time.** `server/index.ts:192-195` reads `senseiPromptPaths = [ai-assets/agents/sensei/AGENTS.md, ai-assets/agents/sensei.md]`. Neither file exists — `find ai-assets -name "AGENTS.md"` returns only `ai-assets/system/AGENTS.md`. First invocation of `SenseiUpgradeService.start` throws "Failed to read sensei prompt". This is a latent runtime bug independent of the loop work, surfaced by the audit.
- **No feedback signal.** No user-rating / thumbs-up / auto-verify path feeds either store. Compare to Hindsight, Claude Code, OpenClaw — all use feedback as the primary evolution input.

### Why this matters

Every research survey in `~/work/feizhu-share` lands the same conclusion: the bottleneck is not "能不能存" but "能不能在正确时刻把正确记忆交给 Agent". A storage-only stack with empty writers means the user experiences "every session starts from scratch" — directly violating OpenTeam's pulse-mode promise ("come back, find your team smarter than you left it"). Closing the capture loop is the smallest change that converts the existing scaffolding from dead UI into a real signal.

## Goals

1. **Auto-capture growth from task lifecycle.** Every `task:completed` mailbox event increments `growthStore[agentId].tasks_completed` by 1; `task:failed` increments `bugs_fixed` only if the same task later succeeds (basic recovery credit). Levels recompute via the existing `valueToLevel` table.
2. **Auto-capture memory from war-room durable signals.** Every `decision` and `constraint` written to a chat's whiteboard (manually by the agent, or automatically by `wb-auto-extract.sh`) mirrors into `MemoryStore` for the writing agent, with `category='context'` and `source='whiteboard:<chatId>'`. `open_question` entries that are later `archived` (resolved) mirror as `category='feedback'`.
3. **Surface an evolution feed.** New `GET /api/agents/:id/evolution` returns the unified `EvolutionEntry[]` the existing UI expects — derived (not stored separately) from `MemoryStore` rows (`memory_updated`), `GrowthStore` level transitions (`milestone`), and reserved slots for `skill_acquired` / `strategy_evolved` (left empty until follow-up changes add those producers).
4. **Make the `Cross-Session Memory` prompt section non-empty for any agent with ≥1 captured memory** — no change to `buildMemoryPrompt`, just ensure the writers run so it has rows to inject.
5. **Fix the Sensei prompt-loader regression** as a small adjacent bug — either ship the missing `ai-assets/agents/sensei/AGENTS.md` skeleton or fall back gracefully. (Detailed in `tasks.md` under "Adjacent bug".)

## Non-Goals

- **No semantic / vector retrieval, no time-decay, no utility-driven retrieval.** Retrieval stays at the current `importance DESC, updated_at DESC, LIMIT 20`. The research surveys all flag retrieval quality as the next big lever, but it only matters once writers exist. Deferred.
- **No de-duplication, no LLM-based fact extraction (Mem0-style), no conflict resolution.** Capture writes the raw whiteboard summary verbatim. The proposal's growth-cap (`MemoryStore maxItems=2000` already enforces eviction by `updated_at`) is the only "forgetting".
- **No skill auto-generation, no Sensei-driven prompt evolution loop.** Sensei stays as a user-triggered prompt rewriter; the audit only fixes the broken file path.
- **No new feedback UI (thumbs / rating).** Acknowledged as the next-most-valuable lever, but out of scope for the capture loop.
- **No cross-agent memory sharing beyond what the war-room already provides in-chat.** Team-level long-term memory is a follow-up.
- **No migration off SQLite to a vector DB / KG backend** — explicitly aligns with the project rule keeping JSONL/SQLite as the SOT.

## Approach

### Server

- New thin service `server/services/agent-evolution/MemoryGrowthCapture.ts`:
  - Subscribes to existing `task:completed` / `task:failed` parsing in `server/routes/agent/expertRoutes.ts` (line 296+) via an injected callback or an `EventEmitter` event. Calls `growthStore.increment(agentId, 'tasks_completed', 1)` on completion.
  - Subscribes to whiteboard writes (existing `WhiteboardManager`). When an entry with `type ∈ {decision, constraint, open_question}` lands AND the entry's `by` is an agent id we recognize, calls `memoryStore.create({ agentId: by, content: summary, category: 'context'|'feedback', source: 'whiteboard:'+chatId+':'+entryId, importance: 2 })`. The mirror is *one-shot per entryId* — store an `entry_id` column or use the existing `source` field as a uniqueness key (covered in `design.md §3.2`).
- New `server/routes/agent/evolutionRoutes.ts` exposing `GET /api/agents/:id/evolution`:
  - Joins `MemoryStore.listByAgent` (mapped to `memory_updated`) with growth level-up events (derived by replaying `GrowthStore` history — or simpler, surfacing the *current* level as a single `milestone` per metric that crossed `LEVEL_THRESHOLDS[1] = 10`). The exact mapping is in `design.md §4`.
- `server/services/WorkspaceSeeder.ts` (existing) gains an `ensureMemoryDir(workspaceDir)` step that creates `<workspaceDir>/memory/` on agent boot.

### Web

- `web/services/` gains `agentEvolutionService.ts` calling the new endpoint.
- `EvolutionLog` is wired into `AgentEditorPage.tsx:452` (the `growthRecord` section currently rendering placeholder text) via a `useAgentEvolution(agentId)` hook.

### Hooks / assets

- No new shell hooks — capture is server-side, triggered by signals the existing `wb-auto-extract.sh` and mailbox already produce. This avoids the cross-platform `bash`/`jq` surface that the user has already invested in.

### Compatibility

- No schema migration: both `agent_memories` and `agent_growth` tables already exist (`server/stores/migrations/`). The `source` field on `AgentMemory` is already nullable and stores the dedup key.
- Existing REST CRUD on `/api/agents/:id/memories` and `/api/agents/:id/growth` keeps working identically. The new writers and the user can both write.

## Risks

| Risk | Mitigation |
|------|------------|
| Memory pollution from chatty agents writing too many decisions/constraints | `MemoryStore` already caps at 2000 rows with LRU-by-`updated_at` eviction; the importance ordering ensures the prompt-injection top-20 stays meaningful even if low-importance rows churn. |
| Duplicate mirroring on whiteboard replay / server restart | Uniqueness enforced via `source = 'whiteboard:<chatId>:<entryId>'` plus an indexed `UNIQUE(agent_id, source)` constraint check at write time (covered in `design.md §3.2`). |
| Growth XP gaming (an agent that fails fast and "completes" many trivial tasks levels up faster than a careful one) | Out of scope for Phase 1. Documented as a known limitation in `design.md §6` ("first-pass rate" is the user's stated KPI and belongs in Phase 2 once we have real task-quality signals). |
| Capture happens for agents the user has not yet seen Memory/Growth UI for | Acceptable — the data accumulates silently and lights up the UI the first time the user opens an agent editor. Pulse-mode-friendly. |
| Sensei prompt fallback hides a deeper config drift | The fallback logs a warning at boot (one-time) and the audit findings in `design.md §8` flag a follow-up to consolidate `senseiPromptPaths` into a single source of truth. |

## Validation

- Unit tests for `MemoryGrowthCapture`: idempotent on duplicate `entryId`, no-op when `by` is not a registered agent, correct category mapping.
- Integration test: spin up a chat, write a `decision` via `wb-write.sh`, assert `MemoryStore.listByAgent` contains it once.
- Integration test: send `task:completed` mailbox event, assert `GrowthStore.getMetric('tasks_completed').value` increments and `level` recomputes on threshold crossing.
- Manual: open `AgentEditorPage` for `architect` after completing one task; confirm the EvolutionLog timeline shows the milestone + the mirrored decision entries.

See `tasks.md` for the ordered work breakdown.
