# Design: Cleanup Codebase Redundancy

## Decisions

### D1. Delete the notch feature instead of flagging it

**Context**: `NotchManager` initialization is commented out at `electron/main.ts:188-195`. The implementation, native addon, and `web/notch-panel/` UI still ship. No PR or roadmap item references reactivation.

**Options considered**

| Option | Pros | Cons |
|---|---|---|
| A. Delete entirely | Smallest binary, removes confusion, simpler ShortcutManager | Restoring requires git revert across 8+ files |
| B. Keep code, gate behind `OPENTEAM_ENABLE_NOTCH` env | Easy resurrection | Dead code stays in repo; build pipeline still runs notch addon and bundles `web/notch-panel/`; violates "no half-finished implementations" rule |
| C. Move notch sources under `experiments/` | Signals intent | Adds a new top-level convention nobody else uses |

**Decision**: **A**. The git history is the rollback mechanism; carrying inert code in production builds violates project minimalism.

**Trigger to revisit**: If Product files a roadmap item to ship a macOS notch UI within a quarter, restore from the dedicated revert commit referenced in `tasks.md`.

### D2. Single `format.ts` with optional i18n injection

**Context**: Three `formatRelative` implementations exist. Two use i18n (`whiteboard.timeAgo.*` keys), one is short English (`s/m/h/d`).

**Options considered**

| Option | Pros | Cons |
|---|---|---|
| A. One helper, optional `t` argument | Single source of truth; preserves both styles | Slight API ceremony |
| B. Two helpers (`formatRelativeShort`, `formatRelativeI18n`) | Each call site picks intent explicitly | Two exports for nearly-identical logic; risk of drift returns |
| C. Always i18n, add a "short" key set | Most consistent | Forces i18n surface on contexts (graph node labels) that don't need it |

**Decision**: **A**. `t` is optional; absent → short English; present → i18n. This is exactly today's split, just centralized.

```ts
export const formatRelative = (
  source: string | number,
  t?: (key: string, opts?: Record<string, unknown>) => string,
): string
```

### D3. `formatDuration` keeps two output styles via a `precise` flag

**Context**: Existing variants:

- `ExecutionLogPanel`: `1234ms / 12s / 3m 5s` (integer seconds)
- `AgentDNA`: `1234ms / 12.3s / 3.5m` (one decimal, no seconds in minutes)
- `PipelineStage`: `1234ms / 12.3s / 3m 5s` (decimal seconds, integer minutes+seconds)

**Decision**: One helper with `precise?: boolean`. `precise: false` (default) → integer (`12s / 3m 5s`); `precise: true` → one decimal for sub-minute values (`12.3s / 3m 5s`). Each call site picks once.

This is a deliberate simplification: AgentDNA's "3.5m" form gets folded into "3m 30s". One accepted pixel-level diff in the agent DNA card.

### D4. Comment-block rule lives in CLAUDE.md, not in lint config

**Context**: Repo currently has 1 `TODO|FIXME|HACK` total — the rule is effectively unenforced.

**Decision**: Sharpen `CLAUDE.md` rule 6 wording with a concrete example. Do **not** add an ESLint rule in this change — adding tooling is a separate concern with its own decisions (where to put the rule, false-positive handling on JSDoc, CI integration). Recorded as future work.

### D5. Out-of-scope file-size violations are listed, not fixed

**Context**: 22 files exceed 500 lines. Splitting `FileTree.tsx` (1177 lines) is a non-trivial design exercise alone.

**Decision**: This proposal records the list in `proposal.md` "Out-of-Scope" so it's findable, but does not attempt fixes. Each oversized file gets its own change when an owner picks it up. This keeps the current change reviewable in one sitting.

## Verification Plan

1. **Notch removal**: `npm run build` succeeds with zero references to `NotchManager` / `notch-panel` / `notch-preload` in `dist/`. `grep -rn "notch" dist/` empty.
2. **Format consolidation**: All 6 original sites import from `web/lib/format.ts`. Visual snapshots of the 6 affected components match pre-change pixels except for the documented AgentDNA difference.
3. **Demo deletion**: `/demo/mention` and `/demo/queue` return 404 (or the SPA's not-found view). No build warnings about missing chunks.
4. **CLAUDE.md update**: Rule 6 contains a code example showing accepted vs rejected commented-out blocks.

## Open Questions

- Q: Are the demo pages used by any external screencasts or onboarding docs? → Owner: Lead. Resolution required before deletion.
- Q: Does the notch native addon's removal need a corresponding `package.json` cleanup of its node-gyp deps? → Confirm during apply phase by reading `electron/native/package.json` if present.
