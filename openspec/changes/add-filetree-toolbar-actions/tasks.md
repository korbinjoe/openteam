# Tasks: Add FileTree Toolbar Actions

## Implementation

- [x] Add `getActiveDirectory` helper function in FileTree that resolves target dir from `selectedFile`
- [x] Add "New File" and "New Folder" toolbar buttons to the FileTree header
- [x] Wire toolbar buttons to `actions.handleNewFile` / `actions.handleNewFolder` with active directory
- [x] Ensure target directory is expanded before showing inline input (reuse `ensureDirExpanded`)
- [x] Add keyboard shortcut listener (Cmd+N / Cmd+Shift+N) scoped to FileTree container
- [x] Verify inline input appears correctly when triggered from toolbar (root-level and nested directory cases)
