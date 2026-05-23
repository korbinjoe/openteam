# External Session Adoption

## Summary

Make the workspace sidebar a unified "by working-directory" view that surfaces both OpenTeam-native chats AND pre-existing local CLI sessions (Claude Code `~/.claude/projects/`, Codex `~/.codex/sessions/`).

**Loading model is directory-first**: at startup we list **directories only** (cheap), and the per-jsonl metadata under a directory is loaded **on-demand only when the user expands that directory**, paginated. Adopting a session into `chats` and triggering `--resume` only happens when the user clicks a specific jsonl row inside an expanded directory.

## Motivation

Power users have hundreds–thousands of CLI sessions on disk produced **outside** OpenTeam (3,578 jsonl / 1.8 GB measured on the dev machine). Today the sidebar only shows OpenTeam-created chats, so:

- That history is invisible — users cannot organize prior work or resume it
- Users mentally split "OpenTeam tasks" from "real work in CLI" — friction to the AI super-individual thesis
- A naive "scan all jsonl" approach would read tens of MB on every cold start and pollute the chats table

## Goals

1. Sidebar groups by **working directory**: each registered workspace OR each unregistered `cwd` discovered from external jsonl forms one collapsible group.
2. **Directory-first loading**: startup scan enumerates directories only (cwd, file count, latest mtime). It does not parse any jsonl content.
3. **Lazy + paginated session listing**: when the user expands a directory, only that directory's jsonl headers are parsed (page size 20, sorted by mtime desc). "Load more" pulls the next page.
4. **Adopt + resume gated on explicit click**: nothing about a jsonl gets imported, opened, or resumed until the user clicks an individual session row in an expanded directory.
5. Performance budgets (hard):
   - Server cold start adds **≤ 100 ms** synchronous; full directory enumeration completes in **≤ 200 ms** in background
   - Sidebar first paint ≤ **+30 ms** vs. current
   - Expanding a directory: first 20 sessions visible in **≤ 250 ms** (warm cache: ≤ 50 ms)
   - Memory index ≤ **2 MB** (directories only at rest)

## Non-Goals

- No jsonl message persistence to SQLite. JSONL stays the single source of truth.
- No batch import / mass adoption. `chats` table only grows when the user clicks individual sessions.
- No upfront parsing of all 3,578 jsonl headers. Headers are parsed only for directories the user opens.
- No editing / deletion of external jsonl files — read-only on disk.
- Not changing how OpenTeam-native chats spawn / resume.
- Not building a global cross-machine session view — local filesystem only.

## Approach

**Three-tier model** (directory → session → adopted chat):

| Tier | Populated when | Cost |
|---|---|---|
| `external_dir_index` (cwd-keyed) | Server startup, background | 41 readdir + ~200 codex first-line reads ≈ **< 100 ms** |
| `external_session_index` (per-jsonl) | Lazily, when a directory is expanded | Bounded to one directory's jsonl headers, paginated |
| `chats` (with `source='external'`) | When the user clicks a specific session row | One row per explicit click |

The user sees groups (directories) immediately; sessions inside appear when they expand a group; resume happens when they click a session.

**Why this works performance-wise**:

- Claude organizes jsonl by project key dir (`<cwd>` derived) — listing top-level dirs gives us all cwds essentially free.
- Codex organizes by date dir, so we still need a cheap pass: read line 1 (`session_meta`, holds `cwd`) of each codex jsonl. Bounded to ~200 files × 1 line ≈ ~50 ms on the measured corpus.
- We never page-fault the OS into reading 1.8 GB.
- Chats table never gets bulk-loaded; one click = one row.

**Resume reuses existing path**: confirmed `ConfigCompiler.ts:126` already supports `--resume <sessionId>`, and `ExpertResumeHandler.ts:460` handles the JSONL replay. External sessions go through the same code by setting `cli_session_id` + `cli_provider` on the adopted chat.

## Risks

| Risk | Mitigation |
|---|---|
| Codex first-line scan blocks startup briefly | Run in `setImmediate`, batched 50 files; persistent index means warm starts skip unchanged files |
| User expands a directory with thousands of jsonl | Pagination (20/page) + mtime DESC index; expanded view never reads more than first page upfront |
| `chats.source='external'` resume doesn't behave identically | Phase 5 verification tasks explicitly test this; no other code path needs to know about the source |
| Directory-only view feels empty until user clicks | Show file count and latest activity in the directory header so the group is informative without expanding |
| User has hundreds of stale `cwd` polluting sidebar | Per-cwd "hide" affordance; auto-hide cwds with no activity in last 90 days (configurable) |
| Privacy — scanning all CLI history may be unwanted | Settings toggle `external_session_scan.enabled`. Default ON (high value, easily opted out). Off → no scan, no rows shown. |
| First-line codex read fails on malformed jsonl | Skip that file, log warn, don't crash batch |

## Open Questions

- "Hide group" persistence: per-machine or synced via settings store? Recommendation: settings store (already per-user/per-machine in this product).
- Pagination cursor semantics: offset vs. mtime-keyset? Recommendation: **mtime keyset** — stable when new files arrive between page loads.
- Should expanded-directory state persist across reloads? Recommendation: **no** — collapsed by default, fresh paint each load (matches current sidebar behavior).
