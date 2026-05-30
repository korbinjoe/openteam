# Proposal: Audit Agent Performance

## Summary

Audit all expert Agents' historical performance across 148 native Missions in OpenTeam,
produce a data-driven evaluation report with actionable optimization recommendations.

This is a **read-only analysis task** — no code changes. The deliverable is a structured
report (`report.md`) that evaluates each Agent on success rate, cost efficiency, timeout
behavior, and role fitness, then recommends concrete prompt/config optimizations.

## Motivation

OpenTeam runs 10 specialized Agents. After ~148 Missions we have sufficient signal to
evaluate which Agents deliver reliably and which need tuning. Key concerns:

1. **Timeout rate is high** — 30% of all Missions end in timeout across the fleet.
2. **Cost distribution is skewed** — fullstack-product-engineer accounts for 64% of
   total spend ($3,891) with a 57.8% success rate.
3. **Some Agents are underutilized** — growth-marketer (1 Mission), sensei (2 Missions),
   devops-engineer (2 exec sessions) have minimal data.
4. **No systematic feedback loop** — Agent definitions (IDENTITY.md, SOUL.md) have
   never been revised based on operational data.

## Goals

1. Produce a per-Agent performance scorecard (success rate, cost, timeout rate, error rate).
2. Identify the top 3 systemic issues driving poor outcomes.
3. Recommend specific, actionable optimizations (prompt changes, config changes, role
   reassignment) with expected impact.
4. Establish a baseline for future periodic audits.

## Non-Goals

- Building a new performance dashboard UI (separate change if needed).
- Modifying any Agent definitions or code in this change.
- Parsing JSONL conversation files for message-level analysis (too heavyweight for this scope).

## Approach

1. Query SQLite database for `chats`, `execution_logs`, `token_usage`, `agent_growth` tables.
2. Compute per-Agent metrics: mission count, success/timeout/error rates, cost per mission,
   token efficiency, cache hit rates, average duration.
3. Analyze multi-agent coordination patterns (team compositions, handoff success).
4. Cross-reference with Agent definitions to identify prompt/config gaps.
5. Write findings to `report.md` in this change directory.

## Risks

| Risk | Mitigation |
|------|------------|
| Limited sample size for some Agents | Note confidence level per Agent; focus recommendations on high-N Agents |
| `task_status` may not perfectly reflect user satisfaction | Use `waiting_input` as proxy for "completed successfully" (Agent finished its turn) |
| Token usage data may be incomplete for early Missions | Acknowledge data gaps in report |

## Deliverables

- `report.md` — Full audit report with scorecards, analysis, and recommendations
- `tasks.md` — Task list for executing the analysis
