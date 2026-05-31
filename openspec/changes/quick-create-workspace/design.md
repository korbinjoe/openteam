# Design: Quick Create Workspace

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Frontend (WorkspacesPage)                          │
│                                                     │
│  handleQuickCreate()                                │
│    ├── isElectron?                                  │
│    │   ├── YES → openteamBridge.pickDirectory()     │
│    │   │         → returns string | null            │
│    │   └── NO  → open DirPickerDialog              │
│    │             → onPick(path) callback            │
│    │                                                │
│    └── onPathSelected(path)                         │
│         ├── POST /api/workspaces/quick-start        │
│         │   { repoPath: path }                      │
│         ├── Response: { workspace, isExisting }     │
│         ├── toast (created vs already exists)       │
│         └── navigate(`/workspace/${ws.id}`)         │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Electron Main Process                              │
│                                                     │
│  ipcMain.handle('pick-directory', async () => {     │
│    const result = await dialog.showOpenDialog({     │
│      properties: ['openDirectory'],                 │
│      title: 'Select Project Folder',               │
│    })                                               │
│    return result.canceled ? null                    │
│         : result.filePaths[0]                       │
│  })                                                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  Backend (existing quick-start endpoint)            │
│                                                     │
│  POST /api/workspaces/quick-start                   │
│    1. findByRepoPath(path)                          │
│    2. if found → return { workspace, isExisting }   │
│    3. if not → create({ repositories: [{ path }] }) │
│       name = basename(path)                         │
│    4. return { workspace, isExisting: false }       │
└─────────────────────────────────────────────────────┘
```

## Decisions

### D1: Reuse `quick-start` endpoint vs new endpoint

**Decision**: Reuse existing `POST /api/workspaces/quick-start` with a minor extension.

**Rationale**: The endpoint already implements find-or-create semantics with `findByRepoPath`. The only change needed is returning an `isExisting` flag so the frontend can show the correct toast message, and adding a `skipChat: true` option to avoid creating an empty chat session on workspace creation.

### D2: Electron uses native dialog, not DirPickerDialog

**Decision**: Electron calls `dialog.showOpenDialog` for folder selection.

**Rationale**: Native dialog provides OS-level UX (favorites, sidebar, search, recent folders) with zero maintenance cost. The custom DirPickerDialog exists because web browsers cannot access the filesystem directly — Electron has no such limitation.

### D3: What happens to CreateWorkspaceDialog

**Decision**: Keep the component but remove it from the primary creation flow. The "+ New" button triggers quick-create directly. Advanced multi-repo creation can be added back later as a menu option if needed.

**Rationale**: Multi-repo workspaces are <20% of usage. Optimizing for the majority single-repo case is the right default.

### D4: Name collision handling

**Decision**: Backend `WorkspaceStore.create` already uses `basename(path)` as the name. Since `findByRepoPath` prevents duplicate paths, the only collision case is two different paths with the same basename (e.g., `~/work/app` and `~/personal/app`). These are allowed — duplicate names are fine, they're disambiguated by path in the UI.

**Rationale**: Auto-suffixing adds complexity for a rare edge case. Users can rename post-creation.

## API Changes

### Modified: `POST /api/workspaces/quick-start`

Add optional `skipChat` field and `isExisting` response flag:

```typescript
// Request (new optional field)
interface QuickStartRequest {
  repoPath?: string
  repoPaths?: string[]
  model?: string
  agentId?: string
  workspaceId?: string
  title?: string
  skipChat?: boolean  // NEW: if true, don't create initial chat
}

// Response (new field)
interface QuickStartResponse {
  workspace: Workspace
  chat?: Chat          // undefined when skipChat=true
  isExisting: boolean  // NEW: true if workspace already existed
}
```

### New: Electron IPC channel `pick-directory`

```typescript
// preload.ts addition
pickDirectory: () => ipcRenderer.invoke('pick-directory') as Promise<string | null>
```

## Component Changes

| File | Change |
|------|--------|
| `web/pages/WorkspacesPage.tsx` | Replace `openCreateDialog()` with `handleQuickCreate()` |
| `web/pages/WorkspacesPage.tsx` | Remove `CreateWorkspaceDialog` rendering (or gate behind advanced mode) |
| `web/hooks/useDirPicker.ts` | Minor: add a `openDirPickerForQuickCreate` mode |
| `electron/preload.ts` | Add `pickDirectory` to bridge |
| `electron/modules/IPCBridge.ts` | Add `pick-directory` IPC handler |
| `electron/types.d.ts` | Add `pickDirectory` to bridge type |
| `server/routes/workspace/workspaceApiRoutes.ts` | Add `skipChat` + `isExisting` to quick-start |
