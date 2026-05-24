# OpenTeam

**Build your AI agent team in minutes — powered by Claude Code, Codex, and any CLI you plug in.**

Declare roles, models, and skills in a single `openteam.json` and you've got a working team. Each agent runs on the AI CLI of your choice — **Claude Code**, **Codex**, or any backend you plug in — so you keep your existing tools, prompts, and credits.

Dispatch tasks in parallel, walk away, come back to batch-review. One human, the output of a small company.

![Demo GIF](./docs/assets/demo.gif)
<!-- TODO: Replace with actual demo GIF once recorded -->

## Why OpenTeam?

You already use Claude Code or Codex. But you're stuck running one agent at a time — context-switching, waiting, babysitting. And every "AI team" product locks you into their backend.

OpenTeam flips both:

- 🚀 **Stand up a team in minutes** — one config file, ready-to-run roles (Lead, Fullstack, Reviewer, …), or roll your own
- 🔌 **Bring your own AI CLI** — first-class **Claude Code** & **Codex** support; add a new backend by implementing two interfaces (`SessionDiscovery` + `OutputParser`)

A **Web IDE that orchestrates multiple agents simultaneously**:

```
You:   "Build the auth module, add tests, and update the docs"
       ↓ dispatches to 3 agents in parallel
       ↓ each works in an isolated git worktree
       ↓ you go grab coffee
       ↓ come back, review 3 PRs, ship
```

### How It's Different

| | OpenTeam | Cursor/Windsurf | Claude Code | Devin |
|---|---|---|---|---|
| Multi-agent parallel | **Yes** | No | No | No |
| Open source | **Yes** | No | No | No |
| Runs locally | **Yes** | Partial | Yes | No |
| Web IDE + terminal | **Yes** | Yes | No | Yes |
| Provider-agnostic | **Yes** | No | No | No |
| Walk away & come back | **Yes** | No | No | Yes |

## Quick Start

```bash
# Install
git clone https://github.com/korbinjoe/openteam.git
cd openteam && npm install

# Run (frontend + backend)
npm run dev
# → Open http://localhost:13000
```

**Prerequisites**: Node.js ≥ 18, npm, and an `ANTHROPIC_API_KEY` (or Codex setup).

## Features

**Orchestration**
- Lead Agent decomposes tasks → Expert Agents execute in parallel
- Each agent runs in its own terminal (PTY session that persists in background)
- Visual Agent topology editor (React Flow)

**Web IDE**
- File tree + Monaco editor + multi-tab terminal
- Built-in browser preview
- Git Graph, Inline Diff, Commit panel, Full-screen Review

**Developer Experience**
- Whiteboard (War Room): cross-agent shared context
- Real-time token tracking by model/conversation
- Permission interception: approve/reject agent tool calls in real-time
- Workspace isolation via Git Worktrees
- Cron scheduler with natural language time parsing
- 6 themes, dark/light mode, i18n (EN/ZH)

**CLI Mode**
```bash
npx openteam serve    # Start as web service
npx openteam          # Interactive mode
```

## Status Indicators

Every chat and agent row carries a colored dot encoding live execution state.
The mapping is consistent across the sidebar, task list, and command palette:

| Dot | State | Meaning |
|-----|-------|---------|
| 🔵 (pulsing) | `running` | Agent is actively executing |
| 🟡 | `waiting` | Agent paused — waiting for your input or confirmation (e.g. tool-use approval) |
| 🔴 | `error` | Last run failed |
| 🟢 | `done` | Completed successfully |
| ⚪ | `idle` / `stopped` | No active work |

A task header rolls up the worst status of its members
(`error` > `waiting` > `running` > `idle`), so a yellow task header means at
least one agent inside is blocked on you.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│   Web UI    │────▶│   Express    │────▶│  CLI Agents (PTY Sessions) │
│  (React 18) │◀────│   + WS       │◀────│  Claude Code / Codex       │
└─────────────┘     └──────────────┘     └──────────────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         REST API     WebSocket     SQLite
     (Agent/Chat/    (terminal/    (persistent
      Workspace)     activity)     storage)
```

**Key design decisions**:
- JSONL files are the single source of truth for messages (no DB messages table)
- PTY sessions persist independently of WebSocket connections
- Adding a new CLI provider = implement `SessionDiscovery` + `OutputParser`

## Built-in Agent Team

| Agent | Role |
|-------|------|
| Team Lead | Task decomposition & dispatch |
| Full-Stack Engineer | End-to-end feature delivery |
| Code Reviewer | Multi-stack code review |
| Visual Designer | UI design & implementation |
| DevOps Engineer | CI/CD and deployment |
| Architecture Reviewer | Architecture assessment |

Customize your team in `openteam.json`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Backend | Node.js + Express + WebSocket + node-pty |
| Storage | SQLite (better-sqlite3, WAL mode) |
| Desktop | Electron |
| CLI | Commander.js + Ink |
| Editor | Monaco Editor |
| Terminal | xterm.js |

## Configuration

Data lives in `~/.openteam/`. Team config in `openteam.json`.

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `ANTHROPIC_BASE_URL` | Custom API base URL | `https://api.anthropic.com` |
| `OPENTEAM_HOME` | Data directory | `~/.openteam` |
| `PORT` | Server port | `13001` |

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

Good first issues are tagged with [`good first issue`](../../labels/good%20first%20issue).

## License

[MIT](LICENSE)
