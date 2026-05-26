# Add IDE Fullscreen Mode

## Summary

Add a fullscreen toggle to the WebIDE panel so the user can lift the entire
IDE region (file tree, editor tabs, terminal, view tabs — Files / War room /
Browser / Changes) out of the right column and into a `fixed inset-0`
overlay covering the whole window. CSS-only — the panel is not remounted, so
all in-memory state (open tabs, Monaco models, scroll, terminal sessions,
selected view tab) survives the toggle.

## Why

When reading or editing a long source file, design doc, or large
markdown/diff, the IDE panel's column width is the bottleneck. Pulse-mode
review of agent-produced changes — diffing, reading, occasionally editing —
benefits from temporarily reclaiming the full window without disturbing the
chat or sidebar layout. The original proposal solved this with a separate
single-file overlay, but during review we found that the user almost always
needs the file tree and terminal alongside the file being read; a
single-file overlay would re-introduce its own state (a second Monaco
instance, separate tab list) and drift from the inline editor.

## Goals

- Toggle entire IDE region between in-column and fullscreen via:
  1. Header button (Maximize2 / Minimize2 icon in the top tab bar).
  2. Keyboard shortcut `⌘⇧F` while focus is anywhere in the IDE region.
  3. Command Palette action **Toggle IDE Fullscreen**.
- All existing IDE state (tabs, Monaco models, terminal PTY sessions,
  selected view tab, tree width, terminal height) survives the toggle.
- Esc exits fullscreen unless the keystroke is owned by Monaco / an input
  field — Monaco gets first dibs; user can press Esc once more on empty
  focus.

## Non-Goals

- New file-reading UI, font-size selector, or markdown-only preview mode —
  reuse what `EditorTabs.tsx` already renders.
- Persisting fullscreen state across reloads — fullscreen is an ephemeral
  mode, like maximizing a panel.
- Multi-window / detach-to-window. Out of scope.

## Approach

Add an `isFullScreen` boolean to `WebIDEPanel`. When `true`, the panel's
outer container swaps from `h-full flex flex-col …` to `fixed inset-0
z-[90] h-screen w-screen …`. The DOM tree underneath is unchanged — Monaco,
the terminal, the file tree, all view tabs continue rendering in place.

Triggers are unified by a single window event `ide:toggle-fullscreen-ide`
(the header button and CommandPalette dispatch it; the shortcut and Esc
handlers call `setIsFullScreen` directly). The Command Palette also calls
`toggleIde()` first if the IDE is collapsed, so the panel mounts before the
event fires.

## Risks

- **Monaco resize**: `automaticLayout: true` is already on; Monaco
  re-measures on container size change without manual intervention.
- **Z-index collisions**: CommandPalette uses `z-[100]` (above the
  fullscreen overlay so the palette can dismiss it from on top); sonner
  toasts use a higher index by default.
- **Esc capture**: Monaco binds Esc for its own actions (close find widget,
  exit suggest, etc.). The Esc handler scopes itself to non-Monaco /
  non-input targets so editor UX is preserved.
- **Collapsed IDE + ⌘⇧F**: shortcut won't fire because `WebIDEPanel` isn't
  mounted. CommandPalette handles this path explicitly; the keyboard
  shortcut path is intentionally a no-op when the IDE is collapsed.
