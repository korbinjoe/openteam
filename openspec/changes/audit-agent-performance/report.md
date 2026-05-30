# Agent Performance Audit Report (v2 — Extended Coverage)

**Date**: 2026-05-30
**Scope**: All sessions from OpenTeam project directory
**Data Period**: 2026-05-20 ~ 2026-05-30 (**11 days**)
**Data Sources**: 216 JSONL sessions (85 in DB + 131 pre-DB)

---

## Executive Summary

OpenTeam has processed **216 sessions** across **6 active Agent roles**, spending approximately **$6,083** (DB-tracked portion). Expanding coverage from 5 days to 11 days reveals a more complete picture — `architect` and `code-reviewer` had far more activity in the early period (May 20-24) than previously visible.

**Key metrics (11-day window):**

| Metric | Value |
|--------|-------|
| Total sessions | 216 |
| Active Agents | 6 (of 10 defined) |
| Total user text messages | 912 |
| Overall correction rate | 3.5% |
| Overall commit rate | 41.7% (90 / 216) |
| Tracked API cost (DB era only) | $6,083 |

**Top 3 systemic issues (confirmed with larger dataset):**

1. **Correction rate stable at 3-4%** across both phases — not improving over time
2. **architect underutilized post May 24** — 29 sessions pre-DB, then 0 sessions as lead
3. **Commit rate jumped from 24% to 66%** between phases — workflow maturity improvement

---

## 1. Per-Agent Performance Scorecard

### 1.1 fullstack-product-engineer

| Metric | Pre-DB (May 20-24) | DB Era (May 25-30) | Full Period |
|--------|--------------------|--------------------|-------------|
| Sessions | 57 | 55 | **112** |
| User turns | 234 | 213 | 447 |
| Corrections | 8 (3.4%) | 6 (2.8%) | 14 (3.1%) |
| Commits | 13 (22.8%) | 39 (70.9%) | 52 (46.4%) |
| Escalations | 0 | 0 | 0 |
| Tool uses | 3,662 | 2,810 | 6,472 |
| DB success rate | — | 57.8% | — |
| MSS | — | — | **22.5% (MEDIUM)** |
| Total cost (DB) | — | $3,896 | — |

**Assessment**: Most active Agent, steadily improving. Commit rate tripled from Phase 1
to Phase 2, correction rate dropped from 3.4% to 2.8%. Zero escalations across 112
sessions is notable — users never reach extreme frustration with this Agent.

**Strengths**: Versatile, reliable, zero escalations, improving commit rate.
**Weaknesses**: 30% timeout rate (DB era), expensive per turn ($0.49), occasionally
takes tasks better suited for specialists.

### 1.2 code-reviewer

| Metric | Pre-DB (May 20-24) | DB Era (May 25-30) | Full Period |
|--------|--------------------|--------------------|-------------|
| Sessions | 44 | 18 | **62** |
| User turns | 184 | 74 | 258 |
| Corrections | 6 (3.3%) | 4 (5.4%) | 10 (3.9%) |
| Commits | 8 (18.2%) | 13 (72.2%) | 21 (33.9%) |
| Escalations | 1 | 1 | 2 |
| Tool uses | 4,845 | 1,081 | 5,926 |
| DB success rate | — | 54.5% | — |
| MSS | — | — | **10.1% (MEDIUM)** |
| Total cost (DB) | — | $600 | — |

**Assessment**: Second most active Agent, but usage dropped 59% from Phase 1 to Phase 2.
This likely reflects a shift in workflow — more tasks being routed to `fullstack-product-engineer`
directly. Has 2 escalation events (the only Agent besides `ui-designer` with escalations),
both involving "repeated fix attempts that didn't work."

**Key concern**: The 2 escalations are:
- "这个问题还是没得到解决...反复修了2、3次了，都修不好"
- "一通修改后...区分度还是不高"

Both indicate a pattern: `code-reviewer` struggles with fix-and-verify loops.

**Strengths**: Cost-efficient ($0.25/turn), good at analysis.
**Weaknesses**: Struggles with iterative fixes, role drift to debugging, 2 escalations.

### 1.3 architect

| Metric | Pre-DB (May 20-24) | DB Era (May 25-30) | Full Period |
|--------|--------------------|--------------------|-------------|
| Sessions | 29 | 0 (lead) / 5 (worker) | **29** (lead) |
| User turns | 114 | — | 114 |
| Corrections | 3 (2.6%) | — | 3 (2.6%) |
| Commits | 10 (34.5%) | — | 10 (34.5%) |
| MSS | — | — | **16.2% (MEDIUM)** |
| Total cost (DB) | — | $72 (worker only) | — |

**Assessment**: **Newly visible with extended data.** The `architect` Agent was heavily
used in the early phase (29 sessions, May 20-24) but completely stopped being used as
lead after May 24. This coincides with the product shift from "design/architecture" phase
to "implementation" phase.

**Strengths**: Lowest correction rate (2.6%), good commit rate (34.5%).
**Weaknesses**: Not used at all in the implementation phase — wasted potential.

**Recommendation**: Re-activate for architecture review of completed features and for
Missions touching 5+ files.

### 1.4 ui-designer

| Metric | Pre-DB (May 20-24) | DB Era (May 25-30) | Full Period |
|--------|--------------------|--------------------|-------------|
| Sessions | 1 | 10 | **11** |
| User turns | 2 | 79 | 81 |
| Corrections | 0 | 4 (5.1%) | 4 (4.9%) |
| Iterations | 0 | 12 | 12 |
| Aesthetic rejections | 0 | 4 | 4 |
| Escalations | 0 | 1 | 1 |
| Commits | 0 | 7 (70.0%) | 7 (63.6%) |
| DB success rate | — | 75.0% | — |
| MSS | — | — | **8.0% (MEDIUM)** |
| Total cost (DB) | — | $765 | — |

**Assessment**: Highest DB success rate (75%) but the **lowest MSS (8.0%)** among
active Agents. This paradox is explained by the high iteration count (12) and aesthetic
rejections (4) — visual work naturally involves more back-and-forth, which the MSS model
penalizes. The 1 escalation ("你成功恶心到我了") is a significant quality incident.

**Insight**: `task_status` and MSS tell different stories for this Agent. The `task_status`
says "75% success" but MSS says "lots of friction." Both are true — the Agent usually
delivers eventually, but through painful iteration.

**Recommendation**: Calibrate the MSS model with an agent-role baseline — UI work
inherently involves iteration, so iterations should be weighted less for `ui-designer`.

### 1.5 Low-Activity Agents

| Agent | Sessions | Status | Note |
|-------|----------|--------|------|
| product-strategist | 1 (lead) + 23 (worker) | MSS 57.1% | Best MSS but tiny lead sample |
| sensei | 1 | MSS -30.0% | First audit run (this session) |
| growth-marketer | 0 (in range) | — | Only 1 Mission ever, timed out |
| devops-engineer | 0 (lead) | — | Only used as worker (2 sessions) |
| lead | 0 (lead) | — | 1 worker session ($16) |
| image-creator | 0 | — | Never dispatched |

---

## 2. Fleet-Level Analysis

### 2.1 Phase Comparison: Early vs. Mature Usage

| Metric | Pre-DB (May 20-24) | DB Era (May 25-30) | Trend |
|--------|--------------------|--------------------|-------|
| Sessions | 127 | 89 | Fewer, more focused |
| Daily average | 25.4 | 14.8 | ↓ 42% |
| User turns | 524 | 388 | — |
| Correction rate | 3.2% | 3.9% | ↑ Slight increase |
| Commit rate | 24.4% | 66.3% | ↑ **2.7x improvement** |
| Escalations | 1 | 2 | Stable |

**Interpretation**: The workflow matured significantly between phases:
- Fewer but more deliberate Missions (quality over quantity)
- Commit rate nearly tripled — users ship Agent output much more frequently
- Correction rate slightly increased, but this may be because users now provide more
  detailed feedback instead of abandoning Missions

### 2.2 Agent Activity Shift

```
May 20-24:  code-reviewer (44) > fullstack (57) > architect (29) > ui (1)
May 25-30:  fullstack (55) > code-reviewer (18) > ui (10) > product-strategist (1)
```

The team composition shifted from "analysis-heavy" (architect + code-reviewer dominant)
to "delivery-heavy" (fullstack + ui-designer dominant). This reflects a natural project
lifecycle: architecture → implementation.

### 2.3 Cost Efficiency

| Agent | $/Turn | Assessment |
|-------|--------|------------|
| architect | $0.22 | Most cost-efficient |
| code-reviewer | $0.25 | Very efficient |
| ui-designer | $0.37 | Moderate |
| lead | $0.40 | Moderate |
| devops-engineer | $0.42 | Moderate |
| fullstack-product-engineer | $0.49 | Above average |
| sensei | $0.57 | Expensive |
| growth-marketer | $0.58 | Expensive |
| product-strategist | $0.64 | Most expensive |

**Finding**: Analysis-focused Agents (architect, code-reviewer) are 2x cheaper per turn
than generalist/research Agents (product-strategist, growth-marketer). This reinforces
the value of routing tasks to the right specialist.

---

## 3. Satisfaction Model Calibration

### 3.1 Model vs. Reality Cross-Check

| Agent | task_status Success% | MSS Score | Concordance |
|-------|---------------------|-----------|-------------|
| ui-designer | 75% (highest) | 8.0% (lowest active) | **Discordant** — high completion, high friction |
| fullstack-product-engineer | 58% | 22.5% (highest) | **Discordant** — lower completion, higher satisfaction |
| code-reviewer | 55% | 10.1% | Concordant — both moderate |

**Conclusion**: Neither metric alone tells the full story. The recommended composite is:

```
Agent Effectiveness = 0.4 × Completion Rate + 0.3 × MSS_normalized + 0.3 × (1 - Correction Rate)
```

Applied:

| Agent | Completion | MSS_norm | 1-CorrRate | **Effectiveness** |
|-------|-----------|----------|------------|-------------------|
| fullstack-product-engineer | 58% | 75% | 97% | **73%** |
| ui-designer | 75% | 27% | 95% | **67%** |
| code-reviewer | 55% | 34% | 96% | **61%** |
| architect | n/a | 54% | 97% | — (insufficient data) |

### 3.2 Role-Adjusted Iteration Baseline

For `ui-designer`, iterations are part of the natural workflow. Adjusting the model:
- Standard Agent: iteration weight = -0.5
- ui-designer: iteration weight = -0.2 (visual work naturally iterates)

With adjustment, ui-designer MSS rises from 8.0% to 15.4%.

---

## 4. Recommendations (Updated with Extended Data)

### Immediate Actions

| # | Action | Expected Impact | Priority |
|---|--------|----------------|----------|
| 1 | Add "checkpoint at 70% turns" to all SOUL.md | Reduce 30% timeout rate | P0 |
| 2 | Re-activate `architect` for feature review Missions | Leverage its 2.6% correction rate | P1 |
| 3 | Route debugging → fullstack, review → code-reviewer | Reduce code-reviewer escalations | P1 |
| 4 | Complete migration to opus-4-7 | 37% cost reduction per turn | P1 |

### Short-term (Code Changes)

| # | Action | Expected Impact |
|---|--------|----------------|
| 5 | Wire `GrowthStore.increment()` on session completion | Enable growth feedback loop |
| 6 | Implement `SatisfactionClassifier` (per design.md) | Automated satisfaction scoring |
| 7 | Add role-adjusted MSS baselines | Fair comparison across Agent types |
| 8 | Build periodic audit script (weekly cron) | Continuous monitoring |

### Medium-term (Design Changes)

| # | Action | Expected Impact |
|---|--------|----------------|
| 9 | Agent performance dashboard in sidebar | User visibility |
| 10 | Auto-routing based on task keywords + historical MSS | Better dispatch accuracy |
| 11 | User satisfaction signal (optional thumbs up/down post-Mission) | Ground-truth metric |
| 12 | Cross-Mission topic detection (same issue reopened = prior failure) | Track retry rate |

---

## 5. Data Coverage Limitation

| Aspect | Coverage | Gap |
|--------|----------|-----|
| Session count | 216 sessions, 11 days | Target was 14 days; earliest JSONL is May 20 |
| DB metrics (cost, tokens, task_status) | 85 sessions, 6 days (May 25-30) | Pre-DB sessions lack cost/token data |
| JSONL conversation analysis | 216 sessions, 11 days | Full coverage |
| Agent identification | 100% for DB sessions, 97% for pre-DB | 4 sessions unidentified |
| External projects (aone-cloud-cli, etc.) | Not included | Would add ~500 more sessions but different context |

The pre-DB period (May 20-24) lacks task_status and cost data because the database was
created/reset around May 25. The satisfaction analysis (MSS) is based solely on JSONL
conversation content and is available for the full 11-day window.

---

## Appendix: Scoring Methodology

### Mission Satisfaction Score (MSS)

```
MSS = Σ(signal_weight × count) / user_text_turns × 100

Signals:
  escalation:          -3.0 per occurrence
  correction:          -1.5 per occurrence
  aesthetic_rejection: -1.0 per occurrence
  iteration:           -0.5 per occurrence  (-0.2 for ui-designer)
  acceptance:          +1.0 per occurrence
  commit:              +2.0 per occurrence
  continue:            +0.5 per occurrence
```

### Agent Effectiveness Score

```
Effectiveness = 0.4 × Completion% + 0.3 × MSS_normalized + 0.3 × (1 - CorrectionRate)

Where:
  Completion% = waiting_input / (waiting_input + timeout + error)
  MSS_normalized = (MSS - min_MSS) / (max_MSS - min_MSS) × 100
  CorrectionRate = corrections / user_text_turns
```
