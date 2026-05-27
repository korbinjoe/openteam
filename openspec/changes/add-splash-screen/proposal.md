# Proposal: Add Splash Screen

## Summary

Design and implement a premium splash/launch screen for the OpenTeam desktop app that covers the loading gap between Electron window creation and web content ready, while establishing the "command center" brand identity.

## Motivation

Currently, when OpenTeam launches, users see a blank window or flash of unstyled content before the React app hydrates and the Express server starts. A well-designed splash screen:

1. **Eliminates perceived latency** — the app feels instant even though server/frontend boot takes 2-3s
2. **Establishes product identity** — first impression of "AI operating system" tone
3. **Signals system readiness** — communicates that agents/services are initializing
4. **Professional polish** — matches the quality bar of Linear, Raycast, Notion

## Goals

- Cover the full loading gap (Electron window show → React app ready)
- Feel fast and purposeful, not decorative
- Match existing dark theme and brand tokens exactly
- Transition smoothly into the main app UI
- Work across all supported platforms (macOS, Windows, Linux)

## Non-Goals

- Marketing content or onboarding flows (separate concern)
- User-configurable splash themes
- Network status or login during splash

## Approach

1. HTML high-fidelity visual mockup as design deliverable (this proposal)
2. Static HTML splash embedded in Electron's `loadFile` before main window loads React
3. CSS-only animation (no JS dependency during splash)
4. Smooth crossfade transition when React app signals ready

## Risks

- Animation duration must match actual boot time — too long feels slow, too short flickers
- Must not add to perceived startup time (splash shows instantly, not after loading)

## Deliverables

- `splash-screen.html` — High-fidelity visual mockup (design spec)
- Electron integration spec
- CSS animation spec
