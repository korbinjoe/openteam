# Design: Splash Screen

## Visual Concept — "Command Center Awakens"

The splash screen communicates a system-level "boot sequence" — not a marketing splash,
but the feeling of a precision tool powering on. Every element serves a purpose.

## Design Decisions

### 1. Logo Treatment

The logo mark uses a 145° diagonal gradient (brand-light → brand → brand-deep) with
multi-layer box-shadow for depth. A radial glow behind it creates the "power-on" visual.
The outer ring pulse subtly communicates "scanning / connecting."

**Why gradient, not flat?** At 120×120px on a dark field, a flat fill looks like a
placeholder. The gradient gives the logo the perceived depth of an app icon.

### 2. Agent Dots Loading Indicator

Five dots that activate sequentially rather than a generic progress bar.

**UX rationale**: Directly maps to the product's core concept — AI agents coming online.
Each dot "lighting up" reinforces the mental model that multiple agents are initializing.
This is a semantic loading indicator, not a generic one.

### 3. Typography Split: "Open" + "Team"

The wordmark splits: "Open" in text-primary (neutral), "Team" in accent-brand-light.

**Why?** Emphasizes the differentiator — it's not just "open", it's about the "team"
of AI agents. Subtle but registers subconsciously on every launch.

### 4. Background Atmosphere

- Radial gradient (very low opacity 0.06) creates depth without being decorative
- Barely-visible grid pattern (0.025 opacity, center-masked) adds "command center" texture
- Combined effect: the dark background feels like a space, not a flat wall

### 5. Shortcut Hint (⌘N)

Appears 2.5s after splash loads. Primes the user for the core action ("dispatch a mission")
so by the time the app is ready, they know what to do next.

**Product value**: Reduces time-to-first-action for new users. Power users ignore it.

### 6. Animation Choreography

| Element | Delay | Duration | Easing |
|---------|-------|----------|--------|
| Container | 0ms | 800ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Logo scale-in | 0ms | 900ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Wordmark | 250ms | 700ms | ease-out |
| Tagline | 500ms | 600ms | ease-out |
| Agent dots | 700ms | 500ms | ease-out |
| Status text | 1400ms | 500ms | ease-out |
| ⌘N hint | 2500ms | 500ms | ease-out |

Staggered reveals prevent "everything appearing at once" while keeping total
perceived load time under 1.5s.

### 7. Exit Transition

When React app signals ready: scale up to 1.04× + blur(4px) + fade out over 400ms.
This creates a "zooming into the app" feeling rather than an abrupt cut.

## Color Palette (from existing tokens)

| Token | Value | Usage |
|-------|-------|-------|
| bg-deep | rgb(6, 6, 12) | Splash background (slightly darker than app bg-primary) |
| accent-brand | rgb(90, 143, 202) | Logo fill, dots, status dot |
| accent-brand-light | rgb(130, 176, 222) | "Team" wordmark, dot active state |
| accent-brand-deep | rgb(62, 114, 172) | Logo gradient end, secondary glow |
| text-primary | rgb(226, 228, 240) | "Open" wordmark |
| text-muted | rgb(90, 100, 120) | Tagline, status, version |

## Implementation Architecture

```
┌──────────────────────────┐
│ Electron Main Process    │
│                          │
│  1. Create splash window │ ← frameless, 480×360, centered
│  2. loadFile(splash.html)│ ← inline CSS, zero deps, instant
│  3. Create main window   │ ← hidden, loads React app
│  4. IPC: app-ready       │ ← React signals ready via preload
│  5. Fade splash → show   │
│     main window          │
└──────────────────────────┘
```

The splash HTML is fully self-contained (inline CSS, no external requests)
so it renders in <50ms after window creation.

## Anti-AI Design Check

- [x] Not using Inter — Nunito with weight 800 for brand voice
- [x] Not everything centered — version is bottom-right, hint is bottom-center
- [x] Has visual depth — multi-layer shadows, gradient logo, radial glow
- [x] Not purple-blue gradient — uses project's established "静青" (Jiqing) blue palette
- [x] Loading indicator is semantic (agent dots), not generic shimmer bar
- [x] Spacing has purpose — large gap between tagline and dots creates breathing room
- [x] Uses real copy — "dispatch your first mission" references actual product action
