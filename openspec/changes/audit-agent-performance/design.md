# Design: User Satisfaction Metric System

## Overview

Based on 996 user text messages across 148 Missions, build a multi-signal satisfaction
scoring system that infers user satisfaction from conversation patterns — no explicit
thumbs up/down required.

---

## 1. Signal Taxonomy

From analyzing real conversation data, user feedback falls into 6 classifiable signal
categories:

| Signal | Polarity | Pattern (regex) | Frequency |
|--------|----------|-----------------|-----------|
| **Correction** | Negative | `不对\|不是\|错了\|重新\|没有实现\|还是没\|没得到解决\|问题还是\|你这也没` | 62 / 996 (6.2%) |
| **Escalation** | Strong Negative | `为啥还\|怎么还\|一通.*后\|恶心\|反复修.*修不好` | 2 / 996 (0.2%) |
| **Aesthetic Rejection** | Negative | `太丑\|不好看\|AI味\|不合理\|不太直观\|有点奇怪\|浪费空间\|区分度.*不.*高` | 12 / 996 (1.2%) |
| **Iteration** | Mild Negative | `改大\|改小\|改为\|改成\|调整\|太大\|太小\|放大\|缩小\|px` | 38 / 996 (3.8%) |
| **Acceptance** | Positive | `好的\|可以\|没问题\|对的\|不错\|perfect\|great` | 35 / 996 (3.5%) |
| **Commit** | Strong Positive | `^commit\|^提交` | 90 / 996 (9.0%) |
| **Continue** | Weak Positive | `继续\|开干\|实现$\|落地$\|开始$\|直接` | 53 / 996 (5.3%) |
| **Choice** | Neutral | `^[A-D][\.\s]?$` (single letter selection) | 11 / 996 (1.1%) |
| **Context Resume** | Excluded | `This session is being continued` | 86 / 996 (8.6%) |
| **Question** | Neutral | `如何\|是否\|怎么\|是不是\|会不会\|能否\|应该` | 116 / 996 (11.6%) |

---

## 2. Scoring Model

### 2.1 Per-Message Weights

Each user text message gets classified and weighted:

```
Signal Weight:
  escalation:           -3.0   (user explicitly frustrated)
  correction:           -1.5   (agent output rejected or wrong)
  aesthetic_rejection:  -1.0   (output quality issue)
  iteration:            -0.5   (needs refinement but direction ok)
  question:              0.0   (neutral interaction)
  choice:                0.0   (neutral selection)
  continue:             +0.5   (implicit approval to proceed)
  acceptance:           +1.0   (explicit positive feedback)
  commit:               +2.0   (strongest positive — user ships the work)
```

### 2.2 Mission Satisfaction Score (MSS)

```
MSS = Σ(signal_weight) / user_text_count × 100

Interpretation:
  MSS >= 60:   High satisfaction — agent delivered well
  MSS 30~59:   Moderate — delivered but with friction
  MSS 0~29:    Low — significant rework required
  MSS < 0:     Negative — agent failed to satisfy
```

### 2.3 Structural Signals (Bonus/Penalty)

Beyond text classification, structural patterns provide additional signal:

| Structural Signal | Effect | Rationale |
|-------------------|--------|-----------|
| Mission ends with `commit` | +10 bonus | User shipped the agent's output |
| Single-turn success (1 user msg → waiting_input) | +20 bonus | First-pass delivery |
| Context resume count >= 3 | -10 penalty | Agent ran out of context repeatedly |
| Correction → same topic repeat | -5 per repeat | Agent didn't fix it the first time |
| Mission timeout after corrections | -15 penalty | Failed to resolve after user feedback |

### 2.4 Agent Satisfaction Score (ASS)

Per-agent aggregate:

```
ASS = weighted_avg(MSS across all missions)
    where weight = sqrt(user_text_count)  // missions with more interaction get more weight
```

---

## 3. Current Agent Satisfaction Assessment

Applying the model to existing data:

| Agent | Missions | User Turns | Corrections | Escalations | Commits | Correction Rate | Satisfaction |
|-------|----------|------------|-------------|-------------|---------|-----------------|-------------|
| **fullstack-product-engineer** | 54 | 200 | 11 | 0 | 39 | 5.5% | **Medium-High** |
| **code-reviewer** | 18 | 74 | 8 | 0 | 13 | 10.8% | **Medium-Low** |
| **ui-designer** | 12 | 99 | 9 | 1 | 7 | 9.1% | **Medium-Low** |
| **product-strategist** | — | — | — | — | — | — | Insufficient data |

### Key Findings

**fullstack-product-engineer** performs the best on satisfaction despite having a lower
task_status success rate (58%). This is because:
- Highest commit count (39) — users frequently ship its output
- Lowest correction rate (5.5%) among active agents
- Most single-turn successes

**code-reviewer** has the highest correction rate (10.8%), confirming the audit report's
finding of role mismatch — debugging tasks generate more corrections than reviews would.

**ui-designer** has a high correction rate (9.1%) but this is partially expected for
visual work, where iteration is the natural workflow. The presence of 1 escalation
("你成功恶心到我了") and high iteration count (15) indicates the agent occasionally
produces outputs that miss the mark significantly.

---

## 4. Correction Pattern Deep-Dive

The 62 correction messages cluster into 4 root causes:

### 4.1 Incomplete Implementation (40%)
> "还是没有实现", "你这也没按 workspace 进行分组展示", "没有实现"

Agent produces code that doesn't satisfy the requirement. Often happens when:
- Requirement has multiple sub-items and agent only addresses some
- Agent interprets the requirement differently than user intended

### 4.2 Regression / Unfixed Bug (25%)
> "这个问题还是没得到解决", "反复修了2、3次了，都修不好", "问题依然存在"

Agent claims to fix something but the fix doesn't work. Highest frustration signal.

### 4.3 Wrong Direction (20%)
> "不是要抛弃前面一版设计", "信息结构不对", "不对,重新来"

Agent takes a fundamentally wrong approach. Usually recoverable with one correction.

### 4.4 Visual Quality (15%)
> "太丑了", "AI味很重", "样式不一致"

Agent's visual output doesn't meet quality bar. Specific to ui-designer and
fullstack-product-engineer on UI tasks.

---

## 5. Implementation Architecture

### 5.1 Data Flow

```
JSONL File (source of truth)
    ↓ parse
User Text Messages
    ↓ classify (regex patterns)
Signal Events [ {type, weight, messageIndex} ]
    ↓ aggregate
Mission Satisfaction Score (MSS)
    ↓ store
satisfaction_scores table (chatId, agentId, mss, signals_json, computedAt)
    ↓ aggregate
Agent Satisfaction Score (ASS)
```

### 5.2 Computation Strategy

**Lazy evaluation**: Compute MSS when a Mission's session ends (expert exit handler),
not in real-time. Store the score in a new `satisfaction_scores` table.

**Re-computation**: When a Mission is re-opened (new user messages added), invalidate
and re-compute the MSS.

**No JSONL parsing in hot path**: The satisfaction scorer runs as a post-processing step
after session exit, not during live conversation.

### 5.3 Database Schema

```sql
CREATE TABLE satisfaction_scores (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  mss           REAL NOT NULL,        -- Mission Satisfaction Score
  user_turns    INTEGER NOT NULL,
  corrections   INTEGER NOT NULL DEFAULT 0,
  escalations   INTEGER NOT NULL DEFAULT 0,
  iterations    INTEGER NOT NULL DEFAULT 0,
  acceptances   INTEGER NOT NULL DEFAULT 0,
  commits       INTEGER NOT NULL DEFAULT 0,
  signals_json  TEXT,                  -- detailed signal breakdown
  computed_at   TEXT NOT NULL,
  UNIQUE(chat_id, agent_id)
);
CREATE INDEX idx_sat_agent ON satisfaction_scores(agent_id);
CREATE INDEX idx_sat_chat ON satisfaction_scores(chat_id);
```

### 5.4 Classifier Module

```typescript
// server/services/SatisfactionClassifier.ts

interface SatisfactionSignal {
  type: 'correction' | 'escalation' | 'aesthetic_rejection' | 'iteration'
      | 'acceptance' | 'commit' | 'continue' | 'question' | 'choice'
  weight: number
  messageIndex: number
  matchedText: string
}

interface MissionSatisfaction {
  mss: number
  userTurns: number
  signals: SatisfactionSignal[]
  corrections: number
  escalations: number
  iterations: number
  acceptances: number
  commits: number
}

// Regex patterns for Chinese + English user feedback classification
const SIGNAL_PATTERNS: Record<string, { regex: RegExp; weight: number }> = {
  escalation:          { regex: /为啥还|怎么还|一通.*后|恶心|反复修.*修不好/i,        weight: -3.0 },
  correction:          { regex: /不对|不是这|错了|重新|没有实现|还是没|没得到解决|问题还是|你这也没/i, weight: -1.5 },
  aesthetic_rejection: { regex: /太丑|不好看|AI味|不合理|不太直观|有点奇怪|浪费空间/i,   weight: -1.0 },
  iteration:           { regex: /改大|改小|改为|改成|太大了|太小了|放大|缩小|\d+px/i,   weight: -0.5 },
  acceptance:          { regex: /好的|可以|没问题|对的|不错|perfect|great|looks good/i, weight: +1.0 },
  commit:              { regex: /^commit|^提交/i,                                     weight: +2.0 },
  continue:            { regex: /继续|开干|^实现$|^落地$|^开始$|直接改|直接落/i,          weight: +0.5 },
}
```

### 5.5 Integration Points

1. **ExpertExitHandler** — After expert session exits, trigger satisfaction computation
2. **ChatStore** — Add `satisfactionScore` field to Chat for quick access
3. **API route** — `GET /api/chats/:id/satisfaction` returns detailed breakdown
4. **Sidebar** — Optional satisfaction indicator (color dot or score) per Mission

---

## 6. Validation Plan

Before deploying to production, validate the model against known outcomes:

1. Hand-label 30 Missions as "satisfied" / "unsatisfied" / "mixed" based on full
   conversation reading
2. Compute MSS for each
3. Check if MSS correctly separates the three groups
4. Adjust weights if correlation is weak

Expected calibration targets:
- Precision on "unsatisfied" detection: > 80%
- Recall on "commit" missions being "satisfied": > 95%
- No false "satisfied" on missions with 2+ corrections and no commit

---

## 7. Future Extensions

1. **Temporal decay**: Recent signals weighted more than early ones (user may be
   frustrated early but satisfied by the end)
2. **Cross-mission tracking**: If user creates a new Mission for the same topic,
   the previous Mission likely failed
3. **Agent-specific baselines**: UI work naturally has more iterations than
   debugging — normalize per agent role
4. **LLM-based classification**: Replace regex with a small model for nuanced
   sentiment detection (e.g., sarcasm, implicit dissatisfaction)
