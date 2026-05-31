# OpenSpec Workflow Protocol

All agents in OpenTeam follow the OpenSpec change workflow for non-trivial work.

## When to Use OpenSpec

Trigger OpenSpec when a task involves ANY of:
- New capabilities or features (not bug fixes)
- Architecture changes or breaking changes
- Performance/security work affecting multiple modules
- Changes spanning 3+ files with design decisions

Bug fixes and small patches do NOT require OpenSpec unless they involve architectural decisions.

## Phases & Role Assignments

### Phase 1: Propose

| Role | Agent | Responsibility |
|------|-------|---------------|
| Author | fullstack-engineer | Create `openspec/changes/<name>/proposal.md`, `specs/`, `design.md`, `tasks.md` |
| Reviewer | architect | Review proposal for architectural soundness |
| Reviewer | lead | Review proposal for scope and feasibility |

**Output path**: `openspec/changes/<change-name>/`

Required files:
- `proposal.md` — Summary, motivation, goals, non-goals, approach, risks
- `design.md` — Technical design (architecture, data models, API contracts)
- `tasks.md` — Implementation task breakdown with checkboxes
- `specs/<module>/spec.md` — Per-module detailed specifications (when needed)

### Phase 2: Apply (Implement)

| Role | Agent | Responsibility |
|------|-------|---------------|
| Implementor | fullstack-engineer | Implement tasks.md items, check off completed |
| Implementor | devops-engineer | CI/CD and infrastructure changes |
| Implementor | ui-designer | UI implementation and visual verification |

Rules:
- Work through `tasks.md` items sequentially
- Check off each task as completed: `- [x] Task description`
- If new tasks emerge during implementation, append to tasks.md

### Phase 3: Verify (Review)

| Role | Agent | Responsibility |
|------|-------|---------------|
| Code Review | code-reviewer | Write report to `review.md` under "Code Review" section |
| Arch Review | architect | Write report to `review.md` under "Architecture Review" section |
| UI Review | ui-designer | Write report to `review.md` under "UI Review" section |

**Output path**: `openspec/changes/<change-name>/review.md`

### Phase 4: Archive

After verification passes:
- Merge delta specs from `openspec/changes/<name>/specs/` into `openspec/specs/`
- Mark the change as complete

## File Structure Convention

```
openspec/
  specs/              # Accumulated project specs (living documentation)
  changes/
    <change-name>/
      proposal.md     # What and why
      design.md       # How (technical design)
      tasks.md        # Implementation checklist
      review.md       # Verification reports
      specs/          # Delta specs for this change
        <module>/
          spec.md
```

## Decision Protocol

When you encounter a technical decision during implementation:
1. Document it in `design.md` under a "Decisions" section
2. Write it to the war-room as a `decision` entry
3. Continue implementation based on that decision

## Bug Fix Workflow

Bug fixes follow a lightweight variant:
1. Create `openspec/changes/<bug-name>/proposal.md` with root cause analysis
2. Create `tasks.md` with fix steps
3. Implement and verify
4. No separate design.md required unless the fix involves architectural changes
