# Handoff Skill

Transfer your current task to a more appropriate Agent when you determine
another Agent is better suited for the work at hand.

## When to Handoff

- Task requires skills outside your core competency
- You've spent >3 turns without meaningful progress
- The task explicitly matches another Agent's domain

## How to Handoff

1. Summarize what you've done so far and what you've discovered
2. Identify the most appropriate target Agent
3. Call: `bash {SKILL_DIR}/scripts/handoff.sh <agentId> "<task>" '<context-json>'`
4. If the script exits 0 (HANDOFF_OK), exit cleanly — your work here is done
5. If the script exits 1 (HANDOFF_FAILED), continue working on the task yourself

## Context JSON Format

The third argument is a JSON string with accumulated context:

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
| Visual/UI/styling | ui-designer |
| Code review/quality | code-reviewer |
| Architecture/refactoring | architect |
| Deploy/CI/CD | devops-engineer |
| Implementation/bug fixes | fullstack-product-engineer |
| Logo/image creation | image-creator |

## Constraints

- Max 1 handoff per task (you cannot hand off to an Agent that will hand off again)
- Same chat only
- No self-handoff
