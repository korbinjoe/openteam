import { useRef, useState, useCallback, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isElectron } from '../../utils/env'
import { BreadcrumbLink, noDrag } from './ChatPageWidgets'
import { API_BASE, authFetch } from '@/config/api'

export interface ChatHeaderProps {
  workspaceName: string | undefined
  workspaceId: string
  chatId: string
  chatTitle: string | undefined
  setChatTitle: (title: string) => void
  connected: boolean
  currentMode: string | undefined
  /** Right-aligned controls rendered before the connection dot
   *  (e.g., chat-view-mode toggle). Lives inline with the title row
   *  so it shares chrome with breadcrumb/mode badge instead of
   *  carrying its own row. */
  trailing?: ReactNode
}

const ChatHeader = ({
  workspaceName, workspaceId, chatId,
  chatTitle, setChatTitle,
  connected, currentMode, trailing,
}: ChatHeaderProps) => {
  const { t } = useTranslation(['chat', 'common'])
  const navigate = useNavigate()
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleDraft, setEditTitleDraft] = useState('')
  const titleInputRef = useRef<HTMLInputElement>(null)

  const handleTitleSave = useCallback(() => {
    const newTitle = editTitleDraft.trim()
    if (!newTitle || newTitle === chatTitle) { setIsEditingTitle(false); return }
    setChatTitle(newTitle); setIsEditingTitle(false)
    if (chatId) {
      authFetch(`${API_BASE}/api/chats/${chatId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      }).catch((err: unknown) => console.warn('title update failed', err))
    }
  }, [editTitleDraft, chatTitle, chatId, setChatTitle])

  const startEditing = useCallback(() => {
    setEditTitleDraft(chatTitle || '')
    setIsEditingTitle(true)
    setTimeout(() => { titleInputRef.current?.focus(); titleInputRef.current?.select() }, 0)
  }, [chatTitle])

  return (
    <div className="shrink-0">
      <div
        className={cn(
          'h-9 bg-bg-primary border-b border-border-subtle flex items-center px-2.5 gap-1.5',
          isElectron && '-webkit-app-region-drag',
        )}
      >
        <nav className="flex items-center gap-0.5 text-xs flex-1 min-w-0" style={noDrag}>
          <BreadcrumbLink label={workspaceName || 'Workspace'} onClick={() => navigate(`/workspace/${workspaceId}`)} />
          <ChevronRight size={10} className="text-text-muted opacity-50" />
          {isEditingTitle ? (
            <span className="flex items-center gap-1 flex-1 min-w-0">
              <input ref={titleInputRef} value={editTitleDraft}
                onChange={(e) => setEditTitleDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSave(); if (e.key === 'Escape') setIsEditingTitle(false) }}
                onBlur={handleTitleSave} aria-label={t('chat:editTitle')}
                style={{ fieldSizing: 'content' } as CSSProperties}
                className="text-xs font-semibold text-text-emphasis bg-bg-input border border-accent-brand rounded px-1.5 py-0.5 outline-none min-w-[160px] max-w-full"
              />
              <button onMouseDown={(e) => e.preventDefault()} onClick={handleTitleSave} aria-label={t('common:action.confirm')} tabIndex={0}
                className="p-0.5 rounded text-accent-green hover:bg-bg-hover-muted transition-colors">
                <Check size={12} />
              </button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => setIsEditingTitle(false)} aria-label={t('common:action.cancel')} tabIndex={0}
                className="p-0.5 rounded text-text-secondary hover:bg-bg-hover-muted transition-colors">
                <X size={12} />
              </button>
            </span>
          ) : (
            <span role="button" tabIndex={0}
              onClick={startEditing}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') startEditing() }}
              aria-label={t('chat:clickEditTitle')}
              title={chatTitle || undefined}
              className="text-text-emphasis font-semibold cursor-pointer flex items-center gap-1 flex-1 min-w-0 truncate hover:text-accent-brand transition-colors group/title"
            >
              {chatTitle || t('chat:newChat')}
              <Pencil size={10} className="text-text-secondary opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
            </span>
          )}
        </nav>

        {currentMode && (
          <span
            title={`Agent mode: ${currentMode}`}
            className="px-1.5 py-0.5 rounded text-[10px] uppercase font-medium border border-border-subtle text-text-secondary bg-bg-elevated"
            style={noDrag}
          >
            {currentMode}
          </span>
        )}
        {trailing && <span style={noDrag}>{trailing}</span>}
        <span title={connected ? 'Connected' : 'Connecting...'} className="flex items-center" style={noDrag}>
          <span className={cn('w-1.5 h-1.5 rounded-full transition-colors', connected ? 'bg-accent-green' : 'bg-accent-red')} />
        </span>
      </div>
    </div>
  )
}

export default ChatHeader
