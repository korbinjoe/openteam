---
name: handoff
description: >
  Transfer your current task to a more appropriate Agent when you determine
  another Agent is better suited for the work at hand.
allowed-tools: Bash
---

# Handoff

Transfer your current task to a more appropriate Agent. After a successful
handoff, exit cleanly — the target Agent takes over.

## How to Handoff

1. Summarize what you've done so far and what you've discovered
2. Identify the most appropriate target Agent
3. Call: `bash {SKILL_DIR}/scripts/handoff.sh <agentId> "<task>" '<context-json>'`
4. If the script exits 0 (HANDOFF_OK), exit cleanly — your work is done
5. If the script exits 1 (HANDOFF_FAILED), continue working on the task yourself

## Context JSON Format

```json
{
  "originalUserMessage": "what the user originally asked",
  "workDoneSoFar": "summary of what you accomplished",
  "relevantFiles": ["file1.ts", "file2.tsx"],
  "keyFindings": ["insight 1", "insight 2"]
}
```

## Handoff Targets

| Task domain | Target Agent |
|-------------|-------------|
| Visual/UI/styling/design | ui-designer |
| Code review/quality audit | code-reviewer |
| Architecture/module boundaries/refactoring | architect |
| Deploy/CI/CD/infrastructure | devops-engineer |
| Implementation/bug fixes/features | fullstack-engineer |
| Logo/icon/image creation | image-creator |
| Product research/PRD/competitive analysis | product-strategist |
| Promotion/X posts/social media | growth-marketer |
| Agent evolution/prompt optimization | sensei |

## Constraints

- Max 1 handoff per task (no chained handoffs)
- Same chat only
- No self-handoff

## Calling Convention

Use Bash's `description` parameter: `Handoff to <agentId>`
