# Tasks: Add FileTree Toolbar Actions

## Implementation

- [ ] Add `getActiveDirectory` helper function in FileTree that resolves target dir from `selectedFile`
- [ ] Add "New File" and "New Folder" toolbar buttons to the FileTree header
- [ ] Wire toolbar buttons to `actions.handleNewFile` / `actions.handleNewFolder` with active directory
- [ ] Ensure target directory is expanded before showing inline input (reuse `ensureDirExpanded`)
- [ ] Add keyboard shortcut listener (Cmd+N / Cmd+Shift+N) scoped to FileTree container
- [ ] Verify inline input appears correctly when triggered from toolbar (root-level and nested directory cases)
