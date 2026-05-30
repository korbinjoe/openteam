# Tasks: Audit Agent Performance

## Phase 1: Data Collection & Analysis (DONE)

- [x] Collect raw data from SQLite tables (chats, execution_logs, token_usage, agent_growth)
- [x] Extend coverage to 11 days via JSONL-direct scanning (216 sessions)
- [x] Detect agent identity for pre-DB sessions from JSONL content
- [x] Compute per-Agent performance scorecards (v1: DB-only, v2: full JSONL)
- [x] Analyze multi-agent coordination patterns
- [x] Phase comparison: Pre-DB (May 20-24) vs DB Era (May 25-30)

## Phase 2: Satisfaction Metric Design (DONE)

- [x] Classify user message patterns across all conversations (912 user texts)
- [x] Define signal taxonomy (7 signal types with weights)
- [x] Design Mission Satisfaction Score (MSS) formula
- [x] Compute per-Agent satisfaction scores
- [x] Cross-validate MSS vs task_status — identify discordance (ui-designer paradox)
- [x] Design composite Agent Effectiveness Score

## Phase 3: Dissatisfaction Diagnosis (DONE)

- [x] Extract all 44 dissatisfaction events with conversation context
- [x] Classify into 5 failure modes (UI quality, fix loop, info arch, incomplete, aesthetics)
- [x] Map failure modes to per-Agent root causes
- [x] Identify systemic issues (role mismatch, no self-verification, turn limit)

## Phase 4: Agent Optimization Design (DONE)

- [x] Read current SOUL.md / IDENTITY.md / openteam.json for all agents
- [x] Design fullstack-product-engineer optimizations (visual task handoff, self-verification)
- [x] Design code-reviewer optimizations (scope boundaries, read-only enforcement)
- [x] Design ui-designer optimizations (info arch awareness, convergence rules, anti-AI-taste)
- [x] Design architect optimizations (resolve identity crisis, Option B)
- [x] Design cross-agent universal changes (checkpoint, completeness check)
- [x] Design Lead dispatch decision tree

## Phase 5: Implementation (TODO)

- [ ] Update fullstack-product-engineer SOUL.md with pre-completion checklist and routing rules
- [ ] Create fullstack-product-engineer GUARDRAILS.md
- [ ] Add dev-server to fullstack-product-engineer skills in openteam.json
- [ ] Update code-reviewer SOUL.md with scope boundaries
- [ ] Update code-reviewer in openteam.json (remove Write/Edit, add whiteboard, trim skills)
- [ ] Update ui-designer SOUL.md with design process and info-arch awareness
- [ ] Add playwright-cli, design-taste-frontend, whiteboard to ui-designer in openteam.json
- [ ] Update architect SOUL.md (remove no-code-modification limit, add dual-mode)
- [ ] Add dev-server, playwright-cli, whiteboard to architect in openteam.json
- [ ] Add turn-limit checkpoint section to ALL Agent SOUL.md files
- [ ] Add requirement completeness check section to ALL Agent SOUL.md files
- [ ] Add dispatch decision tree to lead SOUL.md
- [ ] Implement SatisfactionClassifier (server/services/SatisfactionClassifier.ts)
- [ ] Add satisfaction_scores migration (V24)
- [ ] Wire SatisfactionClassifier into ExpertExitHandler
- [ ] Add GET /api/chats/:id/satisfaction API route
- [ ] Wire GrowthStore.increment() on expert session completion

## Phase 6: Validation (TODO)

- [ ] Hand-label 30 Missions for satisfaction model validation
- [ ] Run 2-week A/B comparison after Agent definition changes
- [ ] Produce follow-up audit report comparing metrics against baseline
