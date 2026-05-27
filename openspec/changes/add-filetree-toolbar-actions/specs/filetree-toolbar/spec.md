# Spec: FileTree Toolbar Actions

## ADDED Requirements

### Requirement: New File toolbar button

The FileTree header toolbar SHALL display a "New File" icon button that creates a new file in the active directory.

#### Scenario: User clicks New File button with a file selected

- **Given** a file `src/index.ts` is selected in the tree
- **When** the user clicks the "New File" toolbar button
- **Then** an inline input appears inside the `src/` directory for entering the new filename
- **And** the `src/` directory is expanded if it was collapsed

#### Scenario: User clicks New File button with nothing selected

- **Given** no file or directory is selected
- **When** the user clicks the "New File" toolbar button
- **Then** an inline input appears at the root level for entering the new filename

#### Scenario: User clicks New File button with a directory selected

- **Given** the directory `src/components/` is selected
- **When** the user clicks the "New File" toolbar button
- **Then** an inline input appears inside `src/components/` for entering the new filename
- **And** the directory is expanded if it was collapsed

### Requirement: New Folder toolbar button

The FileTree header toolbar SHALL display a "New Folder" icon button that creates a new directory in the active directory.

#### Scenario: User clicks New Folder button with a file selected

- **Given** a file `src/App.tsx` is selected
- **When** the user clicks the "New Folder" toolbar button
- **Then** an inline input appears inside `src/` for entering the new folder name

#### Scenario: User clicks New Folder button with nothing selected

- **Given** no file or directory is selected
- **When** the user clicks the "New Folder" toolbar button
- **Then** an inline input appears at the root level for entering the new folder name

### Requirement: Keyboard shortcuts for file creation

The FileTree SHALL support keyboard shortcuts for creating files and folders when the tree has focus.

#### Scenario: Cmd+N creates a new file

- **Given** the FileTree container has keyboard focus
- **When** the user presses Cmd+N (Mac) or Ctrl+N (Windows)
- **Then** an inline input appears for a new file in the active directory
- **And** the browser's default "new window" action is prevented

#### Scenario: Cmd+Shift+N creates a new folder

- **Given** the FileTree container has keyboard focus
- **When** the user presses Cmd+Shift+N (Mac) or Ctrl+Shift+N (Windows)
- **Then** an inline input appears for a new folder in the active directory

#### Scenario: Shortcuts do not fire when tree is not focused

- **Given** focus is on the code editor or terminal
- **When** the user presses Cmd+N
- **Then** the FileTree does NOT trigger new file creation
