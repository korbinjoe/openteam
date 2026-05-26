# Design: IDE Fullscreen Mode

## Architecture

```
WorkspaceShell
  └─ ChatColumn / IdeColumn  ← static layout
        └─ WebIDEPanel       ← owns isFullScreen
              ├─ when false: <div class="h-full flex flex-col …">
              └─ when true:  <div class="fixed inset-0 z-[90] …">
```

The container is the same `<div ref={panelRef}>`. The CSS-class swap is the
only thing that changes; the descendant tree (top tab bar, FileTree,
EditorTabs, Suspense'd ChangesTab / WhiteboardSidebar / BrowserPanel,
terminal) is identical and not remounted.

## Decisions

### D1 — CSS-only fullscreen, not Portal

Initial drafts considered a Radix Dialog Portal (the way `FullScreenReview`
works). We rejected it because:

- The IDE has heavy in-memory state (tabs, Monaco models, terminal PTY
  sessions). A Portal would either need to mount a second copy (drift) or
  mount the panel inside the Portal (changes the chat ↔ IDE split layout).
- Portal contents are torn down on close, breaking PTY sessions.
- A simple `fixed inset-0` overlay achieves the same visual result with
  zero state migration.

Trade-off accepted: when fullscreen, the IDE is no longer a child of the
column flexbox, so it doesn't participate in the column's resize handle.
That's fine — the user explicitly chose fullscreen.

### D2 — Single boolean, no enum

We considered `viewMode: 'inline' | 'fullscreen' | 'left-split' …` for
future flexibility, but YAGNI — fullscreen is the only mode users have
asked for. A boolean is the cheapest representation that satisfies today's
requirements.

### D3 — Three trigger surfaces, one event

- **Header button** dispatches `ide:toggle-fullscreen-ide`.
- **`⌘⇧F` shortcut** calls `setIsFullScreen` directly (it's the same
  component that owns the state, no event needed).
- **CommandPalette** dispatches the event after a `setTimeout(…, 0)` so the
  IDE panel has time to mount if it was collapsed (`toggleIde()` called
  first in that path).

The window event lets surfaces outside the IDE component subtree drive the
toggle without React-context coupling — same pattern already used by
`ide:set-tab`, `ide:open-file`, `ide:toggle-terminal`.

### D4 — Esc handling

Esc must yield to:
- Monaco (`.monaco-editor` ancestor) — Monaco binds Esc for find widget /
  suggest popup / etc.
- `<input>`, `<textarea>`, `[contenteditable="true"]` — typed input.

In all other targets, Esc exits fullscreen. Implemented as a `keydown`
listener on `window` that early-returns when `e.target.closest(...)`
matches the swallow list.

### D5 — Z-index

| Layer | z-index | Why |
|-------|---------|-----|
| Inline IDE (default) | (auto) | Lives inside flex column |
| Fullscreen IDE | `z-[90]` | Above sidebar / chat / dialogs |
| CommandPalette | `z-[100]` | Above fullscreen so user can dismiss it |
| Sonner toasts | (default ≥ 1000) | Above everything |

### D6 — i18n keys

Two strings only — `ide.fullscreen.toggleTooltip` and
`ide.fullscreen.exitTooltip`. Localized in `en` and `zh`; other locales
fall back via i18next's inline `defaultValue`, consistent with the rest of
the `ide.*` block.

### D7 — Discoverability

Header button uses `Maximize2` (enter) / `Minimize2` (exit) lucide icons,
placed at the right end of the top tab bar. The Command Palette entry is
always visible to users who hit `⌘K`. The `⌘⇧F` shortcut is a learnable
power-user path advertised via the button's tooltip.

### D8 — Font-size selector (S / M / L)

Three compact buttons in the IDE top tab bar (between flex-spacer and
Maximize button). Maps to 12 / 14 / 16 px. State lives in `WebIDEPanel` and
is passed to `EditorTabs` as a prop which drives both Monaco `options.fontSize`
and the inline `style.fontSize` on the MarkdownPreview root. Persisted via
localStorage key `webide:reader` (`{ fontSize: 'S'|'M'|'L' }`), loaded on
mount and written on change (synchronous — no debounce needed for a user
click).

### D9 — Markdown horizontal centering

`MarkdownPreview` uses `max-w-[760px] mx-auto` so the reading column centers
within the available width. This is most impactful in fullscreen where the
container is the full viewport, but applies in normal column mode too (where
it's a no-op since column width ≤ 760px).
