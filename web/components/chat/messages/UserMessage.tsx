import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { User, ChevronDown, ChevronRight, Terminal, RotateCcw } from 'lucide-react'
import type { Message } from '../../../types/chat'
import AgentAvatar from '@/components/ui/agent-avatar'
import MentionTag from '../input/MentionTag'
import ImageLightbox from './ImageLightbox'

/* ── Avatar ───────────────────────────────────────────────── */

const UserAvatarFallback = () => (
  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-brand">
    <User size={14} className="text-white" strokeWidth={2.5} />
  </div>
)

const ChatAvatar = ({ isUser, agentName, agentId }: { isUser: boolean; agentName?: string; agentId?: string }) => (
  isUser ? <UserAvatarFallback /> : <AgentAvatar name={agentName || 'assistant'} agentId={agentId} size="sm" />
)

export { ChatAvatar }

/* ── User Message ─────────────────────────────────────────── */

/**  @agent-id  MentionTag  agent.name */
const renderContentWithMentions = (content: string, mentions?: Message['mentions']) => {
  if (!mentions?.length) return content

  const idToName = new Map<string, string>()
  for (const m of mentions) {
    if (m.id) idToName.set(m.id, m.name)
    idToName.set(m.name, m.name)
  }

  const parts: (string | React.ReactElement)[] = []
  const regex = /@(\S+)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(content)) !== null) {
    const displayName = idToName.get(match[1])
    if (displayName) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index))
      }
      parts.push(<MentionTag key={match.index} name={displayName} />)
      lastIndex = match.index + match[0].length
    }
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? parts : content
}

/* ── Slash-command marker (paired with server SlashCommandResolver) ───────── */

const SLASH_MARKER_RE = /^<!--OT_SLASH:([A-Za-z0-9+/=]+)-->\n?/

interface SlashMarker {
  cmd: string
  args: string
  original: string
}

const parseSlashMarker = (content: string): { marker: SlashMarker; body: string } | null => {
  const m = content.match(SLASH_MARKER_RE)
  if (!m) return null
  try {
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const marker = JSON.parse(json) as SlashMarker
    if (!marker?.cmd) return null
    return { marker, body: content.slice(m[0].length) }
  } catch {
    return null
  }
}

const SlashCommandMessage = ({ message, marker, body }: { message: Message; marker: SlashMarker; body: string }) => {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? ChevronDown : ChevronRight

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '10px 16px 6px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <ChatAvatar isUser />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <div
          role="button"
          tabIndex={0}
          aria-label={expanded ? `Collapse ${marker.cmd}` : `Expand ${marker.cmd}`}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgb(var(--accent-brand) / 0.06)',
            border: '1px solid rgb(var(--accent-brand) / 0.25)',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--accent-brand) / 0.1)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--accent-brand) / 0.06)' }}
        >
          <Icon size={12} style={{ color: 'rgb(var(--accent-brand))', flexShrink: 0 }} />
          <Terminal size={11} style={{ color: 'rgb(var(--accent-brand))', flexShrink: 0 }} />
          <span style={{
            fontSize: 12,
            color: 'rgb(var(--accent-brand))',
            fontFamily: 'monospace',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {marker.cmd}
          </span>
          {marker.args && (
            <span style={{
              fontSize: 12,
              color: 'rgb(var(--text-primary))',
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              flex: 1,
            }}>
              {marker.args}
            </span>
          )}
          <span style={{
            fontSize: 10,
            color: 'rgb(var(--text-muted))',
            fontFamily: 'monospace',
            marginLeft: 'auto',
            flexShrink: 0,
            opacity: 0.6,
          }}>
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {expanded && body && (
          <div style={{
            marginTop: 4,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
            border: '1px solid rgb(var(--border-subtle))',
            color: 'rgb(var(--text-muted))',
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
            fontFamily: 'monospace',
          }}>
            {body}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Continuation Summary (out-of-run context handoff) ───── */

const CONTINUATION_RE = /^This session is being continued from a previous conversation/

const isContinuationSummary = (content: string): boolean => CONTINUATION_RE.test(content.trim())

const extractSummaryPreview = (content: string): string => {
  const lines = content.split('\n').filter((l) => l.trim())
  for (const line of lines) {
    if (line.startsWith('Summary:') || line.match(/^\d+\.\s/)) {
      return line.replace(/^Summary:\s*/, '').slice(0, 60) + (line.length > 60 ? '...' : '')
    }
  }
  return lines[1]?.slice(0, 60) || ''
}

const ContinuationSummaryMessage = ({ message }: { message: Message }) => {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? ChevronDown : ChevronRight
  const preview = extractSummaryPreview(message.content)

  return (
    <div style={{
      padding: '8px 16px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={expanded ? 'Collapse continuation summary' : 'Expand continuation summary'}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 6,
          background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
          border: '1px solid rgb(var(--border-subtle))',
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
      >
        <Icon size={12} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0 }} />
        <RotateCcw size={11} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0 }} />
        <span style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'rgb(var(--text-secondary))',
          flexShrink: 0,
        }}>
          Continued from previous session
        </span>
        {!expanded && preview && (
          <span style={{
            fontSize: 11,
            color: 'rgb(var(--text-muted))',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}>
            · {preview}
          </span>
        )}
        <span style={{
          fontSize: 10,
          color: 'rgb(var(--text-muted))',
          fontFamily: 'monospace',
          marginLeft: 'auto',
          flexShrink: 0,
          opacity: 0.5,
        }}>
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {expanded && (
        <div style={{
          marginTop: 4,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
          border: '1px solid rgb(var(--border-subtle))',
          color: 'rgb(var(--text-secondary))',
          fontSize: 12,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: 300,
          overflow: 'auto',
        }}>
          {message.content}
        </div>
      )}
    </div>
  )
}

const isSystemInstructionsMessage = (content: string): boolean => {
  if (content.startsWith('# AGENTS.md instructions for')) return true
  if (content.startsWith('<user_instructions>')) return true
  if (content.startsWith('<command-name>')) return true
  if (/^<[a-z][a-z0-9]*[-_][a-z0-9_-]*>/i.test(content.trimStart())) return true
  if (content.length > 500) {
    const headingCount = (content.match(/^#{1,3}\s/gm) || []).length
    if (headingCount >= 2) return true
  }
  return false
}

const extractTagLabel = (content: string): string | null => {
  const match = content.trimStart().match(/^<([a-z][a-z0-9_-]*)>/i)
  if (!match) return null
  return match[1]
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const SystemInstructionsMessage = ({ message }: { message: Message }) => {
  const [expanded, setExpanded] = useState(false)
  const Icon = expanded ? ChevronDown : ChevronRight
  const tagLabel = extractTagLabel(message.content) || 'System Instructions'

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '10px 16px 6px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <ChatAvatar isUser />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <div
          role="button"
          tabIndex={0}
          aria-label={expanded ? `Collapse ${tagLabel}` : `Expand ${tagLabel}`}
          onClick={() => setExpanded((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v) } }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
            border: '1px solid rgb(var(--border-subtle))',
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
        >
          <Icon size={12} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'rgb(var(--text-muted))', fontFamily: 'monospace' }}>
            {tagLabel}
          </span>
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace', marginLeft: 'auto' }}>
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        {expanded && (
          <div style={{
            marginTop: 4,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
            border: '1px solid rgb(var(--border-subtle))',
            color: 'rgb(var(--text-muted))',
            fontSize: 11,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 300,
            overflow: 'auto',
          }}>
            {message.content}
          </div>
        )}
      </div>
    </div>
  )
}

const UserMessage = ({ message }: { message: Message }) => {
  const { t } = useTranslation('chat')
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  const slash = parseSlashMarker(message.content)
  if (slash) {
    return <SlashCommandMessage message={message} marker={slash.marker} body={slash.body} />
  }

  if (isContinuationSummary(message.content)) {
    return <ContinuationSummaryMessage message={message} />
  }

  if (isSystemInstructionsMessage(message.content)) {
    return <SystemInstructionsMessage message={message} />
  }

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      padding: '16px 16px 6px',
      animation: 'fadeIn 0.2s ease',
    }}>
      <ChatAvatar isUser />
      <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}>
          {message.mentions && message.mentions.length > 0 && (
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgb(var(--accent-brand) / 0.1)',
              color: 'rgb(var(--accent-brand))',
            }}>
              → {message.mentions.map((m) => m.name).join(', ')}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: 10,
            color: 'rgb(var(--text-muted))',
            fontFamily: 'monospace',
            opacity: 0.5,
          }}>
            {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div style={{
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
          border: '1px solid rgb(var(--border-subtle))',
          color: 'rgb(var(--text-primary))',
          fontSize: 13,
          lineHeight: 1.7,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {renderContentWithMentions(message.content, message.mentions)}
          {message.images && message.images.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {message.images.map((img, i) => {
                const src = `data:${img.mediaType};base64,${img.data}`
                return (
                  <img
                    key={i}
                    src={src}
                    alt={`attachment ${i + 1}`}
                    onClick={() => setLightboxSrc(src)}
                    title={t('message.clickToPreview')}
                    style={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 6,
                      border: '1px solid rgb(var(--border-subtle))',
                      cursor: 'zoom-in',
                      transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.04)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </div>
  )
}

export default UserMessage
