/** TimelineView — agent  Timeline  */

import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '@/i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Brain, Terminal, AlertCircle,
  ChevronDown, ChevronRight, Search, FilePen, FilePlus2,
  Maximize2, Image as ImageIcon, Loader2,
  Users, PlayCircle, StopCircle, MessageSquare, Clock,
} from 'lucide-react'
import type { Message } from '@/types/chat'
import { formatTokens } from '@/utils/format'
import ImageMessage, { extractGeneratedImages, stripImageMarkers } from '../messages/ImageMessage'
import ExpertProgressBlock from './ExpertProgressView'
import AskUserQuestionCard from '../messages/AskUserQuestionCard'
import PlanApprovalCard from '../messages/PlanApprovalCard'
import TodoWriteCard from '../messages/TodoWriteCard'
import FileDiffView from '../messages/FileDiffView'
import ImageLightbox from '../messages/ImageLightbox'
import {
  type TimelineEntry, type ToolGroup, type ExpertProgressGroup,
  getExpertAction, getReadableToolLabel, groupConsecutiveTools,
} from './timelineHelpers'

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
])

const isImagePath = (filePath: string): boolean => {
  const dotIdx = filePath.lastIndexOf('.')
  if (dotIdx < 0) return false
  return IMAGE_EXTENSIONS.has(filePath.slice(dotIdx).toLowerCase())
}

const extractReadFilePath = (toolName: string, input: string): string | null => {
  if (toolName !== 'Read') return null
  try {
    const parsed = JSON.parse(input)
    if (parsed.file_path && typeof parsed.file_path === 'string') return parsed.file_path
  } catch { /* ignore */ }
  return null
}

const TOOL_SUMMARY_CACHE_MAX = 1000
const toolSummaryCache = new Map<string, string>()

const extractToolSummary = (toolName: string, input: string): string => {
  const cacheKey = `${toolName}\n${input}`
  const cached = toolSummaryCache.get(cacheKey)
  if (cached !== undefined) return cached

  let summary = ''
  try {
    const parsed = JSON.parse(input)

    const expertAction = getExpertAction(toolName)
    if (expertAction) {
      const agentId = parsed.agentId || ''
      switch (expertAction) {
        case 'wait_for_expert': summary = `Waiting ${agentId}`; break
        case 'start_expert': summary = `Start ${agentId}${parsed.task ? ` — ${(parsed.task as string).slice(0, 40)}` : ''}`; break
        case 'stop_expert': summary = `Stop ${agentId}`; break
        case 'send_to_expert': summary = `→ ${agentId}`; break
        case 'list_experts': summary = i18n.t('chat:timeline.listExperts'); break
        case 'stop_all_experts': summary = i18n.t('chat:timeline.stopAll'); break
        case 'check_inbox': summary = i18n.t('chat:timeline.checkInbox'); break
        default: summary = expertAction.replace(/_/g, ' ')
      }
    } else if (toolName === 'Read' && parsed.file_path) {
      summary = parsed.file_path.split('/').pop() || parsed.file_path
    } else if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') && parsed.file_path) {
      const fileName = parsed.file_path.split('/').pop() || parsed.file_path
      if (toolName === 'Edit' && parsed.old_string) {
        const lines = parsed.old_string.split('\n').length
        summary = `${fileName} (${lines} lines)`
      } else if (toolName === 'MultiEdit' && Array.isArray(parsed.edits)) {
        summary = `${fileName} (${parsed.edits.length} edits)`
      } else {
        summary = fileName
      }
    } else if (toolName === 'Glob' && parsed.pattern) {
      summary = parsed.pattern
    } else if (toolName === 'Grep' && parsed.pattern) {
      summary = parsed.pattern
    } else if (toolName === 'Bash' && parsed.command) {
      summary = parsed.command.length > 50 ? parsed.command.slice(0, 50) + '...' : parsed.command
    } else if (toolName === 'WebFetch' && parsed.url) {
      summary = parsed.url.length > 40 ? parsed.url.slice(0, 40) + '...' : parsed.url
    }
  } catch { /* ignore */ }
  if (toolSummaryCache.size >= TOOL_SUMMARY_CACHE_MAX) {
    const entries = [...toolSummaryCache.entries()]
    toolSummaryCache.clear()
    for (const [k, v] of entries.slice(entries.length >> 1)) {
      toolSummaryCache.set(k, v)
    }
  }
  toolSummaryCache.set(cacheKey, summary)
  return summary
}

const getToolIcon = (toolName: string) => {
  const expertAction = getExpertAction(toolName)
  if (expertAction) {
    switch (expertAction) {
      case 'wait_for_expert': return <Clock size={10} style={{ color: 'rgb(var(--accent-purple))' }} />
      case 'start_expert': return <PlayCircle size={10} style={{ color: 'rgb(var(--accent-green))' }} />
      case 'stop_expert':
      case 'stop_all_experts': return <StopCircle size={10} style={{ color: 'rgb(var(--accent-red))' }} />
      case 'send_to_expert': return <MessageSquare size={10} style={{ color: 'rgb(var(--accent-brand))' }} />
      case 'list_experts': return <Users size={10} style={{ opacity: 0.7 }} />
      default: return <Users size={10} style={{ opacity: 0.7 }} />
    }
  }
  switch (toolName) {
    case 'Read': return <Search size={10} style={{ opacity: 0.7 }} />
    case 'Write': return <FilePlus2 size={10} style={{ color: 'rgb(var(--accent-green))' }} />
    case 'Edit': return <FilePen size={10} style={{ color: 'rgb(var(--accent-brand))' }} />
    case 'MultiEdit': return <FilePen size={10} style={{ color: 'rgb(var(--accent-brand))' }} />
    case 'Glob': return <Search size={10} style={{ opacity: 0.7 }} />
    case 'Grep': return <Search size={10} style={{ opacity: 0.7 }} />
    case 'Bash': return <Terminal size={10} style={{ opacity: 0.7 }} />
    default: return <Terminal size={10} style={{ opacity: 0.7 }} />
  }
}

/**  Timeline  toolUse + toolResult */
const buildTimeline = (messages: Message[]): TimelineEntry[] => {
  const entries: TimelineEntry[] = []
  const pendingToolUses = new Map<string, number>()

  for (const msg of messages) {
    if (msg.type === 'toolUse' && msg.toolUse) {
      const idx = entries.length
      if (msg.toolUse.toolName === 'AskUserQuestion') {
        console.debug('[buildTimeline] AskUserQuestion toolUse', { msgId: msg.id, toolId: msg.toolUse.toolId })
      }
      entries.push({
        id: msg.id,
        type: 'tool',
        timestamp: msg.timestamp,
        toolName: msg.toolUse.toolName,
        toolSummary: extractToolSummary(msg.toolUse.toolName, msg.toolUse.input),
        toolInput: msg.toolUse.input,
        hasToolResult: false,
      })
      pendingToolUses.set(msg.toolUse.toolId, idx)
    } else if (msg.type === 'toolResult' && msg.toolResult) {
      const idx = msg.toolResult.toolUseId ? pendingToolUses.get(msg.toolResult.toolUseId) : undefined
      if (idx !== undefined) {
        const entry = entries[idx]
        if (entry.toolName === 'AskUserQuestion') {
          console.debug('[buildTimeline] AskUserQuestion matched toolResult', { toolUseId: msg.toolResult.toolUseId, resultContent: msg.toolResult.content?.slice(0, 50) })
        }
        const resultContent = msg.toolResult.content || ''
        const imagePaths = extractGeneratedImages(resultContent)
        entry.toolResultContent = (imagePaths.length > 0 ? stripImageMarkers(resultContent) : resultContent) || undefined
        entry.toolResultIsError = msg.toolResult.isError
        entry.hasToolResult = true
        pendingToolUses.delete(msg.toolResult.toolUseId!)
        if (imagePaths.length > 0) {
          entries.push({ id: `${entry.id}-images`, type: 'image', timestamp: msg.timestamp, imagePaths })
        }
      } else if (msg.toolResult.isError) {
        entries.push({ id: msg.id, type: 'error', timestamp: msg.timestamp, toolResultContent: msg.toolResult.content, toolResultIsError: true })
      }
    } else if (msg.type === 'thinking' && msg.thinkingSummary) {
      entries.push({ id: msg.id, type: 'thinking', timestamp: msg.timestamp, thinkingText: msg.thinkingSummary })
    } else if (msg.type === 'text' && msg.content) {
      entries.push({ id: msg.id, type: 'text', timestamp: msg.timestamp, textContent: msg.content })
    } else if (msg.type === 'stats' && msg.stats) {
      entries.push({ id: msg.id, type: 'stats', timestamp: msg.timestamp, stats: msg.stats })
    }
  }

  return entries
}

const TimelineToolRow = ({ entry }: { entry: TimelineEntry }) => {
  const { t } = useTranslation('chat')
  const getToolLabel = (name: string) => getReadableToolLabel(name, t)
  const [expanded, setExpanded] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [imgError, setImgError] = useState(false)

  const isWriteOp = entry.toolName === 'Write' || entry.toolName === 'Edit' || entry.toolName === 'MultiEdit'
  const isFileEditTool = isWriteOp
  const isRunning = !entry.hasToolResult
  const Chevron = expanded ? ChevronDown : ChevronRight

  const readImagePath = useMemo(() => {
    if (!entry.toolInput) return null
    const filePath = extractReadFilePath(entry.toolName || '', entry.toolInput)
    if (filePath && isImagePath(filePath)) return filePath
    return null
  }, [entry.toolName, entry.toolInput])

  const imageUrl = readImagePath ? `/api/file?path=${encodeURIComponent(readImagePath)}` : null

  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label={getToolLabel(entry.toolName || '')}
        onClick={() => setExpanded((p) => !p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((p) => !p) } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderRadius: 4, cursor: 'pointer', transition: 'background 0.1s', background: isRunning ? 'rgb(var(--accent-purple) / 0.04)' : undefined }}
        onMouseEnter={(e) => { e.currentTarget.style.background = isRunning ? 'rgb(var(--accent-purple) / 0.08)' : 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = isRunning ? 'rgb(var(--accent-purple) / 0.04)' : 'transparent' }}
      >
        <Chevron size={9} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0, opacity: 0.5 }} />
        {readImagePath ? <ImageIcon size={10} style={{ color: 'rgb(var(--accent-purple))', opacity: 0.7 }} /> : getToolIcon(entry.toolName || '')}
        <span style={{ fontSize: 11, fontWeight: isWriteOp ? 500 : 400, color: isWriteOp ? 'rgb(var(--text-secondary))' : 'rgb(var(--text-muted))', flexShrink: 0 }}>
          {getToolLabel(entry.toolName || '')}
        </span>
        {entry.toolSummary && (
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: "'SF Mono', monospace", opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {entry.toolSummary}
          </span>
        )}
        {entry.toolResultIsError && <AlertCircle size={10} style={{ color: 'rgb(var(--accent-red))', flexShrink: 0 }} />}
        {isRunning && <Loader2 size={10} style={{ color: 'rgb(var(--accent-purple))', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
      </div>

      {imageUrl && !imgError && (
        <div style={{ margin: '4px 0 4px 28px' }}>
          <div style={{ position: 'relative', display: 'inline-block', borderRadius: 6, overflow: 'hidden', border: '1px solid rgb(var(--border-subtle))', background: 'rgb(var(--bg-elevated))', maxWidth: 320 }}>
            <img src={imageUrl} alt={readImagePath?.split('/').pop() || 'image'}
              style={{ display: 'block', maxWidth: '100%', maxHeight: 240, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setLightboxSrc(imageUrl) }}
              onError={() => setImgError(true)} />
            <button onClick={(e) => { e.stopPropagation(); setLightboxSrc(imageUrl) }}
              style={{ position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 4, border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Maximize2 size={12} />
            </button>
          </div>
        </div>
      )}

      {expanded && (
        <div style={{ margin: '2px 0 4px 28px' }}>
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace', opacity: 0.5 }}>
            {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          {entry.toolInput && isFileEditTool ? (
            <FileDiffView toolName={entry.toolName || ''} toolInput={entry.toolInput} />
          ) : entry.toolInput && (
            <div style={{ padding: '4px 8px', borderRadius: 4, background: 'rgb(var(--bg-elevated))', border: '1px solid rgb(var(--border-subtle))', fontSize: 10, fontFamily: "'SF Mono', monospace", color: 'rgb(var(--text-secondary))', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 150, overflowY: 'auto', lineHeight: 1.4, marginBottom: 2 }}>
              {entry.toolInput}
            </div>
          )}
          {entry.toolResultContent && (
            <div style={{ padding: '4px 8px', borderRadius: 4, background: entry.toolResultIsError ? 'rgb(var(--accent-red) / 0.05)' : 'rgb(var(--bg-elevated))', border: `1px solid ${entry.toolResultIsError ? 'rgb(var(--accent-red) / 0.3)' : 'rgb(var(--border-subtle))'}`, fontSize: 10, fontFamily: "'SF Mono', monospace", color: entry.toolResultIsError ? 'rgb(var(--accent-red))' : 'rgb(var(--text-muted))', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto', lineHeight: 1.4 }}>
              {entry.toolResultContent}
            </div>
          )}
        </div>
      )}

      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  )
}

const TimelineThinkingRow = ({ entry }: { entry: TimelineEntry }) => {
  const preview = (entry.thinkingText || '').split('\n')[0].slice(0, 80)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
      <span style={{ width: 9, flexShrink: 0 }} />
      <Brain size={10} style={{ color: 'rgb(var(--accent-purple))', opacity: 0.5, flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: 'rgb(var(--text-muted))', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {preview}
      </span>
    </div>
  )
}

const TimelineTextBlock = ({ entry }: { entry: TimelineEntry }) => (
  <div style={{ padding: '6px 12px', margin: '6px 4px 6px 17px', background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))', borderRadius: 6, overflow: 'hidden' }}>
    <div className="chat-markdown" style={{ fontSize: 12, lineHeight: 1.7 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.textContent || ''}</ReactMarkdown>
    </div>
  </div>
)

const TimelineStatsRow = ({ entry }: { entry: TimelineEntry }) => {
  const { t } = useTranslation('chat')
  const s = entry.stats
  if (!s) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px 2px 17px', opacity: 0.5 }}>
      {s.durationMs != null && (
        <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace' }}>
          {s.durationMs >= 1000 ? `${(s.durationMs / 1000).toFixed(1)}s` : `${s.durationMs}ms`}
        </span>
      )}
      {(s.inputTokens != null || s.outputTokens != null) && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace' }}>
          {formatTokens(s.inputTokens ?? 0)} in / {formatTokens(s.outputTokens ?? 0)} out
          {(s.cacheReadInputTokens != null && s.cacheReadInputTokens > 0) && <span style={{ opacity: 0.6 }}>/ {formatTokens(s.cacheReadInputTokens)} cache</span>}
          {(s.cacheCreationInputTokens != null && s.cacheCreationInputTokens > 0) && <span style={{ opacity: 0.6 }}>/ {formatTokens(s.cacheCreationInputTokens)} cache+</span>}
        </span>
      )}
      {s.numTurns != null && (
        <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace' }}>{t('message.turns', { count: s.numTurns })}</span>
      )}
    </div>
  )
}

const CollapsedToolGroup = ({ group }: { group: ToolGroup }) => {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = useState(false)
  const getToolLabel = (name: string) => getReadableToolLabel(name, t)
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label={`${getToolLabel(group.toolName)} x${group.entries.length}`}
        onClick={() => setExpanded((p) => !p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((p) => !p) } }}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', borderRadius: 4, cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <Chevron size={9} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0, opacity: 0.5 }} />
        {getToolIcon(group.toolName)}
        <span style={{ fontSize: 11, color: 'rgb(var(--text-muted))' }}>{getToolLabel(group.toolName)}</span>
        <span style={{ fontSize: 10, padding: '0 4px', borderRadius: 3, background: 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))', color: 'rgb(var(--text-muted))', fontFamily: 'monospace', fontWeight: 500 }}>
          x{group.entries.length}
        </span>
        {group.entries.some((e) => e.toolResultIsError) && <AlertCircle size={10} style={{ color: 'rgb(var(--accent-red))', flexShrink: 0 }} />}
      </div>
      {expanded && group.entries.map((entry) => <TimelineToolRow key={entry.id} entry={entry} />)}
    </div>
  )
}

const renderTimelineItem = (item: TimelineEntry | ToolGroup | ExpertProgressGroup, onAnswerQuestion?: (answer: string) => void, isCompleted?: boolean) => {
  if ('type' in item && item.type === 'expert-progress') {
    return <ExpertProgressBlock key={(item as ExpertProgressGroup).entries[0].id} group={item as ExpertProgressGroup} />
  }
  if ('type' in item && item.type === 'tool-group') {
    return <CollapsedToolGroup key={(item as ToolGroup).entries[0].id} group={item as ToolGroup} />
  }
  const entry = item as TimelineEntry
  switch (entry.type) {
    case 'tool': {
      if (entry.toolName === 'AskUserQuestion' && entry.toolInput) {
        const answered = !!entry.hasToolResult
        if (answered) {
          console.warn('[AskUserQuestion] Card disabled — hasToolResult=true', { entryId: entry.id, toolInput: entry.toolInput?.slice(0, 80) })
        }
        return (
          <AskUserQuestionCard
            key={entry.id}
            toolInput={entry.toolInput}
            answered={answered}
            onSubmit={onAnswerQuestion}
          />
        )
      }
      if (entry.toolName === 'ExitPlanMode') {
        return (
          <PlanApprovalCard
            key={entry.id}
            answered={!!entry.hasToolResult}
            onSubmit={onAnswerQuestion}
          />
        )
      }
      if (entry.toolName === 'TodoWrite' && entry.toolInput) {
        return <TodoWriteCard key={entry.id} toolInput={entry.toolInput} isCompleted={isCompleted} />
      }
      return <TimelineToolRow key={entry.id} entry={entry} />
    }
    case 'thinking': return <TimelineThinkingRow key={entry.id} entry={entry} />
    case 'text': return <TimelineTextBlock key={entry.id} entry={entry} />
    case 'error': return (
      <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px 3px 17px' }}>
        <AlertCircle size={11} style={{ color: 'rgb(var(--accent-red))' }} />
        <span style={{ fontSize: 11, color: 'rgb(var(--accent-red))' }}>{entry.toolResultContent?.split('\n')[0].slice(0, 100) || 'Error'}</span>
      </div>
    )
    case 'image': return entry.imagePaths ? (
      <div key={entry.id} style={{ padding: '4px 4px 4px 17px' }}><ImageMessage imagePaths={entry.imagePaths} /></div>
    ) : null
    case 'stats': return <TimelineStatsRow key={entry.id} entry={entry} />
    default: return null
  }
}

const TimelineView = ({ messages, onAnswerQuestion, isCompleted }: { messages: Message[]; onAnswerQuestion?: (answer: string) => void; isCompleted?: boolean; showAll?: boolean }) => {
  const entries = useMemo(() => buildTimeline(messages), [messages])
  const collapsedEntries = useMemo(() => {
    let lastStatsIdx = -1
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].type === 'stats') { lastStatsIdx = i; break }
    }
    if (lastStatsIdx < 0) return entries
    return entries.filter((e, i) => e.type !== 'stats' || i === lastStatsIdx)
  }, [entries])
  const renderItems = useMemo(() => groupConsecutiveTools(collapsedEntries), [collapsedEntries])

  if (entries.length === 0) return null

  return (
    <div style={{ padding: '4px 0' }}>
      {renderItems.map((item) => renderTimelineItem(item, onAnswerQuestion, isCompleted))}
    </div>
  )
}

export default TimelineView
