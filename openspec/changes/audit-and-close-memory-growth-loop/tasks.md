# Tasks

Sequential unless marked `[parallel]`. Each task closes a slice end-to-end.

## 1. Server: capture service skeleton

- [ ] 1.1 Add `server/services/agent-evolution/MemoryGrowthCapture.ts` with constructor, `onTaskCompleted`, `onTaskFailed`, `onWhiteboardEntry`, and a private in-memory `sourceSeen: Map<string, true>` dedup cache.
- [ ] 1.2 Add `MemoryStore.getBySource(agentId, source)` and `loadSourceIndex(): Map<string, true>` helpers. Populate the dedup cache on `MemoryGrowthCapture` construction.
- [ ] 1.3 Instantiate `MemoryGrowthCapture` in `server/index.ts` after the existing `memoryStore` / `growthStore` setup; pass into the same DI surface used by `routeSetup`.
- [ ] 1.4 Unit test `MemoryGrowthCapture` in isolation: covers idempotent re-entry, unknown agent skip, category mapping for `decision` / `constraint` / `open_question`.

## 2. Server: task-completed → growth

- [ ] 2.1 Extract the existing `task:completed` / `task:failed` parsing block in `server/routes/agent/expertRoutes.ts` (line 296+) into a small typed event emitter so it can be subscribed to without router coupling.
- [ ] 2.2 Subscribe `MemoryGrowthCapture.onTaskCompleted` to that emitter.
- [ ] 2.3 Integration test (sqlite-backed): post a `task:completed` mailbox payload, assert `GET /api/agents/<id>/growth` shows `tasks_completed.value === 1`. Repeat 10 times, assert `level === 2`.

## 3. Server: whiteboard entry → memory

- [ ] 3.1 Add an internal `EventEmitter` to `WhiteboardManager` emitting `entry:appended` with `{ chatId, entry }`.
- [ ] 3.2 Subscribe `MemoryGrowthCapture.onWhiteboardEntry` to that emitter.
- [ ] 3.3 Implement the type→category mapping (`decision`→`context i=2`, `constraint`→`context i=3`, archived `open_question`→`feedback i=2`).
- [ ] 3.4 Integration test: write a `decision` via `bash ai-assets/skills/whiteboard/scripts/wb-write.sh`, assert `MemoryStore.listByAgent(agentId)` contains it once. Write the same entry id again, assert still one row.

## 4. Server: evolution feed endpoint

- [ ] 4.1 Add `server/routes/agent/evolutionRoutes.ts` exposing `GET /api/agents/:id/evolution` returning `EvolutionEntry[]` per `design.md §B.4`.
- [ ] 4.2 Register the route in `server/startup/routeSetup.ts`.
- [ ] 4.3 Unit test: seed the store with 3 memories + 1 growth-level transition, assert response shape and ordering.

## 5. Server: workspace dir seeding

- [ ] 5.1 In `server/services/WorkspaceSeeder.ts` add `await mkdir(join(workspaceDir, 'memory'), { recursive: true })`.
- [ ] 5.2 Smoke test: remove `~/.openteam/agents/architect/memory/` if present, boot the server, assert the directory exists after seeding.

## 6. Adjacent bug: Sensei prompt asset

- [ ] 6.1 Create `ai-assets/agents/sensei/AGENTS.md` with a minimal Sensei system-prompt body (the one currently inlined in `SenseiUpgradeService` tests, hoisted into the asset so the runtime can read it).
- [ ] 6.2 Verify the file is included by the bundle script (`bundle-store` / `WorkspaceSeeder`'s asset copy).
- [ ] 6.3 Regression test: call `SenseiUpgradeService.loadSenseiPrompt()` and assert it returns the body without throwing.

## 7. Web: surface the evolution feed

- [ ] 7.1 Add `web/services/agentEvolutionService.ts` calling `GET /api/agents/:id/evolution`.
- [ ] 7.2 Add `web/hooks/useAgentEvolution.ts` (SWR-style fetch hook matching the existing patterns in `web/hooks/`).
- [ ] 7.3 Wire `EvolutionLog` into `AgentEditorPage.tsx:452` `growthRecord` section. Keep the existing empty-state copy as the fallback when `entries.length === 0`.
- [ ] 7.4 Visual check via Playwright skill: open `AgentEditorPage` for `architect` after seeding one memory and one completed task; assert the timeline shows two entries.

## 8. End-to-end verification

- [ ] 8.1 Run server + web locally. Open a chat with `architect`, write a `decision` entry, complete one task via mailbox. Open the agent editor and confirm both events appear.
- [ ] 8.2 Open the same agent's next chat. Confirm the `## Cross-Session Memory` section in the agent's system prompt is non-empty (inspect via the existing `dev-inspector` route or by logging `ConfigCompiler` output in dev mode).
- [ ] 8.3 Document the verification steps in the proposal's `review.md` once the change moves to the Verify phase.
