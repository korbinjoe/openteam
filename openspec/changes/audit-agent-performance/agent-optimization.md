# Agent Optimization Report: Dissatisfaction Root Cause & Targeted Fixes

**Based on**: 44 dissatisfaction events across 216 sessions (11-day window)

---

## Summary: Dissatisfaction Task Type Classification

| Task Type | Count | % | Primary Agents | Root Cause |
|-----------|-------|---|----------------|------------|
| **UI/Visual quality** | 14 | 32% | fullstack (6), ui-designer (5), code-reviewer (3) | Agent produces "AI-flavored" UI, lacks design taste |
| **Bug fix loop** | 10 | 23% | code-reviewer (4), fullstack (4), architect (2) | Fix doesn't actually work; no self-verification |
| **Information architecture** | 8 | 18% | ui-designer (3), code-reviewer (3), fullstack (2) | Agent misunderstands UI hierarchy/structure |
| **Incomplete implementation** | 7 | 16% | fullstack (5), architect (2) | Delivers partial work, misses sub-requirements |
| **Design aesthetics** | 5 | 11% | fullstack (3), ui-designer (2) | Raw CSS/layout lacks polish, "template" feel |

---

## Per-Agent Dissatisfaction Analysis & Optimization Plan

---

### 1. fullstack-product-engineer (21 events)

#### 1.1 Dissatisfaction Pattern Breakdown

| Pattern | Count | Examples |
|---------|-------|---------|
| **Visual output quality** | 9 | "太丑了", "AI味太重", "设计审美太low", "样式和设计稿不一致" |
| **Incomplete delivery** | 6 | "没有实现", "只实现了splash-screen", "功能和项目实际不一致" |
| **Logic/state bugs** | 4 | "计时是假的", "Queue没继续", "状态色不对", "路径处理不对" |
| **UX misjudgment** | 2 | "通知逻辑不合理", "搜索框常驻浪费空间" |

#### 1.2 Root Cause Analysis

**Problem 1: UI work shouldn't land here** — 9 of 21 dissatisfaction events are visual
quality issues. This Agent is an engineer, not a designer. When given "设计一个开屏界面"
or "左侧菜单UI优化", it produces functional but ugly output.

**Problem 2: No self-verification against requirements** — 6 events are "没实现完"
(incomplete implementation). The Agent delivers and says "done" without checking all
sub-items in the original request.

**Problem 3: Edge-case state bugs** — 4 events involve timing/state issues (fake timer,
queue not resuming, intermittent status color). The Agent doesn't test edge cases before
claiming completion.

#### 1.3 Optimization Recommendations

**SOUL.md changes:**

```markdown
## Mandatory Pre-Completion Checklist
Before reporting any task as done:
1. Re-read the original user request word by word
2. Check off every sub-requirement — if any is unaddressed, implement it or
   explicitly call it out as out of scope
3. For UI changes: run dev-server and take a screenshot via playwright-cli
4. For state/timing bugs: test the fix scenario AND 2 related edge cases

## Task Routing Rules
- If the task is primarily about visual design, aesthetics, or UI polish:
  → Write to war-room requesting handoff to ui-designer
  → Do NOT attempt "design" work yourself — your strength is engineering logic
- If the task mentions "设计", "样式", "UI优化", "美化", "视觉":
  → Implement the functional skeleton, then handoff visuals to ui-designer
```

**openteam.json changes:**
```json
{
  "skills": ["frontend-expert", "api-integrator", "playwright-cli", "whiteboard", "dev-server"],
  // Add dev-server skill — currently missing, preventing self-verification
}
```

**New file: `ai-assets/agents/fullstack-product-engineer/GUARDRAILS.md`**
```markdown
## Anti-Patterns to Avoid
1. Never claim "done" on UI tasks without a browser screenshot
2. Never produce design mockups (HTML visual prototypes) — that's ui-designer's job
3. Never skip sub-requirements — if the user lists 3 points, address all 3
4. Never leave fake/placeholder implementations (mock timers, hardcoded data)
```

---

### 2. code-reviewer (12 events)

#### 2.1 Dissatisfaction Pattern Breakdown

| Pattern | Count | Examples |
|---------|-------|---------|
| **Failed fix loop** | 4 | "反复修了2、3次修不好", "还是没真正修复", "问题依然存在" |
| **Wrong task type** | 4 | Assigned UI design, logo design, interactive prototype — not code review |
| **Broken output** | 2 | "页面报错 SyntaxError", "状态灯状态不对" |
| **Design quality** | 2 | "设计水平太拉跨", "你成功恶心到我了" |

#### 2.2 Root Cause Analysis

**Problem 1: Role mismatch is severe** — 8 of 12 events are NOT code review tasks.
This Agent was assigned: Logo design (→ escalation), UI prototype building, openspec
command debugging, status light fixing. Its skills (`code-reviewer-react`, etc.) are
review-focused but it's dispatched as a general problem solver.

**Problem 2: No self-test capability** — When doing bug fixes (which it shouldn't be
doing), it can't verify fixes because it lacks `dev-server` and `playwright-cli` skills.
It claims "fixed" based on code analysis alone.

**Problem 3: Its 2 escalation events are the most severe in the fleet** — "恶心到我了"
(logo design task) and "反复修了2、3次修不好" (macOS menu rendering). Both are tasks
completely outside its competency.

#### 2.3 Optimization Recommendations

**SOUL.md changes:**

```markdown
## Scope Boundaries (CRITICAL)
You are a CODE REVIEWER. Your job is to:
- Review code for correctness, performance, security, and maintainability
- Analyze bugs by reading code paths and identifying root causes
- Audit code quality and suggest improvements

You MUST NOT:
- Write or modify production code to fix bugs (hand off to fullstack-product-engineer)
- Create UI designs, mockups, or visual prototypes (hand off to ui-designer)
- Design logos or visual assets (hand off to image-creator)
- Debug by trial-and-error; if you can't fix it by reading code alone, escalate

## When Assigned a Non-Review Task
If the task is clearly NOT a code review:
1. Write to war-room: open_question "This task requires [implementation/design/debug],
   not code review. Recommend dispatching to [agent]."
2. If user insists, do your best but call out the mismatch

## Self-Verification for Bug Analysis
When reporting a bug root cause:
1. Trace the full code path from trigger to symptom
2. Show the specific line(s) that cause the issue
3. Propose a fix with diff, but DO NOT apply it yourself
```

**openteam.json changes:**
```json
{
  "description": "Code review, quality analysis, and bug root cause analysis. Reviews code for correctness, security, and best practices. Does NOT implement fixes or create designs — hands off to the appropriate specialist.",
  "skills": ["code-reviewer-react", "code-reviewer-typescript", "code-reviewer-nodejs", "whiteboard"],
  // Remove java/go/python skills (not used in this project)
  // Add whiteboard for proper handoff communication
  "allowedTools": ["Read", "Glob", "Grep", "Bash", "AskUserQuestion"]
  // Remove Write/Edit to enforce read-only review behavior
}
```

---

### 3. ui-designer (7 events)

#### 3.1 Dissatisfaction Pattern Breakdown

| Pattern | Count | Examples |
|---------|-------|---------|
| **Iteration overshoot** | 3 | "区分度还是不高" after many rounds, "默认收齐逻辑没实现" |
| **Information architecture** | 2 | "信息结构不对", "切换应该在对话区不是Mission级别" |
| **Visual quality** | 1 | "太丑了，AI味很重" |
| **Space efficiency** | 1 | "独占一行浪费空间" |

#### 3.2 Root Cause Analysis

**Problem 1: Doesn't understand information hierarchy** — 2 events where the Agent
placed UI controls at the wrong structural level (Mission-level switch vs. chat-level
switch). This is a product thinking gap, not a visual skill gap.

**Problem 2: Convergence failure** — 3 events where multiple iteration rounds didn't
converge on a satisfactory result. The Agent makes incremental changes but doesn't step
back to rethink the approach.

**Problem 3: Over-reliance on CSS micro-adjustments** — When the user says "区分度不高",
the Agent tweaks font sizes and colors instead of reconsidering the visual hierarchy
strategy (e.g., indentation, grouping, icons).

#### 3.3 Optimization Recommendations

**SOUL.md additions:**

```markdown
## Design Process (MANDATORY)
1. Before writing any CSS, describe the visual hierarchy strategy in 2-3 sentences
2. If the user says "not enough contrast/distinction", step back and rethink the
   STRUCTURE (spacing, grouping, visual weight), not just the surface (color, font-size)
3. After 3 rounds of iteration on the same element, pause and ask: "I've tried
   [approaches X, Y, Z]. Should I take a fundamentally different direction?"

## Information Architecture Awareness
- Before implementing any toggle/switch/control, identify which level it belongs to:
  Mission level → affects all agents in the mission
  Agent level → affects one agent's view
  Chat level → affects the conversation pane only
- If unsure, ask the user: "Should this control affect [level A] or [level B]?"

## Anti-"AI Flavor" Checklist
Before delivering any UI:
1. No centered headings with gradients (looks like a template)
2. No symmetric card layouts (real UIs are asymmetric)
3. Reference the project's existing design tokens (tailwind.config.js)
4. Compare your output to Cursor/Linear/Notion — would it look out of place?
```

**openteam.json changes:**
```json
{
  "skills": ["ui-reviewer", "ui-designer", "dev-server", "playwright-cli", "design-taste-frontend", "whiteboard"],
  // Add: playwright-cli (screenshot evidence before claiming done)
  // Add: design-taste-frontend (anti-slop design guidance)
  // Add: whiteboard (handoff communication)
}
```

---

### 4. architect (3 events)

#### 4.1 Dissatisfaction Pattern Breakdown

| Pattern | Count | Examples |
|---------|-------|---------|
| **Incomplete implementation** | 2 | "没按workspace分组展示", "没实现V2的置顶和归档" |
| **Failed fix verification** | 1 | "问题依然存在。重新审查代码，修复后自我验证" |

#### 4.2 Root Cause Analysis

**Problem 1: SOUL says "no code modification" but it's dispatched to implement** —
The SOUL.md explicitly says "No code modification: Absolutely forbidden to invoke
Write/Edit tools." But 2 of 3 dissatisfaction events are about incomplete IMPLEMENTATION.
The Agent's definition and its dispatch usage are contradictory.

**Problem 2: Self-verification gap** — When it does implement (violating its own SOUL),
it lacks the tools and habits to verify the output works.

#### 4.3 Optimization Recommendations

**Decision required**: The `architect` Agent has an identity crisis. Choose ONE:

**Option A: Pure Reviewer (align with current SOUL)**
- Enforce read-only by removing Write/Edit from allowedTools
- Update description: "Architecture review only. Does NOT implement code."
- Dispatch implementation tasks to `fullstack-product-engineer`

**Option B: Architecture + Implementation (align with actual usage)**
- Update SOUL.md to allow implementation for architectural changes
- Add dev-server and playwright-cli for self-verification
- Remove the "No code modification" hard limit

**Recommended: Option B** — the data shows architect was productive (29 sessions,
2.6% correction rate, $0.22/turn) when doing implementation. Its low correction rate
suggests it actually implements well — the 3 events are outliers.

**SOUL.md changes (Option B):**

```markdown
## Updated Scope
You are an architecture guardian who ALSO implements architectural changes.
- For review-only tasks: produce structured reports, no code changes
- For implementation tasks: write code BUT verify with dev-server before claiming done
- Your unique value: you see the 10,000m view AND can land the code

## Self-Verification (when implementing)
1. Run type-check after changes: tsc --noEmit
2. For UI changes: start dev-server and screenshot
3. Re-read the original requirement and check all items

## Remove: "No code modification" hard limit
(This contradicts actual usage and the Agent performs well when implementing)
```

**openteam.json changes:**
```json
{
  "skills": ["architecture-review", "dev-server", "playwright-cli", "whiteboard"],
  "allowedTools": ["Read", "Write", "Edit", "Glob", "Grep", "Bash"]
}
```

---

## 5. Cross-Agent Systemic Optimizations

### 5.1 Universal SOUL.md Addition (ALL Agents)

```markdown
## Turn Limit Awareness
When you have consumed approximately 70% of your available turns:
1. Stop and produce a progress summary
2. List what's done and what remains
3. Ask: "I'm approaching my turn limit. Should I continue with [next item]
   or hand off the remainder?"

## Requirement Completeness Check
Before reporting "done":
1. Re-read the original user message
2. If the message contains numbered items, bullet points, or "and" conjunctions,
   ensure EVERY item is addressed
3. If any item is skipped, explicitly state why
```

### 5.2 Lead Dispatch Rules Update

Add to `lead/SOUL.md`:

```markdown
## Dispatch Decision Tree

Task mentions "UI design/样式/美化/视觉/太丑"
  → ui-designer (NOT fullstack)

Task mentions "code review/审查/评审代码/安全扫描"
  → code-reviewer

Task mentions "debug/修复/fix/为啥不行/状态不对"
  → fullstack-product-engineer (NOT code-reviewer)

Task mentions "architecture/layering/模块边界/重构"
  → architect

Task mentions "deploy/CI/CD/上线/环境配置"
  → devops-engineer

Task mentions "design logo/图标/品牌"
  → image-creator (NOT code-reviewer)

Task mentions "competitive analysis/产品调研/PRD"
  → product-strategist
```

### 5.3 Skill Gaps Summary

| Agent | Missing Skills | Impact |
|-------|---------------|--------|
| fullstack-product-engineer | `dev-server` | Can't self-verify UI changes |
| code-reviewer | `whiteboard` | Can't properly handoff tasks |
| ui-designer | `playwright-cli`, `design-taste-frontend` | Can't screenshot-verify; no anti-AI-taste guidance |
| architect | `dev-server`, `playwright-cli`, `whiteboard` | Can't verify implementations |
| devops-engineer | `whiteboard` | Can't communicate blockers |
| sensei | `whiteboard` | Can't write audit artifacts |

---

## 6. Implementation Priority Matrix

| Priority | Change | Files Affected | Expected Impact |
|----------|--------|---------------|-----------------|
| **P0** | Add self-verification guidance to ALL SOUL.md | 6 SOUL.md files | Reduce "没实现" corrections by ~50% |
| **P0** | Add dispatch rules to lead SOUL.md | 1 file | Reduce role mismatch events by ~70% |
| **P1** | Update code-reviewer scope boundaries | SOUL.md + openteam.json | Eliminate design/logo dispatch errors |
| **P1** | Add missing skills to openteam.json | 1 file | Enable self-verification across fleet |
| **P1** | Add turn-limit checkpoint to ALL SOUL.md | 6 SOUL.md files | Reduce 30% timeout rate |
| **P2** | Add anti-AI-taste checklist to ui-designer | SOUL.md | Reduce "太丑" feedback |
| **P2** | Add info-architecture awareness to ui-designer | SOUL.md | Reduce "信息结构不对" feedback |
| **P2** | Resolve architect identity crisis (Option B) | SOUL.md + openteam.json | Align definition with usage |
| **P3** | Add GUARDRAILS.md to fullstack-product-engineer | 1 new file | Codify anti-patterns |

---

## 7. Projected Impact

If all P0+P1 changes are implemented:

| Metric | Current | Projected | Improvement |
|--------|---------|-----------|-------------|
| Correction rate (fleet) | 3.5% | ~2.0% | -43% |
| Escalation rate | 0.3% | ~0.1% | -67% |
| Timeout rate (DB era) | 30% | ~15% | -50% |
| Role mismatch events | ~8/216 | ~2/216 | -75% |
| Agent Effectiveness (avg) | 67% | ~78% | +16% |
