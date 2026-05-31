/**
 * ContextBriefing -  Agent
 *
 *  Agent / Whiteboard
 *  +  ≤ BRIEFING_BUDGET_CHARS  markdown
 *  Agent  prompt  ≤120
 *
 *   1. active goal1 + active open_questions 3 + active handoff 2
 *   2. tags  Agent tags / agentId  →
 *   3. 24h  decision/progress  24h  artifact
 *   4.  →
 */

import type {
  WhiteboardEntry,
  WhiteboardSnapshot,
  WhiteboardEntryType,
} from '../../shared/whiteboard-types'
import type { WhiteboardManager } from './WhiteboardManager'
import { createLogger } from '../lib/logger'

const log = createLogger('ContextBriefing')

/** Briefing  ≈ 500 token 1 token ≈ 3-4  */
export const BRIEFING_BUDGET_CHARS = 1800

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

const TYPE_ICON: Record<WhiteboardEntryType, string> = {
  goal: '🎯',
  decision: '📌',
  artifact: '📦',
  progress: '✅',
  open_question: '❓',
  constraint: '⛔',
  handoff: '🔁',
}

export interface BriefingParams {
  chatId: string
  agentId: string
  agentName?: string
  agentTags?: string[]
}

export class ContextBriefing {
  constructor(private wb: WhiteboardManager) {}

  buildForAgent(params: BriefingParams): string {
    const snap = this.wb.getSnapshot(params.chatId)
    if (!snap.goal && snap.active.length === 0) {
      return this.emptyBoardGuidance()
    }

    const ranked = this.rankEntries(snap, params)
    const sections = this.composeSections(snap.goal, ranked)
    return this.formatBudgeted(sections)
  }

  /**
   *  task →  →  briefing
   *  task expert
   *
   * TODO(#whiteboard-on-demand):  ——
   * ConfigCompiler.buildPromptContent  system prompt
   * PostToolUse hook  task message
   */
  maybeWrapTask(task: string, params: BriefingParams): string {
    try {
      const briefing = this.buildForAgent(params)
      if (!briefing) return task
      return `${briefing}\n\n---\n\n${task}`
    } catch (e) {
      log.warn('briefing build failed, fallback to raw task', {
        chatId: params.chatId,
        agentId: params.agentId,
        error: e instanceof Error ? e.message : String(e),
      })
      return task
    }
  }

  /**
   *  PostToolUse  diff `<system-reminder>`
   *  hook  diff  briefing
   *
   *   - entries
   *   -  maxLines  +N more, run wb-snapshot.sh for full
   *   - `- [{type} by {by}] {summary}` wb-cursor-diff.sh
   */
  buildDiff(
    entries: WhiteboardEntry[],
    sinceSeq: number,
    options: { maxLines?: number } = {},
  ): string {
    if (!entries || entries.length === 0) return ''
    const maxLines = options.maxLines ?? 5
    const shown = entries.slice(0, maxLines)
    const extra = entries.length - shown.length
    const lines = shown.map((e) => `- [${e.type} by ${e.by}] ${e.summary}`)
    const footer = extra > 0 ? `\n+${extra} more, run wb-snapshot.sh for full` : ''
    return [
      '<system-reminder>',
      `[War room delta since seq=${sinceSeq}] New ${entries.length} entries:`,
      lines.join('\n') + footer,
      '</system-reminder>',
    ].join('\n')
  }

  private emptyBoardGuidance(): string {
    return [
      '# Chat Shared Context Briefing',
      '',
      '_No entries in the current war room. You are among the first agents to participate in this session._',
      '',
      '**War room protocol**: Write to the war room at key milestones so subsequent agents can perceive context:',
      '- `goal` — When clarifying the objective (Lead is responsible, but you should also write if you clarify it first)',
      '- `decision` — When making technical/design decisions that affect downstream',
      '- `artifact` — When producing reusable code/documentation',
      '- `progress` — When completing a milestone',
      '- `open_question` — When blocked and needing external decision',
      '',
      'Write command：`bash {SKILL_DIR}/scripts/wb-write.sh <type> "<summary ≤120 chars>"`',
    ].join('\n')
  }

  private rankEntries(snap: WhiteboardSnapshot, params: BriefingParams): WhiteboardEntry[] {
    const now = Date.now()
    const tagSet = new Set((params.agentTags ?? []).map((t) => t.toLowerCase()))

    const score = (e: WhiteboardEntry): number => {
      let s = 0
      if (e.type === 'open_question') s += 100
      if (e.type === 'handoff') s += 80
      if (e.type === 'decision') s += 50
      if (e.type === 'constraint') s += 60
      if (e.type === 'progress') s += 30
      if (e.type === 'artifact') s += 40

      if (e.tags?.length && tagSet.size > 0) {
        const hit = e.tags.some((t) => tagSet.has(t.toLowerCase()))
        if (hit) s += 50
      }
      if (e.by === params.agentId || e.by === params.agentName) s += 20

      const age = now - new Date(e.timestamp).getTime()
      if (age > RECENT_WINDOW_MS) s *= 0.5
      if (age > 7 * RECENT_WINDOW_MS) s *= 0.5

      if (age > RECENT_WINDOW_MS && e.type !== 'artifact' && e.type !== 'decision') s *= 0.3

      return s
    }

    return snap.active
      .slice()
      .sort((a, b) => score(b) - score(a))
  }

  private composeSections(
    goal: WhiteboardEntry | null,
    ranked: WhiteboardEntry[],
  ): string[] {
    const lines: string[] = ['# Chat Shared Context Briefing']

    if (goal) {
      lines.push('', `**target** ${TYPE_ICON.goal} ${goal.summary}`)
    }

    const groups: Record<WhiteboardEntryType, WhiteboardEntry[]> = {
      goal: [],
      open_question: [],
      handoff: [],
      constraint: [],
      decision: [],
      progress: [],
      artifact: [],
    }
    for (const e of ranked) groups[e.type]?.push(e)

    const pushGroup = (title: string, type: WhiteboardEntryType, max: number) => {
      const items = groups[type].slice(0, max)
      if (items.length === 0) return
      lines.push('', `**${title}**`)
      for (const e of items) {
        const refs = this.formatRefs(e)
        lines.push(`- ${TYPE_ICON[type]} ${e.summary}${refs}  _by ${e.by}_`)
      }
    }

    pushGroup('Open Questions', 'open_question', 3)
    pushGroup('Handoffs', 'handoff', 2)
    pushGroup('Constraints', 'constraint', 3)
    pushGroup('Key Decisions', 'decision', 4)
    pushGroup('Recent Progress', 'progress', 4)
    pushGroup('Deliverables', 'artifact', 4)

    return lines
  }

  private formatRefs(e: WhiteboardEntry): string {
    if (!e.refs) return ''
    const parts: string[] = []
    if (e.refs.files?.length) parts.push(`files: ${e.refs.files.slice(0, 2).join(', ')}`)
    if (e.refs.artifacts?.length) parts.push(`links: ${e.refs.artifacts.slice(0, 2).join(', ')}`)
    return parts.length ? ` (${parts.join('; ')})` : ''
  }

  private formatBudgeted(sections: string[]): string {
    const text = sections.join('\n')
    if (text.length <= BRIEFING_BUDGET_CHARS) return text

    const truncated = text.slice(0, BRIEFING_BUDGET_CHARS - 80).trimEnd()
    return `${truncated}\n\n_…More entries in war room sidebar, use \`whiteboard.read\` Pull_`
  }
}
