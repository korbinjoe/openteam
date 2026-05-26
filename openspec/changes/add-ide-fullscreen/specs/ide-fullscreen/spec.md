# Spec: IDE Fullscreen Mode

## Overview

The IDE fullscreen mode lets the user lift the entire WebIDE region (file
tree, editor tabs, terminal, view tabs — Files / War room / Browser /
Changes) out of its column and expand it to cover the full app window via a
`fixed inset-0` overlay. The IDE component is not remounted, so all
in-memory state — open tabs, Monaco models, terminal PTY sessions, selected
view tab, tree width, terminal height — survives the toggle.

## ADDED Requirements

### Requirement: Fullscreen toggle covers the full app window

The WebIDE MUST provide a fullscreen mode that, when enabled, makes the
entire IDE region cover the full app viewport via `fixed inset-0` styling
without remounting the panel.

#### Scenario: Header button enters fullscreen

**Given** the WebIDE is rendered in its column (any view tab)
**When** the user clicks the Maximize icon in the IDE top tab bar
**Then** the IDE container gains `fixed inset-0 z-[90] h-screen w-screen`
**And** the file tree, editor tabs, terminal, and selected view tab remain
  rendered with their prior content
**And** Monaco editors continue rendering the same models with cursor and
  scroll preserved

#### Scenario: Header button exits fullscreen

**Given** the IDE is in fullscreen mode
**When** the user clicks the Minimize icon in the IDE top tab bar
**Then** the IDE container loses the fullscreen classes
**And** the IDE returns to its column position with all state preserved

#### Scenario: Keyboard shortcut toggles fullscreen

**Given** the WebIDE is mounted (not collapsed)
**When** the user presses `⌘⇧F` (or `Ctrl+Shift+F` on non-mac platforms)
**Then** fullscreen toggles between on and off
**And** the browser default behavior for `⌘⇧F` is suppressed via
  `e.preventDefault()`

#### Scenario: Command Palette toggles fullscreen

**Given** the user has opened the Command Palette via `⌘K`
**When** the user selects **Toggle IDE Fullscreen**
**Then** the `ide:toggle-fullscreen-ide` window event fires
**And** the IDE flips its fullscreen state

### Requirement: All in-memory IDE state survives toggling fullscreen

Toggling fullscreen MUST NOT remount the WebIDE or any of its descendant
trees, so heavy in-memory state is preserved without serialization.

#### Scenario: Open tabs and Monaco state survive

**Given** the user has multiple files open with unsaved edits in one tab
**When** the user toggles fullscreen on and off
**Then** the open-tab list, active tab, dirty indicator, scroll position,
  and Monaco editor content for each tab are unchanged

#### Scenario: Terminal PTY sessions survive

**Given** the user has the IDE terminal open with running processes
**When** the user toggles fullscreen on and off
**Then** the terminal PTY session, its output buffer, and any running
  process continue without interruption

#### Scenario: View tab selection survives

**Given** the user has the **Changes** or **War room** or **Browser** tab
  selected in the IDE
**When** the user toggles fullscreen
**Then** the same view tab remains selected

### Requirement: Esc exit yields to Monaco and inputs

When the IDE is fullscreen, pressing Esc MUST exit fullscreen — except when
the keystroke target is owned by Monaco or a text input.

#### Scenario: Esc on empty area exits fullscreen

**Given** the IDE is in fullscreen mode and focus is on the IDE chrome
  (header, file tree row, terminal tab, etc.) but not inside Monaco or an
  input
**When** the user presses `Esc`
**Then** fullscreen exits

#### Scenario: Esc inside Monaco does not exit

**Given** the IDE is in fullscreen mode and focus is inside a Monaco editor
**When** the user presses `Esc`
**Then** Monaco handles the keystroke (e.g. closes the find widget, exits
  suggest mode)
**And** fullscreen does NOT exit

#### Scenario: Esc inside a text input does not exit

**Given** the IDE is in fullscreen mode and focus is on an `<input>`,
  `<textarea>`, or `[contenteditable="true"]` element
**When** the user presses `Esc`
**Then** fullscreen does NOT exit

### Requirement: Z-index ordering keeps overlays usable above fullscreen

The fullscreen overlay MUST sit below the Command Palette and toast
surfaces so they remain dismissible from above.

#### Scenario: Command Palette renders above fullscreen IDE

**Given** the IDE is in fullscreen mode
**When** the user opens the Command Palette via `⌘K`
**Then** the palette renders above the IDE (palette `z-[100]` vs. IDE
  `z-[90]`)
**And** clicking on the palette backdrop closes the palette without
  affecting the fullscreen state

#### Scenario: Toast notifications render above fullscreen IDE

**Given** the IDE is in fullscreen mode
**When** a toast notification is dispatched
**Then** the toast renders above the fullscreen IDE

### Requirement: Command Palette mounts the IDE before toggling when collapsed

The Command Palette toggle MUST mount the IDE first if it is currently
collapsed, so the panel exists to receive the fullscreen toggle event.

#### Scenario: Toggle from collapsed IDE state

**Given** the IDE is collapsed (`ideCollapsed === true`)
**When** the user invokes the Command Palette command **Toggle IDE
  Fullscreen**
**Then** `toggleIde()` is called to mount the IDE panel
**And** on the next tick, `ide:toggle-fullscreen-ide` is dispatched so the
  newly mounted panel can receive it
**And** the IDE renders in fullscreen

### Requirement: Font-size selector with persistence

The IDE top tab bar MUST provide S / M / L font-size buttons that affect
the Monaco editor `fontSize` and the markdown preview root `fontSize`.

#### Scenario: Selecting S sets 12px

**Given** the IDE is rendered with any file open
**When** the user clicks the **S** button in the IDE top tab bar
**Then** the Monaco editor's `fontSize` option becomes 12
**And** the markdown preview root element's computed font-size becomes 12px
**And** `localStorage('webide:reader')` stores `{"fontSize":"S"}`

#### Scenario: Selecting L sets 16px

**Given** the IDE is rendered
**When** the user clicks the **L** button
**Then** Monaco `fontSize` = 16, markdown root font-size = 16px

#### Scenario: Font-size preference survives page reload

**Given** the user previously selected **L**
**When** the page reloads and the IDE mounts
**Then** the fontSize state initializes to 'L' from localStorage
**And** Monaco and markdown preview render at 16px

### Requirement: Markdown preview horizontal centering

Markdown preview content MUST be horizontally centered within its container
to provide a comfortable reading column regardless of available width.

#### Scenario: Markdown centered in fullscreen

**Given** the IDE is in fullscreen mode with a markdown file previewed
**Then** the `.md-preview` wrapper has `max-w-[760px] mx-auto`
**And** the markdown block is horizontally centered in the viewport

#### Scenario: Markdown unchanged in narrow column

**Given** the IDE column width is narrower than 760px with a markdown preview
**Then** `mx-auto` produces no visible offset (content fills the column
  naturally)
