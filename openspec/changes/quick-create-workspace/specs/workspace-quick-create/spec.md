# Capability: Workspace Quick Create

One-click workspace creation by selecting a project folder. Eliminates the multi-step creation dialog.

## ADDED Requirements

### Requirement: One-click workspace creation from folder selection

The system SHALL allow users to create a workspace by selecting a single folder, with no additional form inputs required.

#### Scenario: User clicks "+ New" in Electron and selects a folder

Given the user is on the Workspaces page in the Electron app
When the user clicks the "+ New" button
Then the system opens the native OS folder selection dialog
When the user selects a folder (e.g., `~/work/ai-saas-app`)
Then a workspace is created with name "ai-saas-app" and that folder as its single repository
And the app navigates into the new workspace

#### Scenario: User clicks "+ New" in Web and selects a folder

Given the user is on the Workspaces page in a web browser
When the user clicks the "+ New" button
Then the DirPickerDialog opens directly (no intermediate creation dialog)
When the user navigates to and selects a folder
Then a workspace is created with name derived from the folder's basename
And the app navigates into the new workspace

#### Scenario: User cancels the folder selection

Given the folder selection dialog is open (native or web)
When the user cancels or dismisses the dialog
Then no workspace is created
And the Workspaces page remains unchanged

### Requirement: Deduplication — existing workspace for selected path

The system MUST NOT create duplicate workspaces for the same folder path.

#### Scenario: Selected folder already belongs to a workspace

Given a workspace "my-project" already exists with repository path `~/work/my-project`
When the user triggers quick-create and selects `~/work/my-project`
Then no new workspace is created
And the app navigates to the existing "my-project" workspace
And a toast displays "This project is already in workspace \"my-project\""

### Requirement: Electron native folder dialog via IPC

The Electron main process MUST expose a `pick-directory` IPC channel for native folder selection.

#### Scenario: Renderer invokes pickDirectory and user selects a folder

Given the Electron app is running
When the renderer calls `window.openteamBridge.pickDirectory()`
Then the main process opens a native `showOpenDialog` with `openDirectory` property
When the user selects a folder
Then the promise resolves with the absolute path string

#### Scenario: Renderer invokes pickDirectory and user cancels

Given the Electron app is running
When the renderer calls `window.openteamBridge.pickDirectory()`
And the user cancels the native dialog
Then the promise resolves with `null`

## MODIFIED Requirements

### Requirement: Quick-start API supports workspace-only creation

The existing `POST /api/workspaces/quick-start` endpoint MUST support a `skipChat` option to create/find a workspace without also creating a chat session.

#### Scenario: Client sends skipChat=true

Given a valid `repoPath` is provided with `skipChat: true`
When the endpoint processes the request
Then a workspace is created (or found) for that path
And no chat session is created
And the response includes `{ workspace, isExisting: boolean }` without a `chat` field

#### Scenario: Existing callers without skipChat are unaffected

Given a client calls quick-start without `skipChat` (or with `skipChat: false`)
When the endpoint processes the request
Then behavior is identical to current: workspace is created/found AND a chat is created
And the response includes both `workspace` and `chat` fields
