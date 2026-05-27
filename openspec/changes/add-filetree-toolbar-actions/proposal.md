# Proposal: Add FileTree Toolbar Actions

## Summary

Add New File and New Folder buttons to the FileTree toolbar header, making file creation discoverable without right-click. Support keyboard shortcuts for power users.

## Motivation

Currently, creating a new file or directory in the IDE FileTree requires right-clicking to open the context menu. This interaction is not discoverable — users unfamiliar with the context menu cannot find the action. IDE convention (VS Code, WebStorm, etc.) is to provide toolbar icon buttons for frequent file operations.

## Goals

- Add "New File" and "New Folder" icon buttons to the FileTree header toolbar
- Support keyboard shortcuts (Cmd/Ctrl+N for new file in focused file tree)
- New file/folder targets the currently selected directory (or root if nothing selected)
- Maintain existing context menu behavior unchanged

## Non-Goals

- Drag-and-drop file upload (separate feature)
- Multi-file creation templates
- File scaffolding/boilerplate generation

## Approach

1. Add `FilePlus` and `FolderPlus` icon buttons to the FileTree toolbar (between search and show-ignored buttons)
2. Track "active directory" context — the parent of the selected file, or the selected directory, or root
3. Wire toolbar buttons to existing `handleNewFile` / `handleNewFolder` from `useFileTreeActions`
4. Add keyboard event listener for `Cmd+N` / `Cmd+Shift+N` when FileTree panel is focused

## Risks

- **Low**: Toolbar might feel crowded with additional icons → mitigate by keeping icons small (12px) and consistent with existing style
- **Low**: Keyboard shortcut conflicts with browser/Electron shortcuts → mitigate by only capturing when the file tree panel has focus
