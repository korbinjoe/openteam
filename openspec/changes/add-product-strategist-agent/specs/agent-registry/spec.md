# Capability: Built-In Agent Registry

The set of agents shipped under `ai-assets/agents/` and registered through `openteam.json` defines OpenTeam's default team. Each agent has a workspace directory, an identity / soul declaration, a tool surface, and a routing description that `lead` uses for dispatching.

## ADDED Requirements

### Requirement: Built-In Product Strategist Agent

The system SHALL ship a built-in agent `product-strategist` covering competitive analysis, product research, and product design up to PRD and low-fidelity wireframes.

#### Scenario: Agent is registered in openteam.json

- **Given** the project's `openteam.json` is loaded by `AgentRegistry`
- **When** the agent list is enumerated
- **Then** an entry with `id: "product-strategist"` is present
- **And** its `workspace` points to `./ai-assets/agents/product-strategist`
- **And** its `role` is `"expert"`
- **And** its `description` mentions competitive analysis, product research, and PRD-level product design

#### Scenario: Agent workspace exists with identity and soul files

- **Given** the directory `ai-assets/agents/product-strategist/`
- **When** its contents are listed
- **Then** `IDENTITY.md` exists with `name`, `nickname`, `emoji`, and `animal` fields
- **And** `SOUL.md` exists with sections for Personality, Tone, Verbosity, Collaboration Style, and Hard Limits

#### Scenario: Agent is reachable as a lead sub-agent

- **Given** the `lead` agent entry in `openteam.json`
- **When** its `subAgentNames` array is read
- **Then** `"product-strategist"` is included
- **And** `lead` can dispatch tasks to the strategist using its description

---

### Requirement: Strategist Tool Surface

The system SHALL grant the `product-strategist` agent a tool surface sufficient for browser-based competitor scans, file-based deliverables, and clarifying questions, while excluding tools that belong to other roles.

#### Scenario: Allowed tools include browser, files, and clarification

- **Given** the `product-strategist` entry in `openteam.json`
- **When** its `allowedTools` field is read
- **Then** the list contains at minimum `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`, and `AskUserQuestion`

#### Scenario: Browser automation is available via shared default

- **Given** `agents.defaults.mcpServers` declares the `playwright` MCP server
- **When** the strategist agent loads
- **Then** the `playwright` MCP server is merged into its server list
- **And** the strategist's `skills` array includes `"playwright-cli"`

#### Scenario: Engineering and dispatching tools are excluded

- **Given** the strategist's `allowedTools`
- **When** the list is inspected
- **Then** task-orchestration tools (e.g. `TaskCreate`, `TaskUpdate`) are absent
- **And** no deployment or publish tools are present

---

### Requirement: Strategist Scope Boundaries

The agent's `SOUL.md` SHALL hard-limit deliverables to research and PRD-level design and SHALL hand off implementation and high-fidelity visual design to other experts.

#### Scenario: Soul declares low-fi-only design boundary

- **Given** `ai-assets/agents/product-strategist/SOUL.md`
- **When** its Hard Limits section is read
- **Then** it states that high-fidelity visual design hands off to `ui-designer`
- **And** it states that frontend or backend implementation hands off to `fullstack-product-engineer`

#### Scenario: Soul declares war-room contract

- **Given** `SOUL.md`'s Collaboration Style section
- **When** it is read
- **Then** it references the whiteboard protocol
- **And** it specifies that decisions, constraints, artifacts, and open questions are written to the war room
