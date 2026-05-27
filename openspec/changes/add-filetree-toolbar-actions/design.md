# Design: FileTree Toolbar Actions

## Architecture

This change is purely frontend — no new API endpoints needed. The existing `/api/file-create` and `/api/mkdir` endpoints are reused.

## Component Changes

### `web/components/ide/FileTree.tsx`

Add two icon buttons to the toolbar header section (lines ~1009-1030), between the search button and the show-ignored toggle:

```tsx
<button onClick={handleToolbarNewFile} title={t('fileTree.newFile')}>
  <FilePlus size={12} />
</button>
<button onClick={handleToolbarNewFolder} title={t('fileTree.newFolder')}>
  <FolderPlus size={12} />
</button>
```

### Active Directory Resolution

Logic to determine where the new file/folder should be created:

```
1. If selectedFile points to a directory → use that directory
2. If selectedFile points to a file → use its parent directory
3. If nothing selected → use primaryRoot
```

This reuses the same pattern already in `handleMenuAction('new-file')`.

### Keyboard Shortcuts

Add a `useEffect` with `keydown` listener on the FileTree container div:
- `Cmd+N` (Mac) / `Ctrl+N` (Win) → New File
- `Cmd+Shift+N` / `Ctrl+Shift+N` → New Folder

Only active when the FileTree container has focus (check `document.activeElement` is within the tree).

## Decisions

- **Button placement**: After search, before show-ignored toggle — mirrors VS Code explorer toolbar ordering
- **No separate "active directory" state**: Derive from `selectedFile` prop to avoid state duplication
- **Keyboard scope**: Container-level listener, not global — prevents conflicts with editor shortcuts

## Files Affected

| File | Change |
|------|--------|
| `web/components/ide/FileTree.tsx` | Add toolbar buttons + keyboard handler |
| (no other files) | All action logic already exists in `useFileTreeActions` |
