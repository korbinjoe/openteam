# Design: Agent Performance Audit & Optimization System

## Overview

A data-driven system for evaluating and optimizing AI Agent performance in OpenTeam,
consisting of three pillars:

1. **Satisfaction Metric** — Infer user satisfaction from multi-turn conversation signals
2. **Dissatisfaction Diagnosis** — Classify failure modes per Agent to drive targeted fixes
3. **Agent Definition Optimization** — Concrete SOUL.md / skills / config changes per Agent

Data source: 216 sessions, 912 user text messages, 11-day window (2026-05-20 ~ 2026-05-30).

---

## 1. User Satisfaction Metric System

### 1.1 Signal Taxonomy

User text messages in JSONL conversations carry classifiable satisfaction signals:

| Signal | Polarity | Weight | Pattern (regex) | Observed Rate |
|--------|----------|--------|-----------------|---------------|
| Escalation | Strong Negative | -3.0 | `为啥还\|怎么还\|一通.*后\|恶心\|反复修.*修不好` | 0.3% |
| Correction | Negative | -1.5 | `不对\|错了\|重新\|没有实现\|还是没\|没得到解决\|你这也没` | 3.5% |
| Aesthetic Rejection | Negative | -1.0 | `太丑\|不好看\|AI味\|不合理\|不太直观\|浪费空间` | 1.3% |
| Iteration | Mild Negative | -0.5 | `改大\|改小\|改为\|太大了\|太小了\|\d+px` | 4.2% |
| Continue | Weak Positive | +0.5 | `继续\|开干\|实现$\|落地$\|直接` | 5.8% |
| Acceptance | Positive | +1.0 | `好的\|可以\|没问题\|不错\|perfect\|great` | 3.8% |
| Commit | Strong Positive | +2.0 | `^commit\|^提交` | 9.9% |

Excluded from scoring: context resume messages, single-letter choices, pure questions.

### 1.2 Mission Satisfaction Score (MSS)

```
MSS = Σ(signal_weight × count) / user_text_turns × 100

Rating:
  >= 60   HIGH           — first-pass or near-first-pass delivery
  30~59   MEDIUM-HIGH    — delivered with minor friction
  0~29    MEDIUM         — delivered but with notable rework
  < 0     LOW            — user dissatisfied, significant rework or failure
```

Structural bonuses/penalties:

| Condition | Effect |
|-----------|--------|
| Mission ends with `commit` | +10 |
| Single-turn success | +20 |
| Context resume >= 3 | -10 |
| Correction → same topic repeat | -5 per |
| Timeout after corrections | -15 |

### 1.3 Role-Adjusted Baselines

UI work naturally involves more iteration. Per-role weight overrides:

| Agent Role | `iteration` Weight | Rationale |
|------------|-------------------|-----------|
| Default | -0.5 | Standard penalty |
| ui-designer | -0.2 | Visual iteration is expected workflow |

### 1.4 Composite Agent Effectiveness Score

Neither completion rate nor MSS alone tells the full story:

```
Effectiveness = 0.4 × CompletionRate + 0.3 × MSS_normalized + 0.3 × (1 - CorrectionRate)
```

Current results:

| Agent | Completion | MSS | CorrRate | **Effectiveness** |
|-------|-----------|-----|----------|-------------------|
| fullstack-product-engineer | 58% | 22.5% | 3.1% | **73%** |
| ui-designer | 75% | 8.0% | 4.9% | **67%** |
| code-reviewer | 55% | 10.1% | 3.9% | **61%** |

---

## 2. Dissatisfaction Root Cause Taxonomy

44 dissatisfaction events across 216 sessions cluster into 5 failure modes:

| Failure Mode | Count | % | Description |
|-------------|-------|---|-------------|
| UI/Visual quality | 14 | 32% | "AI-flavored" UI, template aesthetics, style mismatch |
| Bug fix loop | 10 | 23% | Fix claimed but doesn't work; no self-verification |
| Info architecture | 8 | 18% | Controls placed at wrong UI hierarchy level |
| Incomplete delivery | 7 | 16% | Multi-item request, only some items addressed |
| Design aesthetics | 5 | 11% | CSS micro-adjustments fail to converge |

### Per-Agent Failure Mode Distribution

| Agent | UI Quality | Fix Loop | Info Arch | Incomplete | Aesthetics | Total |
|-------|-----------|----------|-----------|------------|------------|-------|
| fullstack | 6 | 4 | 2 | 5 | 3 | 21 |
| code-reviewer | 3 | 4 | 3 | 0 | 2 | 12 |
| ui-designer | 1 | 0 | 3 | 1 | 2 | 7 |
| architect | 0 | 1 | 0 | 2 | 0 | 3 |

---

## 3. Agent Definition Optimization Design

### 3.1 fullstack-product-engineer

**Problem**: 43% of its dissatisfaction events (9/21) are visual quality issues — an
engineer doing designer's work.

**SOUL.md additions**:
- Mandatory pre-completion checklist: re-read request, check all sub-items, screenshot
- Task routing rule: visual tasks → handoff to ui-designer
- Anti-pattern: never claim done on UI without browser screenshot

**openteam.json changes**:
- Add `dev-server` to skills (currently missing, prevents self-verification)

**New file**: `GUARDRAILS.md` — codified anti-patterns

### 3.2 code-reviewer

**Problem**: 67% of its dissatisfaction events (8/12) are non-review tasks. Identity
crisis — review agent dispatched as debugger/designer.

**SOUL.md additions**:
- Strict scope boundaries: review and analyze only, no implementation
- Non-review task detection: write open_question to war-room recommending redispatch
- Bug analysis format: trace code path → show root cause line → propose diff (don't apply)

**openteam.json changes**:
- Remove Write/Edit from allowedTools (enforce read-only)
- Remove unused skills (java, go, python)
- Add `whiteboard` skill for handoff communication
- Update description to explicitly exclude implementation

### 3.3 ui-designer

**Problem**: Information architecture errors (2 events) + iteration convergence failure
(3 events). Knows CSS but misses product structure.

**SOUL.md additions**:
- Design process: describe visual hierarchy strategy before writing CSS
- Info architecture awareness: identify control level (Mission/Agent/Chat) before implementing
- Convergence rule: after 3 rounds on same element, pause and ask user for direction
- Anti-AI-taste checklist: no centered gradient headings, no symmetric card layouts

**openteam.json changes**:
- Add `playwright-cli` (screenshot evidence)
- Add `design-taste-frontend` (anti-slop guidance)
- Add `whiteboard` (handoff communication)

### 3.4 architect

**Problem**: SOUL says "no code modification" but actually dispatched to implement.
3 events, all from implementation tasks.

**Decision**: Adopt Option B — allow implementation (data shows 2.6% correction rate,
lowest in fleet; $0.22/turn, cheapest).

**SOUL.md changes**:
- Remove "No code modification" hard limit
- Add dual-mode: review-only tasks → reports; implementation tasks → code + verify
- Add self-verification requirement for implementation mode

**openteam.json changes**:
- Add `dev-server`, `playwright-cli`, `whiteboard` to skills
- Explicitly grant Write/Edit in allowedTools

### 3.5 Cross-Agent Universal Changes

**All SOUL.md files** — two new mandatory sections:

1. **Turn Limit Awareness**: At 70% turn consumption, stop and produce progress summary
2. **Requirement Completeness Check**: Re-read original message before claiming done;
   if multi-item, address every item or explicitly state what's skipped

**Lead SOUL.md** — dispatch decision tree:

| Task keyword | Route to |
|-------------|----------|
| UI/样式/美化/视觉/太丑 | ui-designer |
| code review/审查/评审代码 | code-reviewer |
| debug/修复/fix/状态不对 | fullstack-product-engineer |
| architecture/模块边界/重构 | architect |
| deploy/CI/CD/上线 | devops-engineer |
| logo/图标/品牌 | image-creator |
| 产品调研/竞品分析/PRD | product-strategist |

---

## 4. Implementation Architecture

### 4.1 Satisfaction Hook (ai-assets/hooks/satisfaction-score.sh)

Satisfaction scoring runs as a **hook script** triggered on Agent session exit,
with results stored in the Agent's memory markdown — no database table, no API route,
no server module. JSONL is the source of truth; satisfaction is a derived metric.

```
Trigger:  ExpertExit hook (existing hook mechanism)
Input:    JSONL session file path + agent ID + chat ID
Process:  Parse user text messages → regex-match 7 signal types → compute MSS
Output:   Append entry to ~/.openteam/agents/<agent>/memory/satisfaction.md

Entry format (appended per session):
  ## <chat_id> — <date>
  MSS: 22.5 | Turns: 8 | Corrections: 1 | Commits: 2 | Rating: MEDIUM-HIGH
```

Why hook + md instead of server module + SQLite:
- JSONL is the source of truth for messages — derived metrics don't need a separate table
- Hook scripts align with existing war-room and mailbox patterns
- Results are human-readable and co-located with agent growth memory
- No migration, no API route, no server code — significantly lower complexity

### 4.2 Agent Definition File Structure

```
ai-assets/agents/<agent>/
  IDENTITY.md    — name, emoji, animal (no changes)
  SOUL.md        — personality + NEW: scope boundaries, checklists, routing rules
  GUARDRAILS.md  — NEW: anti-patterns (fullstack-product-engineer only)
  BOOT.md        — boot prompt (existing, no changes)
  HEARTBEAT.md   — heartbeat prompt (existing, no changes)
```

---

## 5. Validation Plan

### 5.1 Satisfaction Model Validation

1. Hand-label 30 Missions as satisfied/unsatisfied/mixed
2. Compute MSS, check separation between groups
3. Calibration targets: >80% precision on unsatisfied, >95% recall on commit=satisfied

### 5.2 Agent Optimization Validation

After implementing SOUL.md changes, run a 2-week A/B period:
- Track correction rate, escalation rate, timeout rate per Agent
- Compare against pre-optimization baseline (this report)
- Target: correction rate 3.5% → 2.0%, timeout rate 30% → 15%

---

## 6. Projected Impact

| Metric | Current | After P0+P1 | Improvement |
|--------|---------|-------------|-------------|
| Correction rate (fleet) | 3.5% | ~2.0% | -43% |
| Escalation rate | 0.3% | ~0.1% | -67% |
| Timeout rate | 30% | ~15% | -50% |
| Role mismatch events | ~8/216 | ~2/216 | -75% |
| Avg Agent Effectiveness | 67% | ~78% | +16% |
