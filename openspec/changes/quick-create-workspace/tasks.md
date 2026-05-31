# Tasks: Quick Create Workspace

## Implementation Order

### Phase 1: Backend (no frontend dependencies)

- [x] **T1**: Extend `POST /api/workspaces/quick-start` — add `skipChat` option and `isExisting` response flag
  - File: `server/routes/workspace/workspaceApiRoutes.ts`
  - Validation: existing callers unaffected (both fields optional, `isExisting` is additive)

### Phase 2: Electron IPC (no frontend dependencies)

- [x] **T2**: Add `pick-directory` IPC handler in `electron/modules/IPCBridge.ts`
  - Calls `dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select Project Folder' })`
  - Returns `string | null`
- [x] **T3**: Expose `pickDirectory()` in `electron/preload.ts` via contextBridge
- [x] **T4**: Update `electron/types.d.ts` bridge interface with `pickDirectory` method

### Phase 3: Frontend (depends on T1-T4)

- [x] **T5**: Add `handleQuickCreate()` in `WorkspacesPage.tsx`
  - Electron path: call `window.openteamBridge.pickDirectory()` → on result → call quick-start API → navigate
  - Web path: open DirPickerDialog in quick-create mode → on pick → call quick-start API → navigate
- [x] **T6**: Wire "+ New" button to `handleQuickCreate()` instead of `openCreateDialog()`
- [x] **T7**: Show appropriate toast: "Workspace created" vs "Navigating to existing workspace"
- [x] **T8**: Remove `CreateWorkspaceDialog` from render tree (keep file for potential future "advanced" mode)

### Phase 4: Cleanup

- [x] **T9**: Remove unused state: `createOpen`, `createName`, `createRepos`, `creating` from WorkspacesPage
- [x] **T10**: Remove `handleAddRepoToCreateWs`, `handleQuickSelectRepo` handlers

## Parallelization

- T1, T2/T3/T4 can run in parallel (backend vs electron, no dependencies)
- T5-T8 must follow T1-T4
- T9-T10 follow T8

## Verification

- Electron: click "+ New" → native folder dialog opens → select folder → workspace appears in list and app navigates into it
- Web: click "+ New" → DirPickerDialog opens → navigate folders / search → select → same result
- Duplicate path: select a folder that already has a workspace → toast says "already exists" → navigates to existing one
- Cancel: dismiss the picker → nothing happens, no state change
