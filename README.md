# OpenTeam

**The operating system for AI super-individuals — one person, the output of a whole team.**

```
You:   "Build the auth module, add tests, and update the docs"
       ↓ Lead decomposes into a DAG
       ↓ dispatches 3 expert agents in parallel
       ↓ each works in its own git worktree
       ↓ you go grab coffee
       ↓ come back, review 3 PRs, ship
```

One config file. A full AI team. Walk away and come back to finished work.

[![Watch the demo](https://github.com/user-attachments/assets/5f7b0993-b334-4e62-8114-3a24c6bd7a2c)](https://www.youtube.com/watch?v=VPqUtZZcyZk)

---

## Why OpenTeam?

You already use Claude Code or Codex. But you're stuck running **one agent at a time** — context-switching, waiting, babysitting.

OpenTeam gives you a team that works while you don't:

- **Parallel execution** — multiple agents work simultaneously on different parts of your task
- **Bring your own CLI** — first-class Claude Code & Codex support; add any backend by implementing two interfaces
- **Walk-away orchestration** — Lead decomposes, dispatches, drives workflow to completion. You come back to results
- **Skill-powered agents** — not just prompts; agents carry executable skills (browser automation, image generation, code review checklists, war-room coordination)

---

## Quick Start

```bash
git clone https://github.com/korbinjoe/openteam.git
cd openteam && npm install

# Run (frontend + backend)
npm run dev
# → Open http://localhost:13000

# Or as Electron desktop app
npm run dev:electron
```

**Prerequisites**: Node.js ≥ 18, npm, and a Claude Code or Codex CLI installed.

---

## How It Works

### 1. Define your team in `openteam.json`

```jsonc
{
  "agents": {
    "list": [
      { "id": "lead", "name": "Lead", "model": "claude-sonnet-4-6" },
      { "id": "fullstack-product-engineer", "name": "Fullstack Engineer" },
      { "id": "code-reviewer", "name": "Code Reviewer" },
      { "id": "ui-designer", "name": "UI Designer" }
      // Add your own — just point to a directory with a SOUL.md
    ]
  }
}
```

### 2. Dispatch a task

Tell the Lead what you need. It decides whether to answer directly, hand off to one expert, or create a multi-step DAG workflow across several agents.

### 3. Walk away

Agents work in isolated git worktrees. The workflow engine handles dependencies, retries, and failure policies. You come back to review results.

---

## Features

### Orchestration Engine

- **DAG Workflows** — Lead decomposes tasks into dependency graphs and dispatches agents in optimal order
- **Handoff Protocol** — agents route work to the right specialist automatically
- **Workspace Isolation** — each agent works in its own git worktree, no merge conflicts
- **Failure Policies** — per-task `stop`, `skip`, or `retry` with configurable attempts and timeouts
- **Heartbeat Monitoring** — keeps long-running agents on track

### Web IDE

- File tree + Monaco editor + multi-tab terminal
- Built-in browser preview for frontend work
- Git diff viewer and commit panel
- Inline code review for agent changes

### War Room

A shared context board where agents post goals, decisions, artifacts, and blockers — visible to the whole team. No agent works in a vacuum.

### Observability

- **DevPanel** — 5-tab dashboard: Overview, Agents, Events, Protocol timeline, Workflow DAG inspector
- **Real-time token tracking** by model and conversation
- **Permission interception** — approve or reject agent tool calls live
- **Cron scheduler** — recurring agent tasks with natural-language time parsing

### Developer Experience

- Dark / light mode
- i18n (English / Chinese)
- Desktop app via Electron (macOS)
- CLI mode for headless operation

---

## Built-in Agent Team

| Agent | What it does |
|-------|-------------|
| **Lead** | Routes tasks — answers directly, hands off, or creates DAG workflows |
| **Fullstack Engineer** | End-to-end feature delivery from design to implementation |
| **Code Reviewer** | Multi-language code review, quality analysis, root-cause analysis |
| **UI Designer** | Visual design + implementation with browser-verified screenshots |
| **DevOps Engineer** | CI/CD, deployment, and infrastructure |
| **Architect** | Architecture assessment, layering, dependency governance |
| **Product Strategist** | Competitive analysis, PRDs, wireframes |
| **Image Creator** | AI image generation via Gemini |
| **Growth Marketer** | Project promotion and social media content |
| **Sensei** | Agent team evolution and prompt optimization |

Adding a custom agent = create a directory with a `SOUL.md` and add one entry to `openteam.json`.

---

## Skills System

Agents aren't just prompts — they carry executable skills:

| Skill | Description |
|-------|-------------|
| `workflow` | DAG creation, advancement, status tracking |
| `handoff` | Transfer tasks to the right specialist |
| `whiteboard` | Read/write shared War Room context |
| `playwright-cli` | Browser automation and screenshot verification |
| `image-generator` | AI image generation |
| `x-promoter` | Social media content creation |
| `code-reviewer-*` | Language-specific review checklists (React, TypeScript, Node.js) |
| `api-integrator` | API contract implementation |
| `product-design` | PRD and wireframe generation |
| `skill-creator` | Create new skills dynamically |

Skills are composable — any agent can carry any combination. Build your own by dropping a script into the skills directory.

---

## Use Cases

**Solo Founder** — You have a product idea. Tell Lead to "build the landing page, implement the signup API, and write the copy." Three agents work in parallel. You review one PR with all the pieces.

**Open Source Maintainer** — A contributor submits a large PR. Dispatch Code Reviewer across backend, frontend, and config in parallel. Get a structured review report in minutes, not hours.

**Freelancer** — Client wants a feature + tests + docs. Dispatch once, go work on another client. Come back to a complete deliverable.

---

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

**Design decisions**:

- **JSONL as source of truth** — messages live in JSONL files, not the database
- **PTY persistence** — terminal sessions survive WebSocket disconnects
- **Provider-agnostic** — new CLI = implement `SessionDiscovery` + `OutputParser`
- **Server-driven workflows** — dependency resolution, scheduling, and failure handling

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

---

## CLI

```bash
npx openteam serve       # Start as web service
npx openteam agents      # List configured agents
npx openteam workspaces  # Manage workspaces
npx openteam config      # View/edit configuration
npx openteam run         # Run a task directly
npx openteam chat        # Interactive chat mode
npx openteam daemon      # Manage background daemon
npx openteam update      # Check for updates
```

---

## Configuration

Runtime data lives in `~/.openteam/`. Team config in `openteam.json` at the project root.

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key | — |
| `ANTHROPIC_BASE_URL` | Custom API base URL | `https://api.anthropic.com` |
| `OPENTEAM_HOME` | Data directory | `~/.openteam` |
| `PORT` | Server port | `13001` |

---

## Roadmap

- [ ] GitHub Actions integration — trigger workflows from CI
- [ ] Plugin marketplace — share and install community skills
- [ ] Multi-repo orchestration — agents working across repositories
- [ ] Voice dispatch — speak tasks, review results on mobile
- [ ] Cost budgets — per-workflow spending limits with auto-pause

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

Good first issues are tagged with [`good first issue`](../../labels/good%20first%20issue).

---

## License

[MIT](LICENSE)
