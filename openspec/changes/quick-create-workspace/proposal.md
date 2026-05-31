# Proposal: Quick Create Workspace

## Summary

Reduce workspace creation from a 4-step form flow (open dialog → name → pick repo → confirm) to a single action: click "+ New" → pick a folder → done. The system auto-derives the workspace name from the folder name and navigates the user into the new workspace immediately.

## Motivation

The current creation flow has unnecessary friction:
- Two dialogs in sequence (CreateWorkspaceDialog → DirPickerDialog)
- Manual naming step (80%+ of users just use the folder name anyway)
- Explicit "Create and Start" confirmation after selection

For a product whose core principle is "attention-first", this flow consumes too many cognitive cycles for a frequent operation.

## Goals

1. Reduce workspace creation to **1 click + 1 folder pick** (2 interactions total)
2. Auto-derive workspace name from `basename(selectedPath)`
3. Deduplicate: if a workspace already exists for the selected path, navigate to it instead of creating a new one
4. Support both Electron (native OS dialog) and Web (existing DirPickerDialog)

## Non-Goals

- Multi-repo workspace creation in this flow (users can add repos post-creation)
- Removing the existing CreateWorkspaceDialog entirely (may keep as "Advanced" option, decision deferred)
- Changing the backend workspace data model

## Approach

### Electron
- Add `pickDirectory` IPC handler in main process → calls `dialog.showOpenDialog({ properties: ['openDirectory'] })`
- Expose via `openteamBridge.pickDirectory()` in preload
- Frontend calls bridge, gets path, then hits `POST /api/workspaces/quick-start` (existing endpoint)

### Web
- Click "+ New" opens `DirPickerDialog` directly (bypassing `CreateWorkspaceDialog`)
- On folder selection, call `POST /api/workspaces/quick-start` with the path
- Navigate to the workspace on success

### Backend
- `POST /api/workspaces/quick-start` already handles find-or-create semantics
- Minor adjustment: add a `skipChatCreation` option so quick-create navigates to workspace without forcing a new chat session

## Risks

| Risk | Mitigation |
|------|------------|
| Users who need multi-repo workspaces lose the creation dialog | Keep advanced creation accessible (e.g., context menu or settings) |
| Name collisions (two folders named "app") | Auto-suffix: `app` → `app-2` (backend already uses `basename` naming) |
| Electron-specific code path divergence | Thin bridge layer — core logic stays in shared frontend code |
