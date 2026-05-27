# Splash Screen Spec

## ADDED Requirements

### Requirement: Instant visual feedback on app launch

The app must display branded visual feedback within 100ms of the Electron window being created, before the React app or Express server has initialized.

#### Scenario: Cold start on macOS

**Given** the user launches OpenTeam from Dock or Spotlight
**When** Electron creates the main BrowserWindow
**Then** a splash screen appears within 100ms showing the OpenTeam logo, wordmark, and loading indicator
**And** the splash persists until the React app signals ready via IPC

#### Scenario: Warm start (app already in memory)

**Given** the app was recently closed and OS has cached resources
**When** the user re-launches OpenTeam
**Then** the splash appears and transitions within 1-2s (reduced boot time)
**And** the animation gracefully shortens or skips if boot completes before animation sequence finishes

### Requirement: Smooth transition to main application

The splash must dissolve into the main application without visual jarring.

#### Scenario: Normal transition

**Given** the splash is visible and React app has mounted
**When** the app signals ready via `ipcRenderer.send('app-ready')`
**Then** the splash fades out with a 400ms scale+blur animation
**And** the main window becomes visible simultaneously

#### Scenario: Slow boot (>5s)

**Given** the splash has been visible for more than 5 seconds
**When** all entry animations have completed
**Then** the loading indicator (agent dots) continues cycling
**And** the status text updates to show current initialization step
**And** no timeout error is shown (boot continues indefinitely)

### Requirement: Platform-appropriate window behavior

#### Scenario: macOS frameless window

**Given** the app is running on macOS
**When** the splash window is created
**Then** it is frameless (no title bar), non-resizable, and centered on the primary display
**And** it supports the `-webkit-app-region: drag` for repositioning
**And** it renders at native retina resolution
