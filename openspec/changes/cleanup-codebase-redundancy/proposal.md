# Proposal: Cleanup Codebase Redundancy

## Summary

Remove dead code paths and consolidate duplicated utilities surfaced by a redundancy review of `server/`, `web/`, `cli/`, `shared/`, and `electron/` (506 TS/TSX files). Two concrete cleanups (notch feature, time-format utilities) plus one rule alignment (oversized files / commented-out code) — no behavior change for end users.

## Motivation

A redundancy scan on 2026/05/24 found:

1. **Notch feature is built but never started.** `electron/main.ts:188-195` has the `NotchManager` initialization block commented out without a TODO; the manager instance is permanently `null`. The full chain (`NotchManager.ts` 313 lines, `web/notch-panel/` 528 lines, native addon, preload, dedicated build script) still ships in the bundle and slows the build, but no entry point reaches it. `electron/main.ts:233`'s `notchManager?.destroy()` is a permanent no-op; `ShortcutManager.setNotchManager`/`toggle` (electron/modules/ShortcutManager.ts:8-18) are never called.
2. **`formatDuration` exists in 3 places with incompatible output formats** — `web/components/chat/sidebar/ExecutionLogPanel.tsx:141`, `web/components/agent/AgentDNA.tsx:217`, `web/components/dev/panels/PipelineStage.tsx:26`.
3. **`formatRelative` exists in 3 places with the same i18n keys but different code** — `web/components/chat/sidebar/WhiteboardSidebar.tsx:63`, `web/components/chat/whiteboard/flow/WhiteboardFlowView.tsx:68`, `web/components/chat/whiteboard/flow/SpanNode.tsx:31`.
4. **Project rule 6 is silently violated.** Total `TODO|FIXME|HACK` count across all source: 1. The `electron/main.ts:188-195` comment block is the clearest violation — code is commented out without a TODO link or recovery condition.
5. **Two demo pages on `/demo/*` routes are flagged legacy** in another openspec change (`openspec/changes/add-product-strategist-agent/tasks.md:29`) but still ship: `web/pages/MentionInputDemo.tsx` (622 lines), `web/pages/QueuedMessagesBarDemo.tsx` (60 lines).

These items don't break the product, but they cost build time, confuse readers, and let the same time-formatting logic drift across views (whiteboard already shows different relative-time strings for the same timestamp depending on which surface renders it).

## Goals

1. Remove the notch feature end-to-end (or, if Product wants to keep the option open, gate its build behind a flag — see `design.md`).
2. Consolidate `formatDuration` and `formatRelative` into a single `web/lib/format.ts` module.
3. Delete the two flagged demo pages (`MentionInputDemo`, `QueuedMessagesBarDemo`) and their `/demo/*` routes.
4. Establish a documented rule: any commented-out code block must carry a `TODO(#issue|owner): condition` comment, otherwise it must be deleted. Reflect in `CLAUDE.md` rule 6.

## Non-Goals

- Splitting the 22 files >500 lines. Each is its own architectural decision (e.g. `FileTree.tsx` 1177 lines) and warrants per-file proposals; this change only documents the violation list.
- Restructuring the whiteboard, IDE, or input area features.
- Adding new lint rules or CI gates (we record the rule in `CLAUDE.md`; tooling enforcement is a separate proposal).
- Changing user-visible time-format output. The consolidated helper preserves whichever variant is most common per surface; minor visual differences are accepted only where surfaces today already disagree.

## Approach

### 1. Notch feature removal (preferred path)

Delete the entire chain in one commit:

- `electron/modules/NotchManager.ts`
- `electron/notch-preload.ts` and its esbuild step in `package.json`
- `electron/native/` (native addon) and the `build:notch-addon` script
- `web/notch-panel/` (NotchApp, components, hooks, html, main.tsx, types.d.ts)
- `electron/modules/ShortcutManager.ts` notch wiring (lines 4, 8, 12-13, 18)
- `electron/main.ts:16,97,188-195,233` (import, var, commented init block, destroy hook)
- `vite.config.ts` notch entry (verify after removal)

Alternative considered in `design.md`: keep the code but gate behind a `OPENTEAM_ENABLE_NOTCH=1` env flag. Rejected unless Product confirms the feature is on a near-term roadmap.

### 2. Time-format consolidation

Create `web/lib/format.ts` exporting:

```ts
export const formatDuration = (ms: number, opts?: { precise?: boolean }) => string
export const formatRelative = (
  iso: string | number,
  t?: (key: string, opts?: Record<string, unknown>) => string,
) => string
```

`formatRelative` accepts an optional `t` translator. When omitted it falls back to short English (`s/m/h/d`) — that's the current SpanNode behavior. When provided it uses the existing `whiteboard.timeAgo.*` keys.

Replace all 6 inline implementations and remove the now-unused locals.

### 3. Demo pages

Delete `web/pages/MentionInputDemo.tsx`, `web/pages/QueuedMessagesBarDemo.tsx` and the two `/demo/*` Route entries plus lazy imports in `web/App.tsx:13-14, 43-44`.

### 4. Document the comment-block rule

Update project `CLAUDE.md` rule 6 with a sharper definition and a single example. Add the same rule to `openspec/AGENTS.md` Quick Reference so future agents enforce it.

## Risks

- **Notch removal regret.** If Product still wants the notch UI later, restoring 800+ lines is non-trivial. Mitigation: keep the deletion as one squashable commit so revert is mechanical. `design.md` records the build-flag alternative.
- **Time-format visual drift.** Consolidating could change a few digits in tooltips. Mitigation: snapshot screenshots of `ExecutionLogPanel`, `AgentDNA`, `PipelineStage`, `WhiteboardSidebar`, `WhiteboardFlowView`, `SpanNode` before/after.
- **Demo page link rot.** `/demo/*` may be referenced in docs or external links. Mitigation: grep `/demo/mention`, `/demo/queue` across `openspec/`, `prd/`, `docs/`, `research/` and update or note as broken.

## Out-of-Scope (Recorded for Follow-up)

Files above 500 lines that violate project rule 6 — recorded here, not changed in this proposal:

| File | Lines |
|---|---|
| `web/components/ide/FileTree.tsx` | 1177 |
| `server/routes/workspace/worktreeRoutes.ts` | 756 |
| `web/pages/AgentEditorPage.tsx` | 740 |
| `server/dev/DevInspector.ts` | 719 |
| `web/components/chat/input/InputArea.tsx` | 686 |
| `server/runtime/ConfigCompiler.ts` | 659 |
| `web/components/changes/CommitPanel.tsx` | 655 |
| `web/pages/UpdateManagerPage.tsx` | 601 |
| `web/components/chat/messages/AgentTurnCard.tsx` | 595 |
| `server/acp/CliACPAdapter.ts` | 592 |
| `web/components/chat/ChatInstance.tsx` | 586 |
| `server/services/scanner/SessionPager.ts` | 585 |
| `web/lib/whiteboardLayout.ts` | 579 |
| `web/components/terminal/TerminalPanel.tsx` | 578 |
| `server/ws/ExpertResumeHandler.ts` | 556 |
| `server/routes/agent/agentRoutes.ts` | 547 |
| `server/ws/ExpertHandler.ts` | 542 |
| `web/components/ide/EditorTabs.tsx` | 540 |
| `web/hooks/useAgentEditor.ts` | 533 |
| `server/config/AgentRegistry.ts` | 512 |
| `server/services/update/SenseiUpgradeService.ts` | 502 |

Each warrants its own change proposal once an owner is assigned.
