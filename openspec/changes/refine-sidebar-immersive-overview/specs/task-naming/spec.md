# Spec: Task Naming

## Overview

Every task / chat surfaced in the sidebar, breadcrumbs, and notifications MUST have a human-readable, distinguishable title. Newly created chats start with no title; the system MUST auto-derive one from the first user message, write it back to the chat record, and protect explicit user renames from being overwritten. Internal placeholder strings MUST NOT be rendered to end users.

## ADDED Requirements

### Requirement: Title auto-derivation from first user message

When a chat receives its first `user` message and its title is still in the "derived" state (no explicit user rename), the system MUST derive a title from that message using a deterministic rule set and persist it to the chat record.

#### Scenario: New chat gets a derived title within 1 second of the first user message

**Given** a newly created chat with `title_is_derived = 1` and an empty title
**When** the user sends the message `"Implement OAuth login with PKCE"`
**Then** within 1 second the chat's `title` is updated to `Implement OAuth login with PKCE`
**And** `title_is_derived` remains `1`
**And** the sidebar row reflects the new title without a manual refresh

#### Scenario: Slash-command prefixes are stripped

**Given** a chat receives the first user message `"/fix bug in checkout flow"`
**When** the derivation runs
**Then** the resulting title is `bug in checkout flow` (or its 40-char truncation)

#### Scenario: Long messages are truncated to 40 visible characters on a word boundary

**Given** the first user message is 200 characters of prose
**When** the derivation runs
**Then** the resulting title is at most 40 visible characters
**And** truncation happens at a word boundary
**And** the title ends with `…`

#### Scenario: CJK characters count as one visible character each

**Given** the first user message is `"实现 OAuth 登录,要支持 PKCE 流程并兼容企业 SSO 的回调地址处理"`
**When** the derivation runs
**Then** at most 40 CJK / Latin characters are kept
**And** the title is rendered without garbled multi-byte truncation

#### Scenario: Fewer than 3 visible characters falls back to a generic label

**Given** the first user message is `"?"` (or empty after stripping)
**When** the derivation runs
**Then** the resulting title is `Untitled task`

### Requirement: Explicit user renames lock the title

When a user explicitly sets a chat title, subsequent auto-derivation MUST NOT overwrite it.

#### Scenario: Rename flips the derived flag

**Given** a chat with `title_is_derived = 1` and an auto-derived title
**When** the user renames the chat to `Auth refactor — sprint 14`
**Then** `title_is_derived` is set to `0`
**And** the title is set to `Auth refactor — sprint 14`

#### Scenario: New user messages do not overwrite a locked title

**Given** a chat with `title_is_derived = 0`
**When** the user sends another message
**Then** the title remains unchanged
**And** no derivation runs

### Requirement: One-time backfill for historical chats

A migration MUST backfill titles for chats that predate this change so the sidebar is uniformly readable for existing users.

#### Scenario: Migration locks non-placeholder titles

**Given** a chat whose pre-migration title is `Refactor auth middleware`
**When** the migration runs
**Then** `title_is_derived` is set to `0`
**And** the title is preserved as `Refactor auth middleware`

#### Scenario: Backfill derives titles for placeholder rows

**Given** a chat whose pre-migration title is `New Task` and whose first user message exists
**When** the backfill script runs
**Then** the chat's title is updated to the derived title
**And** `title_is_derived` remains `1`

#### Scenario: Backfill is idempotent

**Given** the backfill has already run once
**When** it is invoked again
**Then** no chat title is altered
**And** no error is raised

### Requirement: Internal placeholders never reach the UI

Strings that match known internal placeholder patterns MUST be replaced with a friendly fallback at render time, in addition to any server-side cleanup.

#### Scenario: `<local-command-...>` placeholder is replaced at render time

**Given** a chat row whose `title` is `<local-command-caveat-stdin>`
**When** the sidebar renders that row
**Then** the displayed name is `Untitled task`
**And** the original string remains in the `aria-label` so screen-reader users can still hear the canonical identifier

#### Scenario: Empty or null title falls back at render time

**Given** an external CLI session row whose first-user-message snapshot is `null` or `''`
**When** the sidebar renders that row
**Then** the displayed name is `Untitled task`

## Related Capabilities

- `task-navigation` — Consumes the derived title to render task rows.
