# Tasks: Add Splash Screen

## Design Phase

- [x] Extract brand tokens from existing codebase (colors, radius, font)
- [x] Design high-fidelity HTML visual mockup
- [x] Review and iterate on visual design

## Implementation Phase — Splash Screen

- [x] Create `electron/splash.html` with inline CSS (zero external deps)
- [x] Add splash BrowserWindow in Electron main process (frameless, always-on-top)
- [x] Implement IPC signal from React app → close splash window
- [x] Add smooth fade-out transition on splash close
- [x] Handle edge cases: fast boot (skip animation), slow boot (extend gracefully)

## Implementation Phase — Workspace Home

- [x] Implement `WorkspaceHome` component with empty state (team strip, templates, CTA)
- [x] Implement `WorkspaceHome` active state (summary stats, review feed, running list)
- [x] Replace `ChatPane` EmptyState with `WorkspaceHome`

## Verification

- [ ] Test on macOS: splash timing, animation smoothness, retina rendering
- [ ] Test cold start vs warm start behavior
- [ ] Verify no increase to time-to-interactive
- [ ] Verify WorkspaceHome renders correctly with 0 missions and with active missions
