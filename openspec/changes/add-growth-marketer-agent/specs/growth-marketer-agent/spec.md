# Capability: Built-In Agent Registry

The set of agents shipped under `ai-assets/agents/` and registered through `openteam.json` defines OpenTeam's default team. Each agent has a workspace directory, an identity / soul declaration, a tool surface, and a routing description that `lead` uses for dispatching.

## ADDED Requirements

### Requirement: Built-In Growth Marketer Agent

The system SHALL ship a built-in agent `growth-marketer` that takes a GitHub repository URL, produces a summary and a tweet draft, and posts the tweet to X via a persistent browser session.

#### Scenario: Agent is registered in openteam.json

- **Given** the project's `openteam.json` is loaded by `AgentRegistry`
- **When** the agent list is enumerated
- **Then** an entry with `id: "growth-marketer"` is present
- **And** its `workspace` points to `./ai-assets/agents/growth-marketer`
- **And** its `role` is `"expert"`
- **And** its `description` mentions GitHub project promotion and posting tweets on X

#### Scenario: Agent workspace exists with identity, soul, and tools files

- **Given** the directory `ai-assets/agents/growth-marketer/`
- **When** its contents are listed
- **Then** `IDENTITY.md` exists with `name`, `nickname`, `emoji`, and `animal` fields
- **And** `SOUL.md` exists with sections for Personality, Tone, Verbosity, Collaboration Style, Core Skills, and Hard Limits
- **And** `TOOLS.md` exists with sections for Allowed Tools, Forbidden Tools, and Environment Constraints

#### Scenario: Agent is reachable as a lead sub-agent

- **Given** the `lead` agent entry in `openteam.json`
- **When** its `subAgentNames` array is read
- **Then** `"growth-marketer"` is included
- **And** `lead` can dispatch promotion tasks using the marketer's description

---

### Requirement: Marketer Tool Surface

The system SHALL grant the `growth-marketer` agent a tool surface sufficient for repo summarisation, file-based drafts, browser-driven posting, and clarifying questions, while excluding tools that belong to other roles.

#### Scenario: Allowed tools include files, web, clarification, and the x-promoter skill

- **Given** the `growth-marketer` entry in `openteam.json`
- **When** its `allowedTools` and `skills` fields are read
- **Then** `allowedTools` contains at minimum `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch`, and `AskUserQuestion`
- **And** `skills` contains `"x-promoter"`, `"playwright-cli"`, and `"whiteboard"`

#### Scenario: Browser automation is available via shared default

- **Given** `agents.defaults.mcpServers` declares the `playwright` MCP server
- **When** the marketer agent loads
- **Then** the `playwright` MCP server is merged into its server list

#### Scenario: Engineering, deployment, and orchestration tools are excluded

- **Given** the marketer's `allowedTools`
- **When** the list is inspected
- **Then** task-orchestration tools (e.g. `TaskCreate`, `TaskUpdate`) are absent
- **And** no deployment, publish, or `git push` tooling is present

---

### Requirement: Marketer Scope Boundaries

The agent's `SOUL.md` and `TOOLS.md` SHALL hard-limit scope to the "GitHub repo → tweet drafted → tweet posted on X" loop and SHALL hand off product, engineering, and visual work to other experts.

#### Scenario: Soul declares promotion-only boundary

- **Given** `ai-assets/agents/growth-marketer/SOUL.md`
- **When** its Hard Limits section is read
- **Then** it states that product code changes hand off to `fullstack-product-engineer`
- **And** it states that high-fidelity images or posters hand off to `image-creator`
- **And** it states that posting platforms other than X are out of scope for this agent
- **And** it states that scheduled posting, posting queues, and multi-post campaigns are out of scope

#### Scenario: Soul declares war-room contract

- **Given** `SOUL.md`'s Collaboration Style section
- **When** it is read
- **Then** it references the whiteboard protocol
- **And** it specifies that decisions (chosen angle/variant), artifacts (posted tweet URL), open questions (angle unclear), and constraints (login expired, selector broken) are written to the war room

#### Scenario: Tools file forbids writes outside marketer surface

- **Given** `ai-assets/agents/growth-marketer/TOOLS.md`
- **When** its Forbidden Tools section is read
- **Then** it forbids `Write`/`Edit` under `web/`, `server/`, `cli/`, `shared/`, `electron/`, and `ai-assets/agents/**` other than the marketer's own workspace
- **And** it forbids any tool that posts to platforms other than X

---

### Requirement: X-Promoter Skill

The system SHALL ship a reusable skill `x-promoter` under `ai-assets/skills/x-promoter/` that exposes the three primitives the marketer composes: summarise a repo, draft a tweet, and post it via a persistent browser session.

#### Scenario: Skill workspace exists with documented entry points

- **Given** the directory `ai-assets/skills/x-promoter/`
- **When** its contents are listed
- **Then** `SKILL.md` exists with a `name`, `description`, and trigger keywords related to promoting GitHub projects on X
- **And** `scripts/summarize-repo.sh`, `scripts/draft-tweet.sh`, and `scripts/post-tweet.sh` exist and are executable
- **And** `prompts/repo-summary.md` and `prompts/tweet-draft.md` exist as Claude prompt templates

#### Scenario: Repo summary primitive produces structured output

- **Given** a public GitHub repository URL
- **When** `summarize-repo.sh <url>` is invoked
- **Then** it writes a JSON document to stdout containing the repo's owner, name, description, primary language, stars, topics, homepage, README tagline and highlights, and the latest release tag when present
- **And** the README excerpt is capped at 4000 characters with badges stripped
- **And** invocation against a private or 404 repo exits non-zero with a clear stderr message and writes no partial JSON

#### Scenario: Draft primitive writes a reviewable file with provenance

- **Given** a valid summary JSON
- **When** `draft-tweet.sh --summary <path>` is invoked
- **Then** a markdown draft is written to `~/.openteam/agents/growth-marketer/drafts/<owner>-<repo>-<timestamp>.md`
- **And** the draft contains 3 variants, each ≤280 characters
- **And** the draft contains a Provenance section that cites the summary facts each variant relies on
- **And** when invoked with `--thread`, each variant may be expressed as 2–5 tweets, with each individual tweet ≤280 characters

#### Scenario: Post primitive defaults to dry run

- **Given** a valid draft file
- **When** `post-tweet.sh --draft <path>` is invoked without `--confirm`
- **Then** the script prints `would post: <body>` for each tweet in the chosen variant
- **And** the script exits with code 11
- **And** no browser navigation to a posting endpoint occurs

#### Scenario: Post primitive uses a persistent browser profile

- **Given** the persistent profile directory `~/.openteam/browser-profiles/x/`
- **When** `post-tweet.sh` launches a Playwright context
- **Then** it uses that directory as the user data dir so cookies persist between invocations
- **And** the directory is created automatically on first run if missing
- **And** no username, password, or session token is read from any other location

#### Scenario: Post primitive surfaces missing login as a constraint

- **Given** the persistent profile is not logged into X
- **When** `post-tweet.sh --draft <path> --confirm` is invoked
- **Then** the pre-flight navigation to `https://x.com/home` detects a redirect to a login page
- **And** the script exits with code 10
- **And** a `constraint` entry is written to the war room indicating the X session needs interactive login
- **And** the script prints clear instructions for logging in once into the persistent profile

#### Scenario: Post primitive captures the posted tweet URL

- **Given** the persistent profile is logged into X and a draft variant is selected
- **When** `post-tweet.sh --draft <path> --confirm` runs successfully
- **Then** the script types the tweet body via ARIA role locators
- **And** clicks Post and waits for the success state
- **And** prints the posted tweet's permalink URL to stdout
- **And** an `artifact` entry is written to the war room containing that URL and the draft file path

#### Scenario: Post primitive fails loudly when selectors break

- **Given** an unexpected X UI layout where the composer cannot be located by ARIA role
- **When** `post-tweet.sh --draft <path> --confirm` runs
- **Then** the script captures a screenshot to `~/.openteam/agents/growth-marketer/drafts/<draft>-failure.png`
- **And** exits with code 20
- **And** writes a `constraint` entry to the war room describing the selector failure
- **And** does not retry the post on its own
