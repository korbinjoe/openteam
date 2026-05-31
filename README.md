# OpenTeam

**The operating system for AI super-individuals — one person, the output of a whole team.**

Declare agents, models, and skills in a single `openteam.json` and you've got a working AI team. Each agent runs on the CLI of your choice — **Claude Code**, **Codex**, or any backend you plug in — so you keep your existing tools, prompts, and credits.

Dispatch tasks in parallel, walk away, come back to batch-review. One human, the output of a small company.

![Demo GIF](./docs/assets/demo.gif)
<!-- TODO: Replace with actual demo GIF once recorded -->

## Why OpenTeam?

You already use Claude Code or Codex. But you're stuck running one agent at a time — context-switching, waiting, babysitting. And every "AI team" product locks you into their backend.

OpenTeam flips both:

- **Stand up a team in minutes** — one config file, ready-to-run agents (Lead, Fullstack, Reviewer, …), or define your own
- **Bring your own AI CLI** — first-class Claude Code & Codex support; add a new backend by implementing two interfaces (`SessionDiscovery` + `OutputParser`)
- **Walk-away orchestration** — the Lead decomposes tasks into a DAG, dispatches to expert agents in parallel, and drives the workflow to completion while you're away

```
You:   "Build the auth module, add tests, and update the docs"
       ↓ Lead creates a DAG workflow
       ↓ dispatches to 3 expert agents in parallel
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
| DAG workflow engine | **Yes** | No | No | No |

## Quick Start

```bash
# Install
git clone https://github.com/korbinjoe/openteam.git
cd openteam && npm install

# Run (frontend + backend)
npm run dev
# → Open http://localhost:13000

# Or run as Electron desktop app
npm run dev:electron
```

**Prerequisites**: Node.js ≥ 18, npm, and a Claude Code or Codex CLI installed.

## Features

### Orchestration

- **Lead-driven DAG workflows** — Lead agent decomposes tasks into a dependency graph, dispatches expert agents in the right order, and advances the workflow automatically
- **Handoff protocol** — agents hand off work to the right specialist instead of doing everything themselves
- **Workspace isolation** — each agent works in its own git worktree to avoid conflicts
- **Heartbeat monitoring** — configurable heartbeat checks keep long-running agents on track

### Web IDE

- File tree + Monaco editor + multi-tab terminal
- Built-in browser preview for frontend work
- Git diff viewer and commit panel
- Inline code changes review

### Agent Management

- **War Room (Whiteboard)** — shared context board where agents post goals, findings, and decisions visible to the whole team
- **DevPanel** — 5-tab observability dashboard: Overview, Agents, Events, Protocol timeline, and Workflow DAG inspector
- **Real-time token tracking** by model and conversation
- **Permission interception** — approve or reject agent tool calls in real-time
- **Cron scheduler** — schedule recurring agent tasks with natural language time parsing

### Developer Experience

- Dark / light mode
- i18n (English / Chinese)
- Desktop app via Electron (macOS)
- CLI mode for headless operation

## Built-in Agent Team

| Agent | Role |
|-------|------|
| **Lead** | Intelligent task router — answers simple questions directly, hands off single tasks, or creates DAG workflows for multi-step orchestration |
| **Fullstack Product Engineer** | End-to-end feature delivery from design to implementation |
| **Code Review Expert** | Multi-language code review, quality analysis, bug root-cause analysis |
| **Visual Design Expert** | UI design and implementation with browser-verified screenshot review |
| **DevOps Expert** | CI/CD, deployment, and infrastructure on modern platforms |
| **Architecture Review Expert** | Architecture assessment, layering, and dependency governance |
| **Growth Coach (Sensei)** | Agent team evolution, prompt optimization, performance evaluation |
| **Image Creator** | AI image generation via Gemini models |
| **Product Strategist** | Competitive analysis, product research, PRD and wireframes |
| **Growth Marketer** | Project promotion and social media content |

Customize your team in `openteam.json`. Adding a new agent = add an entry to `agents.list` with a workspace directory containing a `SOUL.md`.

## CLI

```bash
npx openteam serve       # Start as web service (daemon mode)
npx openteam agents      # List configured agents
npx openteam workspaces  # Manage workspaces
npx openteam config      # View/edit configuration
npx openteam run         # Run a task directly
npx openteam chat        # Interactive chat mode
npx openteam daemon      # Manage background daemon
npx openteam update      # Check for updates
```

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│   Web UI    │────▶│   Express    │────▶│  CLI Agents (PTY Sessions) │
│  (React 18) │◀────│   + WS       │◀────│  Claude Code / Codex       │
└─────────────┘     └──────────────┘     └──────────────────────────┘
       │                   │                        │
  Electron app        REST + WS              WorkflowEngine
  (optional)          endpoints              WorkflowScheduler
                           │
              ┌────────────┼────────────┐
              │            │            │
         REST API     WebSocket     SQLite
     (Agent/Chat/    (terminal/    (persistent
      Workspace)     activity)     storage)
```

**Key design decisions**:

- **JSONL as source of truth** — conversation messages live in JSONL files, not the database
- **PTY persistence** — terminal sessions persist independently of WebSocket connections
- **Provider-agnostic** — adding a new CLI provider = implement `SessionDiscovery` + `OutputParser`
- **DAG workflow engine** — server-driven workflow scheduling with dependency resolution

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

Runtime data lives in `~/.openteam/`. Team config in `openteam.json` at the project root.

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
