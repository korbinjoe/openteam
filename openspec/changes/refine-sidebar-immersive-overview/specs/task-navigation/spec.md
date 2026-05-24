# Spec: Task Navigation Sidebar (Immersive-Overview Refinements)

## Overview

The sidebar is an immersive cross-workspace overview: every workspace and task is always rendered regardless of the URL's current `workspaceId`. The URL is a shareable pointer, not a filter. This spec refines the existing sidebar behavior to match that product intent more faithfully — softening workspace headers so they act as separators, preserving information on hover, surfacing `Add Agent` only when the user reaches for it, keeping workload awareness in the collapsed mode, and disambiguating the in-list filter from the global ⌘K command palette.

## MODIFIED Requirements

### Requirement: Sidebar collapse preserves cross-workspace workload awareness

The sidebar MUST support collapsing to a 52px icon-only mode AND, while collapsed, MUST surface per-workspace status counts so the user does not lose workload awareness.

#### Scenario: Collapsed sidebar shows a workspace status strip

**Given** the sidebar is collapsed (52px) and the user has 3 workspaces with mixed activity
**When** the sidebar renders
**Then** between the New Task button and the bottom resource icons a status strip appears
**And** the strip contains one 28px row per workspace, capped at 5 rows
**And** each row shows the workspace's first-character glyph plus up to 3 colored status dots
**And** dot priority is: error (red) > awaiting (yellow) > running (blue)
**And** more than 3 active statuses on one workspace collapses the overflow into a small `+N` chip

#### Scenario: Overflow indicator appears when there are more than 5 workspaces

**Given** the user has 8 workspaces
**When** the collapsed sidebar renders the strip
**Then** only the top 5 workspaces are shown (sorted: hasError desc, running desc, recent activity desc)
**And** a `+3 more` indicator appears below the strip
**And** clicking the indicator re-expands the sidebar

#### Scenario: Clicking a workspace row in the strip re-expands and scrolls

**Given** the sidebar is collapsed and the status strip shows the `infra` workspace
**When** the user clicks the `infra` row
**Then** the sidebar animates back to its expanded width
**And** the `infra` workspace group is scrolled into view inside the expanded list

#### Scenario: Active workspace's row is visually anchored

**Given** the URL currently points at a task inside workspace `openteam`
**When** the collapsed status strip renders
**Then** the `openteam` row's glyph uses the primary text color
**And** all other workspace glyphs use a muted text color

### Requirement: Workspace group headers act as soft separators

Workspace group headers MUST be visually subordinate to task rows so multi-workspace stacking does not fragment the list.

#### Scenario: Workspace header uses small uppercase muted styling

**Given** the sidebar is expanded with 2 or more workspace groups
**When** the headers render
**Then** each header's label uses `10px uppercase tracking-wide` typography
**And** the label color is `text-muted` by default
**And** the label color shifts to `text-secondary` only when that workspace is the active one (matches the URL)

#### Scenario: The active workspace remains identifiable without dominating

**Given** 4 workspace groups are rendered, one of which is active
**When** the user scans the sidebar
**Then** the active workspace's header is identifiable within 1 second
**And** the visual weight of any header is less than the visual weight of any task row beneath it

### Requirement: Hover on a task row reveals actions without removing information

Hovering a task row MUST reveal action buttons (`+ Add agent`, pin/unpin, archive/unarchive) WITHOUT removing or shifting the always-visible meta information (timestamp, count badge).

#### Scenario: Timestamp stays visible while hover actions appear

**Given** a task row whose right-side region shows a `4m` timestamp
**When** the user hovers the row
**Then** the `4m` timestamp remains visible (opacity 1.0)
**And** the action buttons fade in on top of (or beside) the meta region via opacity transition
**And** no element in the row changes its layout box on hover (no horizontal jitter)

#### Scenario: Action group includes Add agent

**Given** a task row's hover action group is visible
**When** the user inspects the buttons
**Then** the group contains an `+` (Add agent) button, a pin/unpin button, and an archive/unarchive button
**And** the `+` button's tooltip reads `Add agent`
**And** clicking the `+` button opens the Add Agent picker with the task pre-selected

#### Scenario: No standalone `+ Add Agent` row inside the agent list

**Given** a task is expanded showing its agents
**When** the sidebar renders the agent list
**Then** there is no dedicated `+ Add Agent` row at the bottom of the agent list
**And** the same affordance is available via the task row's hover `+` button
**And** the task overview pane's empty-team state continues to surface a primary `Add agent` CTA so first-time discoverability is preserved

## ADDED Requirements

### Requirement: In-sidebar input is labeled "Filter", distinct from the global Command Palette

The sidebar's in-list input MUST be labeled and presented as a filter (it narrows the visible list in place) so it is not confused with the global ⌘K command palette (which navigates to results across the whole app).

#### Scenario: Sidebar input uses Filter wording

**Given** the user opens the sidebar's in-list input via the magnifying-glass button or the `/` keybinding
**When** the input renders
**Then** its placeholder reads `Filter tasks…`
**And** its `aria-label` reads `Filter tasks in sidebar`
**And** the button's tooltip reads `Filter sidebar (/)`

#### Scenario: ⌘K command palette wording is unchanged

**Given** the user opens the command palette via `⌘K`
**When** the palette renders
**Then** its wording continues to frame it as a search / command palette
**And** no rename is applied to it as part of this change

## Related Capabilities

- `task-naming` — Provides the canonical title that every task row renders, including the placeholder fallback path.
