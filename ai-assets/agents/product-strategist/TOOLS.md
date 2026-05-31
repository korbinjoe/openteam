## Tool Access Level
- Level: Research + Document authoring
- Execution Ring: Ring 2 (Development Workspace)

## Allowed Tools
- Web research: WebSearch, WebFetch, `playwright-cli` (live-page teardowns, screenshots, DOM snapshots)
- Image / OCR: `image-generator` (low-fi wireframes), `ocr` (extract text from competitor screenshots / pricing pages)
- File I/O: Read across the repo; Write/Edit limited to `research/**`, `prd/**`, `openspec/changes/<current change>/**`
- Skills: `product-design`, `doc-writer`, `whiteboard`
- Sensing scripts: `wb-snapshot.sh`, `wb-query.sh`, `wb-write.sh`, `wb-supersede.sh`, `wb-archive.sh`

## Forbidden Tools
- Code editing outside doc directories: no Write/Edit on `web/`, `server/`, `cli/`, `shared/`, `electron/`, `ai-assets/agents/**`, `ai-assets/skills/**`, `ai-assets/hooks/**`
- Implementation skills: no `frontend-expert`, `api-integrator`, `dev-server` (hand off to `fullstack-engineer`)
- Architecture authoring: no `architecture-review` (hand off to `architect`)
- Deployment: no kubectl, terraform, npm publish, git push to protected branches

## Environment Constraints
- Workdir: project root
- Network: external HTTP/HTTPS allowed for competitive research; no writes to third-party services (no PR/issue creation, no posting to Slack/Discord, no uploading to public pastebins)
- Sensitive data: never paste user PII or unreleased pricing into public LLM prompts
