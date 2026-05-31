# Code Review

## Review Scope

- `server/services/agent-evolution/MemoryGrowthCapture.ts` (new)
- `server/routes/agent/evolutionRoutes.ts` (new)
- `server/stores/MemoryStore.ts` (modified — `getBySource`, `listAllSources`)
- `server/services/WorkspaceSeeder.ts` (modified — `ensureAgentMemoryDirs`)
- `server/startup/routeSetup.ts` (modified — route registration)
- `server/index.ts` (modified — capture wiring)
- `server/whiteboard/WhiteboardManager.ts` (modified — `onEntryAppended` listener)
- `web/services/agentEvolutionService.ts` (new)
- `web/hooks/useAgentEvolution.ts` (new)
- `web/pages/AgentEditorPage.tsx` (modified — EvolutionLog wiring)
- `ai-assets/agents/sensei/SOUL.md` (modified — Active Evolution Protocol)
- `ai-assets/agents/sensei/AGENTS.md` (new)

## Review Summary

> Solid implementation with clean separation of concerns and minimal blast radius. The core capture loop correctly mirrors whiteboard signals to MemoryStore and increments GrowthStore on task completion. The main correctness risk is floating async calls in the capture service that can silently drop errors and corrupt the dedup cache. The Sensei protocol enhancement is well-structured and actionable.

## Issues Found

### [P0] Must Fix (affects correctness)

1. **[Floating async → dedup corruption]** `MemoryGrowthCapture.ts:76` — `memoryStore.create()` is declared `async` (returns `Promise<AgentMemory>`) but is called without `await` in the synchronous `onWhiteboardEntry`. If `insertEntity` throws (disk full, DB locked), the error is caught by the `async` wrapper and converted to a rejected Promise — which goes unhandled. Worse, `this.sourceSeen.set(source, true)` on line 84 STILL executes afterward, permanently marking the entry as captured when it was not. The entry is silently lost with no retry path.

   Same issue in `onTaskCompleted` (line 50): `growthStore.increment()` is `async` but not `await`ed. Error becomes an unhandled rejection.

   **Fix options** (choose one):
   - Make `onWhiteboardEntry` and `onTaskCompleted` `async`, add `await` before store calls
   - Move `sourceSeen.set()` BEFORE the `create` call and remove it in the `catch` block (idempotent dedup is safer than missing dedup)
   - Remove the `async` keyword from `MemoryStore.create()` and `GrowthStore.increment()` since better-sqlite3 is synchronous — this makes the try-catch actually work

   Recommended: option C (remove `async` from store methods) as it also fixes the misleading API contract. If store methods must stay async for interface compatibility, use option A.

### [P1] Suggested Improvements (affects maintainability or robustness)

1. **[Evolution feed uses agentId as display name]** `evolutionRoutes.ts:39` — `agentName: agentId` passes the raw machine id (e.g., `"architect"`) to the UI. `EvolutionLog.tsx:169` renders it in a visible tag. While agent IDs happen to be readable in this project, the `EvolutionEntry` type field is named `agentName` (implying display name). Consider resolving to the agent's display name via `agentRegistry.get(agentId)?.name`, or rename the field to `agentId` if machine id is intentional.

2. **[Silent error swallowing in hook]** `useAgentEvolution.ts:15` — `catch { /* ignore */ }` silently discards fetch errors. Network failures, 500s, and JSON parse errors all vanish. At minimum, log to `console.warn` in development, or expose an `error` state so the UI can show a retry affordance.

3. **[Dedup cache key diverges from design]** `MemoryGrowthCapture.ts:69-70` — Design §B.3 specifies cache key as `agentId+source` but implementation uses `source` alone. Functionally equivalent because `source = wb:chatId:entryId` contains a unique nanoid. But if a future phase introduces non-whiteboard sources where the same source key could apply to multiple agents, this becomes a real bug. Consider using `${agentId}:${source}` as the cache key to match the design, and update `listAllSources()` to return `{agentId, source}` pairs for proper keying.

4. **[No input validation on evolution route]** `evolutionRoutes.ts:29` — `req.params.id` is passed directly to store queries without validating the agent exists. Returns empty array for typos/non-existent IDs, which is safe but could mask configuration errors. A 404 when the agent doesn't exist in the registry would be more informative.

5. **[`listAllSources` loads cross-agent data]** `MemoryStore.ts:97-100` — Loads ALL source values across ALL agents into a flat list at boot. Under the 2000-row cap this is negligible, but the query lacks the `agent_id` scoping that every other method in `MemoryStore` uses. If the cap were raised or source-tracking expanded, this would over-fetch. Consider adding a comment noting the intentional cross-agent scope, or scoping the boot query to active agents.

### [P2] Nice to Have (polish)

1. **[Hook doesn't match SWR pattern]** `useAgentEvolution.ts` — Tasks spec says "SWR-style fetch hook matching the existing patterns in `web/hooks/`" but this is a plain `useState`/`useEffect`/`useCallback` implementation with no caching, no revalidation, and no stale-while-revalidate semantics. If other hooks in the codebase use SWR or a similar library, this hook should follow the same pattern for consistency.

2. **[Milestone threshold semantics not obvious]** `evolutionRoutes.ts:23` — `MILESTONE_THRESHOLD_LEVEL = 2` means "at least 10 tasks completed" per `GrowthStore`'s `LEVEL_THRESHOLDS` array. The mapping is non-obvious from this file alone. A brief comment linking to the threshold table would help future readers.

3. **[SOUL.md references non-existent API path]** `SOUL.md:139` — Data Sources table references `/api/evolution/metrics` but the actual implemented endpoint is `GET /api/agents/:id/evolution`. Marked as "Pending" so this is documenting future intent, but the path format is inconsistent with the implemented route. Update to match or note it's a placeholder name.

## Highlights

- **MemoryGrowthCapture** has clean constructor injection and single-responsibility methods. The `resolveAgentId` helper correctly handles the `:auto` suffix and multi-segment agent identifiers — good attention to the whiteboard's actual data patterns.
- **Dedup-by-source** is an elegant design that avoids schema migration while providing idempotent capture. The boot-time cache population via `listAllSources()` ensures crash recovery without re-processing.
- **Event wiring** via `onEntryAppended` callback and `onAgentExited` callback is consistent with the codebase's existing patterns. The integration in `server/index.ts:194-204` is well-placed and readable.
- **WhiteboardManager** listener registration (line 89-91) is non-intrusive — a simple array push with try-catch in the emit loop. No existing behavior is modified.
- **Frontend** uses `encodeURIComponent` for the agentId in the API URL — good security practice.
- **WorkspaceSeeder.ensureAgentMemoryDirs** is appropriately defensive with `recursive: true` and a top-level try-catch that logs warnings without blocking boot.
- **Sensei SOUL.md** Active Evolution Protocol is well-structured: concrete trigger thresholds, step-by-step analysis workflow, structured proposal format, and clear guard rails (user confirmation, atomic changes, cooldown period, voice preservation). The honest Data Sources table distinguishing available vs. pending sources builds trust.
- **AGENTS.md** stub correctly unblocks the `SenseiUpgradeService.loadSenseiPrompt()` crash path with minimal content — fixes a latent bug without over-engineering.

## Architecture Review

The data flow design aligns with the design doc (§B.1):

```
WhiteboardManager entry → onEntryAppended → MemoryGrowthCapture.onWhiteboardEntry → MemoryStore
ExpertHandler exit     → onAgentExited   → MemoryGrowthCapture.onTaskCompleted    → GrowthStore
                                                                                    ↓
GET /api/agents/:id/evolution ← derives from MemoryStore + GrowthStore (read-time join)
                                                                                    ↓
useAgentEvolution hook → EvolutionLog component (AgentEditorPage right panel)
```

The decision to derive the evolution feed at read-time (D3 in design.md) is correct for Phase 1 — avoids a new table and keeps the schema flat. The read-time join across two stores is cheap at current scale.

Event wiring uses the callback/listener pattern rather than a shared EventEmitter (D2), which is the minimum-blast-radius approach. Both subscription points (`onEntryAppended`, `onAgentExited`) are wired in `server/index.ts` adjacent to the service instantiation — easy to trace.
