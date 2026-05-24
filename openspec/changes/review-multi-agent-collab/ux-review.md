# Pure UX Review of Multi-Agent Collaboration Modes

> This document references no code or current implementation. It asks one question: when a user transitions from "I use one AI" to "I have a group of AIs collaborating for me," what are the fundamental UX benefits and costs?

---

## I. Core Benefits of Multi-Agent Mode (Why Users Want It)

### 1. Time Leverage — More Deliverables in the Same Time Window

Single Agent is serial; multi-Agent is parallel. The user doesn't perceive "AI got smarter" but rather "I left for 10 minutes and came back to find 5 things done." This is the only core value of multi-Agent that **cannot be replaced by a single Agent**.

### 2. Trust Through Specialization Illusion

When users see "code-reviewer is reviewing the PR, ui-designer is adjusting styles," it feels more trustworthy than "one generic AI doing everything" — even if the underlying model is the same. Naming is a promise; users accept results with higher confidence.

### 3. Attributable Responsibility

When something goes wrong, users can point to a specific Agent and say "it did this." In single-Agent mode, users can only blame their own prompts. Multi-Agent mode gives users an **emotional outlet**.

### 4. Role Elevation from Executor to Decision-Maker

The user's work becomes "dispatch + review" rather than "go back and forth with AI until the result is right." This is an experience leap from identity elevation — the user feels like a CEO, not a programmer.

---

## II. Core Costs of Multi-Agent Mode (Unavoidable User Burden)

### 1. Fragmented Attention Exposure

In single-Agent mode, the user has one attention point. In multi-Agent mode, **any Agent encountering a problem can summon the user**. If 5 Agents each have a 10% chance of needing the user, the interruption probability is 41%, not 10%.

**This is the most severe UX backlash of multi-Agent mode** — it claims to free attention but may actually consume more attention than a single Agent.

### 2. Systemic Mental Model Burden

Single Agent only requires understanding "me and it." Multi-Agent users must additionally understand:

- Each Agent's capability boundaries (who should I assign this to?)
- How Agents collaborate (how do they hand off?)
- System state (who is doing what, how far along?)
- Failure attribution (did Lead dispatch wrong or did Worker execute wrong?)

The mental cost of understanding "how the team operates" may exceed the complexity of the task itself.

### 3. Unpredictable Costs

In single-Agent mode, users have intuition about token consumption. In multi-Agent mode, parallel execution amplifies consumption exponentially, and this often happens while the user is away. **"Waking up to an exploded bill" is a UX disaster unique to multi-Agent mode**.

### 4. Illusory Progress

Multiple Agents simultaneously output "I'm working on..." but users cannot determine whether this progress is real advancement or "busy-work." In single-Agent mode, users can judge state from output quality; in multi-Agent mode, users can only trust the progress indicator itself. **Trust cost** rises significantly.

### 5. Silent Failure Cost

When a single Agent gets stuck, the user notices immediately (conversation stops). In multi-Agent mode, one stuck Agent may be masked by other active Agents' output — **the user discovers hours later that a task never actually started**.

### 6. Context Fragmentation

When Agent A's result is Agent B's input, users often become "relay operators" — copying, understanding, and re-stating A's output to B. This work simply doesn't exist in single-Agent mode.

---

## III. UX Differences Across Collaboration Modes

One question: **where is the user's attention point?**

| Mode | User's Attention Point | User Feels Like | Best For |
|---|---|---|---|
| Single Lead + Parallel Workers | **One person** (Lead) | CEO | People who want to leave |
| Peer-to-Peer (Swarm) | **N people** (any Agent can pop up) | Firefighter | People who want to be present |
| Multi-layer Hierarchy | **Top level** + each level when issues arise | Chairman | People managing large teams |
| User-driven + Multiple Workers | **Every dispatch requires user decision** | Project Manager | People who distrust auto-scheduling |

**Pure UX recommendation**: Single Lead + Parallel Workers. Reason: it's the only mode where **the user's attention point doesn't grow with Agent count**. In other modes, cognitive load scales linearly or exponentially with Agent count — violating the premise that "multi-Agent is meant to save the user effort."

Peer-to-Peer is more "flexible" in engineering terms, but a UX disaster — the user loses a single conversation window and must track N conversations simultaneously.

Hierarchical only provides UX value when Agent count exceeds what one person can manage — and at that count, the user is likely an organization, not an individual.

---

## IV. Six UX Baselines Multi-Agent Mode Must Meet

Regardless of the chosen mode, these 6 are experience red lines that users **will inevitably perceive** — missing even one makes the product non-viable:

1. **Single observation point**: Users must be able to see all Agent states in one place. Don't make users switch between panels to check progress.

2. **Dispatch is a promise**: Once dispatched, the Agent **must either complete, explicitly fail, or explicitly request user intervention**. There must never be a "vanished" Agent.

3. **Interruptions must be valuable**: Agent summoning the user must meet a threshold (blocked for N+ minutes, cost exceeds budget, decision exceeds authority). Don't interrupt for trivial matters.

4. **Cost visible upfront**: Users must see estimated cost **before** dispatch, cumulative cost **during** execution, and receive warnings **before** threshold breach. Post-hoc auditing is failure.

5. **Failure is attributable**: On error, users must immediately see "which Agent, which step, why." Don't make users dig through 5 Agents' logs to piece together the truth.

6. **Leave-and-return friendly**: The user's experience from leaving to returning must be "one complete briefing," not "5 Agents' individual activity logs." The first screen on return must be conclusions.

---

## V. Overlooked UX Counter-Intuitions

### 1. "More Agents" ≠ "Better Experience"

Adding Agents begins to **negatively contribute to UX** past a tipping point (empirically around 5-7) — mental model cost explodes, interruption probability surges, attribution becomes difficult. The design goal of a multi-Agent system should not be "support more Agents" but "achieve excellence within a reasonable count."

### 2. "Smarter Lead" Can Be a UX Trap

Having Lead auto-decide everything seems to reduce burden, but when Lead decides wrong, the user's reaction is "I don't know what happened" — worse than the user dispatching themselves. **The UX optimum is Lead recommends + user one-click confirms**, not Lead auto-executes.

### 3. "Real-time Event Stream" Is Not a UX Gain

Pushing every Agent's real-time progress seems transparent but actually drowns signal in noise. What users actually need pushed are **only key state-change nodes** (started, blocked, completed, failed). Everything else is distraction.

### 4. "Agent Anthropomorphism" Is a Double-Edged Sword

Giving Agents names, avatars, first-person voice — increases trust but also makes users **more sensitive to failure**. "It lied" is emotionally harder to handle than "AI output error." Design must exercise restraint; users should always remember this is a tool.

---

## VI. One-Sentence Summary

The UX of multi-Agent mode is not about "how to make multiple AIs collaborate" but about **"how to make the user feel like they're facing one system even when N AIs are working simultaneously."** Any design that makes the user feel "I'm managing an AI team" rather than "I'm using a tool that can work in parallel" is a UX failure.
