# Tasks: Add IDE Fullscreen Mode

## Phase 1: State + container

- [x] **Add `isFullScreen` state to `WebIDEPanel`** — local boolean,
  default `false`. Not persisted.
- [x] **Toggle outer container className** — when `isFullScreen` is true,
  outer `<div ref={panelRef}>` gets `fixed inset-0 z-[90] h-screen
  w-screen` in addition to the base layout classes (via `cn()`).

## Phase 2: Trigger surfaces

- [x] **Header toggle button** — `Maximize2` / `Minimize2` icon at the
  right end of the top tab bar (after Changes), tooltip from
  `ide.fullscreen.toggleTooltip`. Click flips `isFullScreen`.
- [x] **Window event listener** — `ide:toggle-fullscreen-ide` flips state.
  This is the bus used by surfaces that don't share React state with the
  panel (CommandPalette).
- [x] **`⌘⇧F` keyboard shortcut** — global `keydown` listener on
  `window`, calls `e.preventDefault()` to override browser default, flips
  state. Active whenever the panel is mounted.
- [x] **Esc to exit** — global `keydown` on `window`. Only acts when
  `isFullScreen === true` AND the target isn't inside `.monaco-editor`,
  `<input>`, `<textarea>`, or `[contenteditable="true"]`. Lets Monaco bind
  Esc for its own widgets first.

## Phase 3: Command Palette + i18n

- [x] **Add `Toggle IDE Fullscreen` action to CommandPalette** — dispatches
  `ide:toggle-fullscreen-ide`. If `ideCollapsed`, calls `toggleIde()`
  first, then dispatches in a `setTimeout(…, 0)` so the IDE has a tick to
  mount.
- [x] **i18n keys** — `ide.fullscreen.toggleTooltip` +
  `ide.fullscreen.exitTooltip` added to `web/locales/en/workspace.json` and
  `web/locales/zh/workspace.json`. Other locales fall back via inline
  `defaultValue`.

## Phase 4: Cleanup

- [x] **Remove `FullScreenFileReader.tsx`** — replaced by IDE-wide
  fullscreen, no longer needed.
- [x] **Remove per-file Maximize buttons in `EditorTabs.tsx`** — both the
  toolbar button and the markdown preview toolbar button. Drop the
  `Maximize2` import.
- [x] **Drop `ide.fullscreenReader.*` i18n keys** — replaced by
  `ide.fullscreen.*`.

## Phase 5: Reading ergonomics

- [x] **Font-size selector (S / M / L) in IDE top tab bar** — three small
  buttons mapped to 12 / 14 / 16 px. State lives in `WebIDEPanel`, defaults
  to `M`. Persisted to localStorage `webide:reader.fontSize`.
- [x] **Wire fontSize down to `EditorTabs`** — used for Monaco
  `options.fontSize` and as inline `fontSize` on the markdown preview root.
- [x] **Center markdown preview horizontally** — `MarkdownPreview` reading
  column is now `max-w-[760px] mx-auto` so it centers within the available
  width (especially in fullscreen).
- [x] **i18n** — `ide.fontSize.label` added to `en` + `zh` workspace.json.

## Phase 6: Validation

- [x] **`tsc --noEmit`** — clean.
- [x] **`vite build`** — succeeds.
- [x] **`openspec validate add-ide-fullscreen --strict`** — passes.
- [ ] **Manual smoke** (DEFERRED — needs browser session):
  - Header button toggles in / out.
  - `⌘⇧F` toggles in / out.
  - Esc on empty area exits.
  - Esc inside Monaco does NOT exit (Monaco gets it).
  - Tabs / open files / terminal session survive a toggle round-trip.
  - Diff / War room / Browser tabs render correctly when fullscreen.
  - CommandPalette command opens collapsed IDE before fullscreening.
