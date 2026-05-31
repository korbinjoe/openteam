# OpenSpec — Agent Workflow Guide

This file is the authoritative reference for how AI agents interact with OpenSpec in this project.

For the full workflow protocol injected into all agents at runtime, see:
**`ai-assets/system/AGENTS.md`**

## Quick Reference

### Creating a Change Proposal

```bash
# Directory structure
mkdir -p openspec/changes/<change-name>/specs
```

Required files:
- `proposal.md` — What & why (summary, motivation, goals, non-goals, approach, risks)
- `design.md` — How (architecture, data models, API contracts, decisions)
- `tasks.md` — Implementation checklist with `- [ ]` items
- `specs/<module>/spec.md` — Per-module detailed specifications (when applicable)

### Workflow Phases

1. **Propose** — Author creates the change directory and files
2. **Apply** — Implementors work through tasks.md
3. **Verify** — Reviewers write reports to review.md
4. **Archive** — Merge specs to `openspec/specs/`, mark complete

### Triggering Conditions

Use OpenSpec when the task involves:
- New capabilities or features
- Architecture or breaking changes
- Performance/security work spanning multiple modules
- 3+ file changes with design decisions

Skip OpenSpec for:
- Bug fixes (unless architectural)
- Single-file changes
- Config/dependency updates

### Role Map

| Agent | Propose | Apply | Verify |
|-------|---------|-------|--------|
| fullstack-engineer | Author | Implementor | — |
| architect | Reviewer | — | Arch Review |
| code-reviewer | — | — | Code Review |
| ui-designer | — | Implementor | UI Review |
| devops-engineer | — | Implementor (infra) | — |
| lead | Reviewer | Coordinator | — |
