# Capability: Code Quality Hygiene

This capability codifies the maintenance rules that emerged from the 2026/05/24 redundancy review: shared utilities for time formatting, removal of dead UI surfaces, and an enforceable rule for commented-out code.

## ADDED Requirements

### Requirement: Single Source of Truth for Time Formatting

The web codebase SHALL expose exactly one `formatDuration` and one `formatRelative` helper, and all UI surfaces SHALL import from that module.

#### Scenario: A new view needs to render an elapsed duration

- **Given** a developer adds a panel that displays a duration in milliseconds
- **When** they format the value for display
- **Then** they import `formatDuration` from `web/lib/format.ts`
- **And** they do not redefine a local helper inside the component file

#### Scenario: A new view needs to render a relative timestamp

- **Given** a developer adds a row that displays "5m ago"
- **When** they format the timestamp
- **Then** they import `formatRelative` from `web/lib/format.ts`
- **And** if i18n is required they pass the `t` translator as the second argument
- **And** if i18n is not required they call it with one argument and accept the short English form

#### Scenario: An existing duplicate is encountered during edits

- **Given** a developer is editing a file that still has a local `formatDuration` or `formatRelative`
- **When** they touch logic adjacent to that helper
- **Then** they replace the local helper with the shared import in the same change
- **And** the proposal's `tasks.md` checklist for time-format consolidation is updated

---

### Requirement: No Dead Initialization Paths

The Electron main process SHALL NOT contain commented-out initialization blocks for features whose implementation modules still ship in production builds.

#### Scenario: A feature is being temporarily disabled

- **Given** a feature must be turned off in `electron/main.ts`
- **When** the developer disables it
- **Then** they either (a) delete the implementation module, build script, and bundled assets in the same change, or (b) gate the call behind an env-flag with a `TODO(owner|issue): re-enable condition` comment
- **And** the build pipeline does not produce artifacts that have no entry point

#### Scenario: The notch feature is reactivated in the future

- **Given** a future change wants to restore the notch UI
- **When** the developer plans the work
- **Then** the work is scoped as a new `add-` change (not a revert) so reactivation goes through the standard propose/apply/verify flow

---

### Requirement: Demo Routes Belong in Storybook or Are Deleted

The shipped web app SHALL NOT carry `/demo/*` routes that exist only as design prototypes for retired explorations.

#### Scenario: A demo page is no longer referenced by an active proposal

- **Given** a `web/pages/*Demo*` page exists
- **And** no active openspec change lists it as in-progress
- **And** the corresponding feature has shipped via the production component
- **When** a maintainer reviews the page
- **Then** the page, its lazy import in `web/App.tsx`, and its `<Route>` entry are deleted in a follow-up change

#### Scenario: A new prototype is needed during exploration

- **Given** a designer wants a sandbox surface to iterate on a UX idea
- **When** they create a prototype page
- **Then** they list it under "Demo pages" in the relevant openspec change's `tasks.md` with a deletion task scheduled for the change's archive phase

---

### Requirement: Commented-Out Code Carries a TODO

Source files in `server/`, `web/`, `cli/`, `shared/`, and `electron/` SHALL NOT contain commented-out executable code without an accompanying `TODO` annotation describing the recovery condition.

#### Scenario: A developer disables a code block during debugging

- **Given** a developer comments out an executable block to test a hypothesis
- **When** they prepare the change for review
- **Then** they either delete the block or attach a single-line comment of the form `// TODO(#<issue> | <owner>): <recovery condition>` directly above the block
- **And** documentation comments explaining design rationale are not subject to this rule

#### Scenario: A reviewer encounters an undocumented commented-out block

- **Given** a PR adds or leaves a commented-out executable block without a `TODO`
- **When** a reviewer applies this rule
- **Then** they request the block be deleted or annotated before approving
- **And** they reference this requirement in the review comment

#### Scenario: An automated check is requested in the future

- **Given** the team wants to enforce this rule via tooling
- **When** they propose ESLint or pre-commit integration
- **Then** they file a separate openspec change for the tooling work — this requirement does not by itself mandate automation
