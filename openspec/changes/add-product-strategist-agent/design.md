# Design: Product Strategist Agent

## Context

OpenTeam pitches itself as the OS for an AI super-individual: pulse-mode dispatch → leave → return for batch review. The current built-in roster handles every phase **after** "we have decided what to build" — engineering, review, visual, ops, coaching. The phase **before** ("what should we build, against whom, for whom, in what shape") has no expert. The user has to drive it manually, which breaks the leave-friendly promise.

This change adds a single new built-in agent that owns the upstream loop and stops at the PRD / low-fi wireframe handoff. Visual fidelity and implementation stay with the existing experts.

## Why one agent and not three

Three candidates were on the table:

1. **One agent — `product-strategist`** (chosen)
2. Three agents: `competitive-analyst` + `product-researcher` + `product-designer`
3. Two agents: `product-researcher` (research + competitive) + `product-designer` (PRD + wireframes)

Decision: **option 1**.

Reasoning:

- **Context locality.** Competitor scans, user research, and the resulting PRD share the same evidence. Splitting into three agents fragments that evidence across three workspaces and forces the user (or `lead`) to ferry artifacts between them, which is exactly the attention-tax OpenTeam is supposed to remove.
- **Roster shape.** The existing roster groups by **layer** (engineering / visual / ops / coaching), not by **phase**. Three sub-roles for the upstream phase would make it the heaviest team by headcount without proportional capability gain.
- **Reversibility.** If context-bleed inside the strategist becomes a real problem, splitting later is mechanical: extract skills, fork `SOUL.md`, register a second agent. The split direction is open; locking it in now is premature.
- **Aligns with `architect` / `ui-designer` precedent.** Both agents already bundle multiple sub-responsibilities under one identity (review = layering + boundaries + dependency + data flow; design = decisions + implementation + verification).

Trade-off accepted: a single agent juggling research and design risks shallower outputs in each. Mitigated by hard limits in `SOUL.md` (one mode at a time, explicit deliverable headers per mode).

## Why scope stops at PRD + low-fi wireframes

Two candidates:

1. **PRD + low-fi only** (chosen) — strategist outputs PRD, IA, mermaid flows, ASCII / mermaid wireframes; hands off to `ui-designer` for visual fidelity.
2. PRD + hi-fi prototypes — strategist also produces Figma-grade mocks.

Reasoning:

- `ui-designer` already exists and is good at visual fidelity with browser-verified output. Duplicating that capability inside strategist creates two agents competing for the same deliverable.
- Low-fi → hi-fi handoff is a clean boundary that engineering teams already understand (PRD review → design review → implementation).
- "Pixel-perfect" requires the same screenshot-evidence loop that `ui-designer`'s `SOUL.md` already enforces; cloning that loop is not worth the cost.

## Agent identity choices

| Field    | Value                | Rationale                                                       |
|----------|----------------------|-----------------------------------------------------------------|
| id       | `product-strategist` | Verb-led capability, parallels `fullstack-product-engineer`     |
| nickname | `Strategist`         | One word, no collision with existing nicknames                  |
| emoji    | 🧪                   | Hypothesis / experiment vibe, distinct from existing 🦅🦊🐺🧭🔮🖌️ |
| animal   | meerkat              | Scout / lookout — matches competitive scanning posture          |

## Tool surface

Strategist gets `Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch / AskUserQuestion`.

- `Write` / `Edit` are needed because deliverables (PRD, research notes, wireframes) live as files in the chat workspace.
- `WebFetch` / `WebSearch` are needed for competitor scans and market evidence.
- `playwright-cli` skill + the `playwright` MCP server (injected via `agents.defaults.mcpServers`) cover JS-heavy competitor sites.
- `AskUserQuestion` lets the strategist clarify research scope without spinning a full chat round-trip.

Explicitly **not** granted:

- No `TaskCreate` / `TaskUpdate` etc. — task tools belong to `lead`.
- No deployment / publish tools — deliverables stay local until the user approves them.

## War-room contract

The strategist follows the same whiteboard protocol as other experts. Expected entry types:

- `decision` — when the strategist commits to a positioning, target user, or scope cut.
- `constraint` — when research surfaces a hard constraint (regulatory, technical, market).
- `artifact` — when a deliverable lands (PRD, scan report).
- `open_question` — when research can't resolve a decision and needs the user.

`progress` and `goal` continue to be auto-extracted by hooks.

## Interaction with `lead`

`lead` dispatches by capability description. Adding `product-strategist` to `subAgentNames` makes it a routing target. The description in `openteam.json` is written so `lead` recognises requests like "look at these competitors", "draft a PRD for X", "scope what users want from Y" and routes to strategist.

No changes needed to `lead`'s prompt or to dispatcher skills — registration is sufficient.

## Decisions

- **Single agent for all three responsibilities.** See "Why one agent and not three" above.
- **Hard scope cap at low-fi wireframes.** Hi-fi handed to `ui-designer`.
- **No new skill files in this change.** Reuses `playwright-cli` and `whiteboard` from existing skill registry. New strategist-specific skills (e.g. `competitor-teardown-template`) can be a follow-up proposal once usage patterns settle.
- **No `TOOLS.md` for the new agent.** Matches the majority of existing agents; tool surface is declared in `openteam.json`. (Only `architect` ships a `TOOLS.md` and that's because of its read-only enforcement story.)
- **Boundary with `ui-designer` enforced in `SOUL.md` Hard Limits**, not in code. Soft enforcement matches how the other expert/expert boundaries are encoded today.

## Rollback / evolution path

If the single-agent decision turns out wrong:

1. Keep `product-strategist` as the research-heavy agent.
2. Fork a new `product-designer` agent for the PRD / wireframe phase, reusing the same workspace conventions.
3. Update `lead.subAgentNames` and the routing description.

The change is additive and reversible; no schema or code changes outside `openteam.json` and the new agent directory.
