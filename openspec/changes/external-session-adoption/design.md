# Design — External Session Adoption

## Architecture Overview

```
                                            ┌──────────────────────┐
                                            │  Filesystem          │
                                            │   ~/.claude/projects │
                                            │   ~/.codex/sessions  │
                                            └──────────┬───────────┘
                                                       │
        ┌─── tier 1 ─── (startup, background) ─────────┤
        │ DirectoryEnumerator                          │
        │  - claude: readdir top-level project dirs    │
        │           → derive cwd from project key      │
        │           → stat per dir (count + mtime)     │
        │  - codex:  readdir YYYY/MM/DD                │
        │           → read line 1 of each rollout      │
        │           → group by cwd                     │
        ▼                                              │
   external_dir_index                                  │
   (cwd, providers, count, latest_mtime, hidden)       │
        │                                              │
        ▼                                              │
   GET /api/sidebar/groups   ←── reads dirs only       │
        │                                              │
        ▼                                              │
   Sidebar paints groups (collapsed)                   │
                                                       │
        ┌─── tier 2 ─── (on user expand) ──────────────┤
        │ POST /api/external-cwds/:cwd/sessions?cursor=│
        │  - parse header of files in this cwd only    │
        │  - 20/page, mtime DESC                       │
        │  - upsert into external_session_index        │
        ▼                                              │
   external_session_index                              │
   (one row per parsed jsonl in expanded cwd)          │
        │                                              │
        ▼                                              │
   Sidebar shows ExternalSessionRow × N (paginated)    │
                                                       │
        ┌─── tier 3 ─── (on user click row) ───────────┘
        │ POST /api/external-sessions/:id/adopt
        ▼
   chats (source='external', cli_session_id, ...)
        │
        ▼
   Existing chat open / --resume path
```

## Data Model

### Tier 1 — `external_dir_index`

Migration `v21.ts`:

```sql
CREATE TABLE external_dir_index (
  cwd TEXT PRIMARY KEY,
  providers TEXT NOT NULL,                -- 'claude' | 'codex' | 'claude,codex'
  session_count INTEGER NOT NULL,
  latest_mtime_ms INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  last_scanned_ms INTEGER NOT NULL
);
CREATE INDEX idx_edi_latest_mtime ON external_dir_index(latest_mtime_ms DESC) WHERE hidden = 0;
```

Tiny by design: typically tens of rows. Updated on every directory scan.

### Tier 2 — `external_session_index`

```sql
CREATE TABLE external_session_index (
  id TEXT PRIMARY KEY,                    -- "<provider>:<sessionId>"
  provider TEXT NOT NULL,                 -- 'claude' | 'codex'
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  file_path TEXT NOT NULL UNIQUE,
  first_user_message TEXT,                -- truncated 200 chars, may be NULL
  size_bytes INTEGER NOT NULL,
  file_mtime_ms INTEGER NOT NULL,
  scanned_at_ms INTEGER NOT NULL,
  adopted_chat_id TEXT,                   -- FK chats.id, nullable
  parse_error TEXT
);
CREATE INDEX idx_esi_cwd_mtime ON external_session_index(cwd, file_mtime_ms DESC);
CREATE UNIQUE INDEX idx_esi_session ON external_session_index(provider, session_id);
```

Populated **lazily**: only rows for directories the user has expanded. A row stays after collapse — second expand of the same cwd is served from the cache (re-validated against current dir mtime).

### Tier 3 — `chats` (existing)

```sql
ALTER TABLE chats ADD COLUMN source TEXT NOT NULL DEFAULT 'native';   -- 'native' | 'external'
ALTER TABLE chats ADD COLUMN external_cwd TEXT;
```

**Note on adoption idempotency**: chats does **not** have top-level `cli_provider` / `cli_session_id` columns; those are stored inside `expert_sessions` JSON per-agent. Idempotency is enforced at tier 2: `external_session_index.adopted_chat_id` is the source of truth. Adoption looks up `(provider, session_id)` in `external_session_index` and returns the existing `adopted_chat_id` if present; otherwise creates a chat and writes back. The unique index `idx_esi_session` on `(provider, session_id)` is what guarantees no duplicate adoption.

## Loading Strategy — the meat of this proposal

### Startup (≤ 100 ms synchronous, ≤ 200 ms total)

`DirectoryEnumerator.run()` triggered after HTTP listen via `setImmediate`:

**Claude path** — sample-one-jsonl-per-dir + stat the rest:

Note: `cwdToClaudeProjectKey` (`shared/projectKey.ts`) is `cwd.replace(/[/.]/g, '-')` — **lossy** (both `/` and `.` map to `-`). We cannot reverse-derive `cwd` from the directory name. Instead, since all jsonl in one project dir share the same `cwd`, we read the head of **one** file per dir to extract it.

```ts
for (const projectKey of readdirSync(~/.claude/projects)) {
  const projectDir = join(claudeProjects, projectKey)
  const files = readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
  if (files.length === 0) continue

  // pick newest by mtime as the sample (most likely valid)
  let sampleFile = files[0]; let sampleMtime = 0; let latestMtime = 0
  for (const f of files) {
    const m = statSync(join(projectDir, f)).mtimeMs
    if (m > latestMtime) latestMtime = m
    if (m > sampleMtime) { sampleMtime = m; sampleFile = f }
  }

  // Cwd lives in non-first lines (queue-operation rows precede it). Cap at 8 KB.
  const cwd = await extractClaudeCwd(join(projectDir, sampleFile))
  if (!cwd) continue
  upsertDir({ cwd, provider: 'claude', count: files.length, latestMtime })
}
```
For 41 dirs × ~80 files avg = ~3,300 stat calls + 41 head reads ≈ **~50 ms** measured.

**Codex path** — line-1 read per file:
```ts
for (const dayDir of walkCodexDayDirs()) {
  for (const f of readdirSync(dayDir)) {
    if (!ROLLOUT_RE.test(f)) continue
    const fp = join(dayDir, f)
    const stat = statSync(fp)

    // Index has this file already with same (mtime, size)? skip line read.
    if (cachedSessionMatches(fp, stat)) {
      const cached = getCachedSession(fp)
      mergeIntoDirAggregate(cached.cwd)
      continue
    }

    // Read first line only
    const line1 = await readFirstLine(fp, 4096)   // 4 KB cap
    const meta = safeJsonParse(line1)
    const cwd = meta?.payload?.cwd ?? meta?.cwd ?? null
    if (!cwd) continue
    upsertSessionMinimal({ provider: 'codex', sessionId: extract(f), cwd, mtime: stat.mtimeMs, size: stat.size, filePath: fp })
    mergeIntoDirAggregate(cwd)
  }
}
```
For 200 files × 4KB read ≈ **~50 ms** cold; warm runs hit the cache for ≥ 99% files (~5 ms).

`readFirstLine(path, cap)` uses `fs.open` + single `read(0, cap)` and returns the substring before the first `\n`. **Never reads more than `cap` bytes.**

After full enumeration, broadcast WS `external-dirs:ready`. Sidebar can paint groups before this if it has a cached snapshot.

### On directory expand (≤ 250 ms cold, ≤ 50 ms warm)

```
GET /api/external-cwds/:cwd/sessions?cursor=<mtimeMs>&limit=20
```

Server flow:

```ts
1. Check external_session_index for rows where cwd=:cwd, file_mtime_ms < cursor (or no cursor),
   ordered by file_mtime_ms DESC, limit 20. If cache complete for this page → return.

2. If cache miss (first expand or new files appeared):
   - Walk only this cwd's directory (claude project dir + matching codex jsonls already
     mapped to cwd in tier 1).
   - For each file not yet in index, parseHeader (≤ 8 KB, see below).
   - Upsert into external_session_index.
   - Re-query and return page.

3. Response:
   { sessions: ExternalSession[]; nextCursor: number | null; hasMore: boolean }
```

Worst observed directory in the corpus: **~150 files**. Single-page first paint stays under 250 ms even cold (20 × ~3 ms per parse).

### Header-only parse (8 KB hard cap)

```ts
async function parseHeader(path: string): Promise<{ cwd: string | null; firstUser: string | null }> {
  const fd = await fs.open(path, 'r')
  const buf = Buffer.alloc(8192)
  const { bytesRead } = await fd.read(buf, 0, 8192, 0)
  await fd.close()

  const text = buf.subarray(0, bytesRead).toString('utf8')
  const lastNewline = text.lastIndexOf('\n')
  const lines = text.slice(0, lastNewline === -1 ? text.length : lastNewline).split('\n')

  let cwd: string | null = null
  let firstUser: string | null = null
  for (const line of lines) {
    const obj = safeJsonParse(line); if (!obj) continue
    if (!cwd) cwd = obj.cwd ?? obj.payload?.cwd ?? null
    if (!firstUser && obj.message?.role === 'user' && typeof obj.message.content === 'string') {
      firstUser = obj.message.content.slice(0, 200)
    }
    if (cwd && firstUser) break
  }
  return { cwd, firstUser }
}
```

If the user message lives past 8 KB, `firstUser=null` and the row falls back to `${basename(cwd)}/${shortSid}` as label. **Never escalates.**

### Cache invalidation

- On directory expand: compare directory mtime vs. `last_scanned_ms`. If unchanged → serve from index. If changed → re-scan (still bounded to that one directory).
- FS watcher on top-level `~/.claude/projects/` and `~/.codex/sessions/` (2 watchers total) detects added/removed dirs and triggers a tier-1 refresh; per-file changes invalidate the affected dir's `last_scanned_ms`.
- Adopted entries (`adopted_chat_id IS NOT NULL`) are filtered out of the expand response — they show up under the group's `Active Tasks` section as native chats.

## API Contracts

### `GET /api/sidebar/groups`

Tier-1 only — directories with counts.

```ts
{
  workspaces: Array<{
    kind: 'workspace'
    id: string
    name: string
    repositories: Array<{ path: string; name: string }>
    chats: Chat[]                                   // native + adopted external in this ws
    externalDirs: Array<{                           // ws-matched cwds with un-adopted sessions
      cwd: string
      providers: ('claude' | 'codex')[]
      sessionCount: number                          // un-adopted only
      latestMtimeMs: number
    }>
  }>
  unmatchedDirs: Array<{                            // cwd not matched to any workspace
    kind: 'external-cwd'
    cwd: string
    providers: ('claude' | 'codex')[]
    sessionCount: number
    latestMtimeMs: number
  }>
}
```

No session-level data. Cheap query.

### `GET /api/external-cwds/:cwd/sessions?cursor=&limit=20`

Tier-2 — paginated session list for one cwd.

```ts
Response:
{
  sessions: Array<{
    id: string                   // "<provider>:<sessionId>"
    provider: 'claude' | 'codex'
    sessionId: string
    cwd: string
    firstUserMessage: string | null
    mtimeMs: number
    sizeBytes: number
  }>
  nextCursor: number | null      // mtimeMs of last item, or null if no more
  hasMore: boolean
}
```

Mtime keyset cursor: stable even if new files appear during browsing.

### `POST /api/external-sessions/:id/adopt`

Tier-3 — only called by user click on a session row.

Request: `{ workspaceId?: string }`.

Behavior:
1. Insert into `chats` with `source='external'`, `cli_session_id`, `cli_provider`, `external_cwd` if no workspace match.
2. Update `external_session_index.adopted_chat_id`.
3. Decrement that cwd's `session_count` in `external_dir_index`.
4. Idempotent: returns existing chat if already adopted.

Response: `{ chatId: string }`.

### `POST /api/external-cwds/hide`

Body: `{ cwd: string }`. Sets `hidden=1` in `external_dir_index`. Reversible via UI.

### WS events

- `external-dirs:ready` — initial directory enumeration complete (sidebar may already be painted from prior cache; this is a "you can refresh now" signal)
- `external-dirs:changed` — directory contents changed (file added/removed); payload: `{ cwd: string }`. Sidebar invalidates that directory's cached expansion if open.

Note: no batch streaming events. Sidebar requests groups once; expansion responses are direct REST.

## Frontend Changes

### `useSidebarGroups` hook

Replaces sidebar consumer of `useAllChats`. Returns `{ workspaces, unmatchedDirs, loading, refresh }`. Listens to `external-dirs:ready` / `external-dirs:changed` for refetch triggers.

### `useExternalCwdSessions(cwd)` hook

Lazy: only mounts/fires when a directory is expanded. Manages pagination state internally.

```ts
const { sessions, hasMore, loadMore, isLoading } = useExternalCwdSessions(cwd)
```

### Workspace group vs. External-cwd group — explicit distinction

The sidebar must make the difference between a registered workspace and an unregistered external `cwd` visually obvious. They share the `Group` shell but differ in icon, label, sub-sections, and available actions.

| Aspect | Workspace group (`kind: 'workspace'`) | External-cwd group (`kind: 'external-cwd'`) |
|---|---|---|
| Icon | `FolderGit` (current) | `Folder` (plain), muted color |
| Label | `workspace.name` (user-given) | `basename(cwd)` + full path in tooltip |
| Sub-label | repository names | full `cwd` path, dimmed |
| Sections inside | Pinned / Active Tasks / Completed / **Local Sessions (lazy)** | **Local Sessions (lazy) only** |
| Native chats | yes | no — there are no native chats here by definition (no workspaceId) |
| Adopted external chats | appear in Active Tasks / Completed (alongside native) | appear in a single flat list above Local Sessions |
| Group header actions | rename, edit team, delete (existing) | hide group, "promote to workspace" (future) |
| Persisted "expanded" state | yes (existing) | session-only (collapsed by default each load) |
| Empty group behavior | always shown (created intentionally) | hidden when `sessionCount === 0 && adoptedCount === 0` |
| Provider badge on rows | only on adopted external rows | on every row (since all are external) |

In short: **a workspace is something the user owns and configures**; **an external-cwd is something we discovered**. The UI should never blur that line.

The `Group` component takes a `kind` prop and dispatches the visual treatment. No two parallel components.

### `TaskSessionList` refactor

Single rendering path: iterate `[...workspaces, ...unmatchedDirs]`. Inside each group:

```tsx
<Group label={...} icon={...} expanded={expanded} onToggle={toggle}>
  {/* native sections — only for workspace groups */}
  <Section "Pinned">       …
  <Section "Active Tasks"> …
  <Section "Completed">    …

  {/* external sessions section — visible only when expanded */}
  {expanded && externalDir.sessionCount > 0 && (
    <Section label="Local Sessions" count={sessionCount}>
      <ExternalCwdSessions cwd={cwd} />
    </Section>
  )}
</Group>
```

`<ExternalCwdSessions>` calls `useExternalCwdSessions` so the network request fires only on first expansion. List shows 20 rows + "Load more" button.

### `ExternalSessionRow`

Visually identical to `TaskRow` plus a small provider badge (`claude` / `codex`). Click handler:

```ts
const handleClick = async () => {
  const { chatId } = await adopt(sessionId)
  navigate(`/workspace/${workspaceIdOrFallback}/chat/${chatId}`)
}
```

This is the **only** trigger for adoption + resume. No keyboard shortcut, no command palette entry, no batch action.

### Virtualization

If a single page renders > 50 rows after multiple "Load more" presses, switch list to `react-virtual`. Most directories will need 1–2 pages.

## Decisions

1. **Three-tier (dir → session → chat) instead of two-tier**, driven by user requirement "default loads only directories".
2. **Adopt + resume gated on individual session click**. No bulk operations, no eager hydration. Matches user intent and keeps `chats` table clean.
3. **Pagination uses mtime keyset cursor**, not offset — stable when files appear/disappear during browsing.
4. **Codex still requires line-1 read at startup** because codex doesn't organize by cwd. This is the unavoidable cost (≤ 50 ms with cache, ≤ 5 ms warm).
5. **No fs watching at file level**. Only top-level dirs. Per-cwd cache invalidates by directory mtime when expanded.
6. **JSONL stays SoT** for messages. The two index tables are caches that can be rebuilt at any time.
7. **Adopted sessions disappear from "Local Sessions" section** and reappear under group's `Active Tasks` (or `Completed`) — they're now native chats.

## Failure Modes

| Failure | Behavior |
|---|---|
| `~/.claude/projects` missing | Skip Claude tier 1, no error |
| `~/.codex/sessions` missing | Skip Codex tier 1, no error |
| Permission denied on a file | Log warn, file omitted from index |
| Malformed jsonl line | `safeJsonParse` returns null, line skipped |
| Header has no user message in 8 KB | `firstUserMessage = null`, row still listed with fallback label |
| `cwd` field missing | Codex: file skipped (can't group). Claude: derive from project key path |
| Directory expand request times out | Return cached page if any, error toast otherwise; "retry" button on group |
| User adopts session whose cwd no longer exists | Adoption succeeds (chat created), but resume blocked with toast "directory missing" |

## Out of Scope (future work)

- Cross-machine session sync
- Search inside un-adopted external sessions (Cmd-K only sees adopted chats for now)
- Editing / annotating external sessions in place
- Auto-suggest workspace creation from heavy external cwds
- Bulk adopt operations
