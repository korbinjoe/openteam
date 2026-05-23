<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# Project Rules

## 项目概述

OpenTeam 是 **AI 超级个体的操作系统** — 让一个人通过编排多个 AI Agent 并行工作，独立完成过去需要一个小团队才能交付的工作量。核心用户工作节奏是脉冲式的：批量派发任务 → 离开去做更高价值的事 → 回来批量验收审查结果。

**设计原则**：注意力优先（节省而非消耗注意力）、离开友好（离开后系统独立运行）、批量操作、成本透明、信任递增。

---

## 技术栈

- 前端：React 18 + TypeScript + Vite + TailwindCSS
- 终端：xterm.js + node-pty
- 后端：Express + tsx
- 桌面：Electron
- CLI：Commander.js + Ink（React for CLI）
- 数据库：better-sqlite3（WAL 模式）
- 包管理：npm

## 关键路径与约定

| 路径 | 说明 |
|------|------|
| `@/` | Vite 路径别名，指向 `web/` |
| `~/.openteam/` | 运行时数据根目录（DB、Agent workspace、临时文件） |
| `~/.openteam/openteam.db` | SQLite 数据库，schema 通过 `server/stores/migrations/` 版本迁移 |
| `openteam.json` | 项目级 Agent 团队配置（Agent 列表、默认模型、Provider） |
| `ai-assets/` | Bundled 资源：Agent 定义 MD、MCP 服务器、Skills、Hooks 脚本 |
| `shared/` | 前后端共享类型（`ws-types.ts`、`ports.ts`） |

## 多 CLI Provider 架构

支持两种 CLI Provider：`claude` | `codex`，核心差异在 session 发现和 JSONL 解析：

- **SessionDiscovery**：策略模式，按 provider 创建不同的文件发现逻辑（`server/terminal/SessionDiscovery.ts`）
- **OutputParser**：接口模式，Claude 用 `ConversationParser`，Codex 用 `CodexParser`
- **SessionFileWatcher**：100% 复用，只注入不同的 parser

新增 CLI Provider 只需实现 `SessionDiscovery` + `OutputParser` 两个接口。

## 消息数据源原则

- **JSONL 文件是对话消息的唯一真实源（Single Source of Truth）**，不在数据库中另建 messages 表
- 消息恢复链路：`chats.expert_sessions` → cliSessionId → JSONL 文件 → `SessionFileWatcher` 解析
- 不得提议将消息持久化到 SQLite，这是项目的设计原则

---

## 规则 1：方案先行

- 涉及 **3 个以上文件** 的改动，必须先输出方案（md 或文字说明），获得确认后再写代码
- **Bug 修复**必须先输出根因分析（含代码路径追踪），确认后再动手
- 用户说"先方案"/"先分析"/"先设计"时，**禁止直接写代码**
- 技术方案应包含：问题描述 → 根因分析 → 解决思路 → 影响范围 → 实施步骤

## 规则 2：最小改动原则

- **只修改与当前任务直接相关的代码**，不做额外重构、优化、美化
- 不引入用户未要求的新抽象层（Buffer、Cache、Queue、Middleware 等）
- 不引入用户未要求的新依赖或新设计模式
- 不擅自更改现有的状态管理方案（不在 props/zustand/context 之间切换）
- 如认为需要额外改动，先说明理由并获得用户确认

## 规则 3：修复后必须输出影响面验证

每次 bug 修复或功能修改完成后，必须输出以下内容：

```
## 影响面验证

### 本次修改的文件
- file1.ts: 改了什么
- file2.tsx: 改了什么

### 可能受影响的功能
- [ ] 功能A：预期是否正常（说明理由）
- [ ] 功能B：预期是否正常（说明理由）

### 高危区域自查
- [ ] 终端渲染（初始加载/刷新/resize）
- [ ] 会话恢复（进入历史会话/刷新后恢复）
- [ ] 页面刷新后状态保持
```

## 规则 4：xterm / PTY 专项规则

这是项目中 bug 最高发的区域，修改前必须格外谨慎：

- 修改 xterm 相关代码前，**先完整阅读**当前的终端组件和 PTY 管理代码
- xterm 尺寸/渲染修改必须覆盖以下 **四个场景**：
  1. 初始加载
  2. 页面刷新
  3. 窗口 resize
  4. 历史会话恢复
- PTY 进程管理改动必须评估对**会话恢复**的影响
- 不添加 PTY 超时回收/自动清理逻辑，除非用户明确要求
- xterm fit addon 的调用时序要考虑 DOM 实际挂载完成

## 规则 5：禁止项

以下行为被明确禁止：

- 不添加用户未要求的 OutputBuffer / DataCache / MessageQueue 等中间层
- 不修改 `~/.claude/settings.json`，除非用户明确要求
- 不在"修 bug"的过程中顺便重构周边代码
- 不添加超时回收、自动清理、定时轮询等后台逻辑，除非用户要求
- 不把用户要求用已有 skill 完成的工作，改为自己重新实现

## 规则 6：代码规范

- 始终用中文回复
- **代码、注释、文档、commit message 必须使用全英文**（对话回复仍用中文，但所有写入文件的内容一律英文）
- 使用 TypeScript strict 模式风格
- 样式只用 Tailwind classes
- 使用 const 箭头函数，不使用分号
- 事件处理函数使用 handle 前缀
- 条件类名使用 cn()
- **单文件代码行数不超过 500 行**，超出时须拆分为 hooks、子组件或工具模块
- **被注释或禁用的代码块必须配 TODO 注释**，包含恢复条件或追踪 link（如 `// TODO(#123): 恢复条件说明`）。无 TODO 的大段注释应删除或恢复
