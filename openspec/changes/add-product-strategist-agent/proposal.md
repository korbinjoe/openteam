# Proposal: Add Product Strategist Agent

## Summary

Add a new built-in agent `product-strategist` to `ai-assets/agents/` that owns competitive analysis, product research, and product design (up to PRD / low-fidelity wireframes). Register it in `openteam.json` and expose it as a sub-agent of `lead`.

## Motivation

The current built-in roster covers engineering (`fullstack-product-engineer`, `architect`, `code-reviewer`, `devops-engineer`), visual implementation (`ui-designer`), coordination (`lead`), evolution (`sensei`), and image generation (`image-creator`). There is no agent for the **upstream "what should we build" loop**:

- Competitive scans (who else is in this space, what do they do, how do they price, what is their UX)
- Product research (target users, jobs-to-be-done, market signals, opportunity sizing)
- Product design as PRD / user stories / information architecture / low-fidelity wireframes

Today the user has to drive these phases manually, which contradicts OpenTeam's "AI super-individual" thesis — a single user should be able to dispatch a strategist alongside engineers in pulse-mode and come back to a decision-ready pack.

## Goals

1. **One new built-in agent** `product-strategist` registered in `openteam.json`, discoverable by `lead` as a sub-agent.
2. **Clear scope**: competitive analysis, product research, product design up to PRD + low-fi wireframes (markdown / mermaid / ASCII). Visual fidelity stays with `ui-designer`.
3. **Self-contained workspace** at `ai-assets/agents/product-strategist/` with `IDENTITY.md` and `SOUL.md` matching the existing agent file convention.
4. **Browser-equipped** for live competitor scans (uses the existing `playwright-cli` skill from defaults; no new MCP server).
5. **War-room aware** — writes `decision`, `constraint`, `artifact`, `open_question` per the existing whiteboard protocol.
6. **No engineering scope creep** — strategist must hand off implementation to `fullstack-product-engineer` / `ui-designer`.

## Non-Goals

- High-fidelity visual design (stays with `ui-designer`).
- Frontend / backend code changes (stays with `fullstack-product-engineer`).
- A new evolution / coaching layer (already covered by `sensei`).
- Adding new skills under `ai-assets/skills/` in this change — the agent reuses existing browser + war-room skills. New skills can be proposed later if needed.
- New MCP servers or external API integrations.

## Approach

### Agent identity

```
id:       product-strategist
name:     Product Strategist
nickname: Strategist
emoji:    🧪
animal:   meerkat   # scout / lookout — fits competitive scanning
role:     expert
```

### File layout (new)

```
ai-assets/agents/product-strategist/
  IDENTITY.md   # name, nickname, emoji, animal (matches ui-designer/lead format)
  SOUL.md       # Personality, Tone, Verbosity, Collaboration Style, Hard Limits
```

`TOOLS.md` is optional in this codebase (only `architect` ships one). The strategist will rely on the `allowedTools` declared in `openteam.json`, mirroring how `fullstack-product-engineer` and `devops-engineer` work.

### `openteam.json` registration

Append a new entry to `agents.list` and add `product-strategist` to `lead.subAgentNames`:

```jsonc
{
  "id": "product-strategist",
  "name": "Product Strategist",
  "description": "Competitive analysis, product research, and product design up to PRD and low-fidelity wireframes. Hands off implementation to engineering and visual design to ui-designer.",
  "workspace": "./ai-assets/agents/product-strategist",
  "role": "expert",
  "skills": ["playwright-cli", "whiteboard"],
  "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "WebFetch", "WebSearch", "AskUserQuestion"]
}
```

`playwright` MCP server is already injected via `agents.defaults.mcpServers`, so the strategist gets headless browser access for free.

### Boundaries with existing agents

| Activity                                  | Owner                       |
|-------------------------------------------|-----------------------------|
| Market scan, competitor teardown          | **product-strategist**      |
| User research synthesis, JTBD, personas   | **product-strategist**      |
| PRD, user stories, IA, low-fi wireframes  | **product-strategist**      |
| Visual design, design tokens, hi-fi UI    | ui-designer                 |
| Frontend / backend implementation         | fullstack-product-engineer  |
| Architecture review                       | architect                   |
| Deployment / CI                           | devops-engineer             |

These boundaries are encoded in `SOUL.md` "Hard Limits" so the strategist doesn't drift into engineering or visual implementation.

### Output conventions

Strategist deliverables land in the chat workspace under predictable filenames so engineers can pick them up:

- `research/competitor-scan.md`
- `research/user-research.md`
- `prd/<feature>.md` (with embedded mermaid for IA / flows, ASCII or mermaid for wireframes)

These are conventions, not new infrastructure — no code changes outside config + agent docs.

## Risks

| Risk | Mitigation |
|------|-----------|
| Scope overlap with `ui-designer` causes both to draft UI. | `SOUL.md` hard-limits visual fidelity to "low-fi only"; PRD explicitly hands off to ui-designer. |
| Web scraping competitor sites runs into bot walls. | Uses existing `@playwright/mcp --headless`; on failure, falls back to `WebFetch` / `WebSearch` and notes gaps in deliverable. |
| Yet another agent inflates the roster and confuses `lead`'s dispatching. | Description and nickname are distinct ("Strategist"); `lead` already routes by capability description. |
| User wanted three separate agents (researcher / analyst / designer). | Single-agent decision documented in `design.md` with rollback path: split later by extracting skills if context-bleed becomes a real problem. |
| New agent diverges from war-room protocol. | `SOUL.md` references existing whiteboard skill; same convention as other experts. |
