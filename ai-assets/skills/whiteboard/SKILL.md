---
name: whiteboard
description: >
  Chat war-room: cross-Agent proactive sync of key information (goals, decisions, artifacts, blockers, handoffs).
  **Every Agent must proactively write at key moments** — not writing = other Agents can't see context = duplicated effort.
  On boot, if you see `# Chat Shared Context Brief`, read before acting; if you see "war-room has no entries," you are among the first Agents to speak — write proactively per the timing table below.
  Orthogonal to mailbox (point-to-point push) — the war-room is chat-level shared state.
allowed-tools: Bash
hooks:
  PostToolUse:
    - command: bash {HOOKS_DIR}/wb-cursor-diff.sh
      timeout: 5
    - command: bash {HOOKS_DIR}/wb-post-tool-write.sh
      timeout: 5
      matcher: Edit|Write|write_to_file|Task|Agent
  Stop:
    - command: bash {HOOKS_DIR}/wb-auto-extract.sh
      timeout: 5
    - command: bash {HOOKS_DIR}/satisfaction-score.sh
      timeout: 5
---

# War-Room Write Instructions

`whiteboard` is the shared key-information board for all Agents in the current Chat.
The system auto-writes `artifact` (code outputs) and `handoff` (task dispatches) via hooks,
and auto-extracts `goal` and `progress` at turn end.

You only need to **manually call** `wb-write.sh` in these scenarios:
- Important technical decisions (`decision`) — auto-extraction may not be accurate enough
- Blocking issues (`open_question`) — needs explicit articulation
- Hard constraints (`constraint`) — needs precise description

## Entry Type Quick Reference

| Type | Auto/Manual | Description |
|------|-------------|-------------|
| `goal` | Auto (Stop hook, first turn extraction) | Lead's objective after receiving user request |
| `decision` | **Manual** | Technical/design decisions affecting other Agents |
| `artifact` | Auto (PostToolUse hook) | Reusable code/docs/deliverables produced |
| `progress` | Auto (Stop hook completion signal) | A milestone completed |
| `open_question` | **Manual** | Blocking issue requiring external decision |
| `constraint` | **Manual** | Hard constraints discovered (dependency, performance, security) |
| `handoff` | Auto (PostToolUse hook) | Explicitly passing a task to another Agent |

**Don't write**: routine thinking, process details, info derivable from code/git, private state irrelevant to other Agents.

## Environment Variables (Injected)

| Variable | Description |
|----------|-------------|
| `EXPERT_API_BASE` | openteam-server HTTP address |
| `OPENTEAM_CHAT_ID` | Current chat ID |
| `OPENTEAM_INSTANCE_ID` | Your instance ID (injected as `by` field) |

## Commands

### Write Entry

```bash
bash {SKILL_DIR}/scripts/wb-write.sh <type> "<summary>" [tags] [refs-json]
```

- `type`: `goal | decision | artifact | progress | open_question | constraint | handoff`
- `summary`: **≤80 characters**, one sentence that makes it clear (server rejects longer)
- `tags`: optional, comma-separated (e.g., `db,migration`)
- `refs-json`: optional, JSON string (e.g., `'{"files":["a.ts"],"agents":["shield"]}'`)

Returns: JSON of the written entry.

### Read Snapshot

```bash
bash {SKILL_DIR}/scripts/wb-snapshot.sh
```

Returns: `{ goal, active: [...], lastUpdate }` — the active view of the current war-room.

### Query Entries

```bash
bash {SKILL_DIR}/scripts/wb-query.sh [--types=goal,decision] [--tags=db] [--by=forge] [--limit=20] [--status=active]
```

Returns: `{ entries: [...] }` filtered by conditions.

### Supersede Old Entry

```bash
bash {SKILL_DIR}/scripts/wb-supersede.sh <entryId> <type> "<summary>"
```

Old entry marked as `superseded`, new entry inserted simultaneously. Use for "decision update" scenarios.

### Archive Entry

```bash
bash {SKILL_DIR}/scripts/wb-archive.sh <entryId>
```

Mark resolved `open_question` or expired `progress` as `archived`, removing from snapshot.

## Calling Convention

All wb-* script calls must use Bash's `description` parameter, e.g., "Write to war-room: decision",
"Query war-room open questions" — helps UI differentiate.

## Anti-patterns (Don't Do This)

- ❌ Use war-room as a chat log, writing every thought
- ❌ Repeatedly refresh the same goal with `goal` (should `supersede` the old one)
- ❌ Write summary as a long paragraph (hard limit: 80 characters)
- ❌ Write without `by` (script auto-injects from `OPENTEAM_INSTANCE_ID`)
