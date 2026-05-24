# Tasks: Cleanup Codebase Redundancy

## Phase 0: Pre-flight

- [ ] Confirm with Lead: are demo pages `/demo/mention` or `/demo/queue` referenced in onboarding or external docs? (resolves `design.md` Open Question 1)
- [ ] Grep `/demo/mention`, `/demo/queue`, `MentionInputDemo`, `QueuedMessagesBarDemo` across `openspec/`, `prd/`, `docs/`, `research/`, `README.md` and update or delete stale references

## Phase 1: Time-format consolidation (lowest risk, do first)

- [ ] Create `web/lib/format.ts` with `formatDuration(ms, opts?)` and `formatRelative(source, t?)` per `design.md` D2/D3
- [ ] Add unit tests `web/__tests__/lib/format.test.ts` covering: ms < 1s, seconds, minutes, hours, days; `precise: true|false`; `t` provided vs absent
- [ ] Replace `formatDuration` in `web/components/chat/sidebar/ExecutionLogPanel.tsx:141`
- [ ] Replace `formatDuration` in `web/components/agent/AgentDNA.tsx:217`
- [ ] Replace `formatDuration` in `web/components/dev/panels/PipelineStage.tsx:26`
- [ ] Replace `formatRelative` in `web/components/chat/sidebar/WhiteboardSidebar.tsx:63`
- [ ] Replace `formatRelative` in `web/components/chat/whiteboard/flow/WhiteboardFlowView.tsx:68`
- [ ] Replace `formatRelative` in `web/components/chat/whiteboard/flow/SpanNode.tsx:31`
- [ ] Run `npm run typecheck` and any visual regression workflow; capture screenshots of the 6 affected surfaces before/after for the verify report

## Phase 2: Demo page deletion

- [ ] Delete `web/pages/MentionInputDemo.tsx`
- [ ] Delete `web/pages/QueuedMessagesBarDemo.tsx`
- [ ] Remove lazy imports and `<Route>` entries in `web/App.tsx:13-14, 43-44`
- [ ] Update `openspec/changes/add-product-strategist-agent/tasks.md:29` — strike the bullet that flags MentionInputDemo as legacy (or note it as resolved)
- [ ] Run `npm run typecheck` and `npm run build`

## Phase 3: Notch feature removal (highest blast radius, do last)

- [ ] Delete `electron/modules/NotchManager.ts`
- [ ] Delete `electron/notch-preload.ts`
- [ ] Delete `electron/native/` directory (native addon source)
- [ ] Delete `web/notch-panel/` directory (NotchApp, components, hooks, html, main.tsx, types.d.ts)
- [ ] Remove notch wiring from `electron/modules/ShortcutManager.ts` (import on line 4, field on line 8, `setNotchManager` method on lines 12-13, `toggle()` call on line 18) — verify no other shortcuts depend on it
- [ ] Remove `electron/main.ts:16` (NotchManager import), `:97` (notchManager var), `:188-195` (commented init block), `:233` (destroy hook)
- [ ] Remove `build:notch-addon` script from `package.json:33`
- [ ] Remove `electron/notch-preload.ts` esbuild step from `package.json:29` (`build:electron:main`)
- [ ] Remove notch entry/import from `vite.config.ts` if present
- [ ] Verify `grep -rn "notch\|Notch" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.html" .` returns only history/comments owned by other concerns
- [ ] Run `npm run build` end-to-end; confirm no build warnings about missing modules
- [ ] Smoke-test the Electron app: launch, full-screen toggle, global shortcut, app quit — none should reference `notchManager`

## Phase 4: Rule sharpening

- [ ] Update `CLAUDE.md` rule 6 with the comment-block clause: "Commented or disabled code blocks MUST carry a `// TODO(#issue|owner): recovery condition` comment. Otherwise delete." Add a 4-line concrete example.
- [ ] Add the same clause as a one-liner in `openspec/AGENTS.md` Quick Reference

## Phase 5: Verify and archive

- [ ] Run `openspec validate cleanup-codebase-redundancy --strict`
- [ ] Write `openspec/changes/cleanup-codebase-redundancy/review.md` per project review template (Code Review section + Architecture section)
- [ ] After approval: archive per `openspec/AGENTS.md` workflow (move spec deltas into `openspec/specs/`)

## Dependencies

- Phase 1 is independent and can ship alone
- Phase 2 is independent and can ship alone
- Phase 3 depends on nothing in this list, but is the riskiest — schedule when an Electron-capable reviewer is available
- Phase 4 should ship in the same PR as Phase 3 (so the rule lands together with the example case it cleans up)
- Phase 0's grep step blocks Phase 2's deletion
