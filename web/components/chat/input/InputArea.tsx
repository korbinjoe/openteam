import { useState, useMemo, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUp, Square, X, ImageIcon, ChevronDown, Users, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import SlashCommandMenu from './SlashCommandMenu'
import { type CommandDef, COMMAND_REGISTRY, filterCommands, mergeWithDynamicCommands } from '@/lib/commandRegistry'
import MentionMenu, { type MentionItem } from './MentionMenu'
import type { AgentSummary } from '@/types/agentConfig'
import type { AgentActivity } from '@/types/chat'
import { WORKING_PHASES } from '@/types/chat'
import type { ModelOption } from '@/lib/models'
import { sendAESEvent } from '@/lib/aes'
import { useFileSearch } from '@/hooks/useFileSearch'
import {
  MENTION_CHIP_CSS,
  serialize,
  findTrigger,
  findAdjacentChip,
  deleteChipWithSpaces,
  createFileChip,
  createFolderChip,
  createCodeSnippetChip,
  createCommandChip,
  insertChipAtCursor,
  clearAtToken,
  resetEditor,
} from './mentionChip'

export interface MentionInfo {
  id: string
  name: string
}

export interface PendingImage {
  data: string      // base64 (no data URI prefix)
  mediaType: string  // image/png etc.
  preview: string    // data URI for <img> display
}

const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_IMAGES = 5
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

interface Props {
  value: string
  onChange: (v: string) => void
  onSend: (mentions: MentionInfo[], images: PendingImage[]) => void
  /**  Ctrl+Cagent 3s  kill */
  onInterrupt: () => void
  disabled: boolean
  activity: AgentActivity | null
  slashCommands: string[]
  model: string | null
  onModelChange?: (model: string) => void
  availableModels?: ModelOption[]
  agents?: AgentSummary[]
  expertActivities?: Record<string, AgentActivity>
  targetAgentId?: string | null
  onTargetChange?: (agent: AgentSummary) => void
  cwd?: string | null
  queueSize?: number
  onOpenAgentSwitcher?: () => void
  /** True when the workspace URL pins this view to one agent. Disables the
   *  agent-switch chip and rewrites the placeholder to make the lock visible. */
  singleAgentMode?: boolean
  lockedAgentName?: string
  isActive?: boolean
}

const parseMentions = (text: string, agents: AgentSummary[]): MentionInfo[] => {
  if (!agents.length) return []
  const result: MentionInfo[] = []
  const seen = new Set<string>()
  const regex = /@(\S+)/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const token = match[1]
    const agent = agents.find((a) => a.id === token)
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id)
      result.push({ id: agent.id, name: agent.name })
    }
  }
  return result
}

export interface InputAreaHandle {
  focus: () => void
}

const InputArea = forwardRef<InputAreaHandle, Props>(({
  value, onChange, onSend, onInterrupt, disabled, activity, slashCommands, model,
  onModelChange, availableModels = [],
  agents = [], expertActivities = {},
  targetAgentId, onTargetChange, cwd,
  queueSize = 0,
  onOpenAgentSwitcher,
  singleAgentMode = false,
  lockedAgentName,
  isActive = true,
}, ref) => {
  const { t } = useTranslation('chat')
  const isWorking = !!activity && WORKING_PHASES.has(activity.phase)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive
  const [focused, setFocused] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [slashMenuIndex, setSlashMenuIndex] = useState(0)
  const [mentionMenuIndex, setMentionMenuIndex] = useState(0)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [chipTooltip, setChipTooltip] = useState<{ text: string; x: number; y: number } | null>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
  }), [])

  const syncValue = useCallback(() => {
    const el = editorRef.current
    if (!el) return
    onChange(serialize(el))
  }, [onChange])

  const refreshTrigger = useCallback(() => {
    if (composingRef.current) return
    const trigger = findTrigger()
    setMentionQuery(trigger ? trigger.query : null)
  }, [])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (serialize(el) === value) return
    resetEditor(el, value)
  }, [value])

  useEffect(() => {
    const handler = (e: Event) => {
      if (!isActiveRef.current) return
      const { code, filePath, startLine, endLine, language } = (e as CustomEvent).detail as {
        code: string; filePath: string; startLine: number; endLine: number; language?: string
      }
      const fileName = filePath.split('/').pop() || filePath
      const el = editorRef.current
      if (!el) return
      el.focus()
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      const chip = createCodeSnippetChip({
        kind: 'code-snippet',
        fileName,
        filePath,
        startLine,
        endLine,
        code,
        language: language || '',
      })
      insertChipAtCursor(chip)
      syncValue()
    }
    window.addEventListener('chat:insert-code-snippet', handler)
    return () => window.removeEventListener('chat:insert-code-snippet', handler)
  }, [syncValue])

  useEffect(() => {
    const handler = (e: Event) => {
      if (!isActiveRef.current) return
      const { files } = (e as CustomEvent).detail as {
        files: { name: string; path: string; type?: string }[]
      }
      if (!files?.length) return
      const el = editorRef.current
      if (!el) return
      el.focus()
      const sel = window.getSelection()
      if (sel) {
        const range = document.createRange()
        range.selectNodeContents(el)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
      }
      for (const file of files) {
        if (file.type === 'directory') {
          insertChipAtCursor(createFolderChip({ kind: 'folder', name: file.name, path: file.path }))
        } else {
          insertChipAtCursor(createFileChip({ kind: 'file', name: file.name, path: file.path }))
        }
      }
      syncValue()
    }
    window.addEventListener('chat:add-files', handler)
    return () => window.removeEventListener('chat:add-files', handler)
  }, [syncValue])

  useEffect(() => {
    if (!modelDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [modelDropdownOpen])

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const cs = () => { composingRef.current = true }
    const ce = () => { composingRef.current = false; refreshTrigger() }
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent
      const sel = window.getSelection()
      if (!sel || !sel.isCollapsed) return
      if (ie.inputType === 'deleteContentBackward') {
        const chip = findAdjacentChip('prev')
        if (chip) { ie.preventDefault(); deleteChipWithSpaces(chip); syncValue() }
      } else if (ie.inputType === 'deleteContentForward') {
        const chip = findAdjacentChip('next')
        if (chip) { ie.preventDefault(); deleteChipWithSpaces(chip); syncValue() }
      }
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const closeBtn = target.closest('[data-chip-close="1"]') as HTMLElement | null
      if (!closeBtn) return
      const chip = closeBtn.closest('.mention-chip') as HTMLElement | null
      if (!chip) return
      e.preventDefault()
      e.stopPropagation()
      deleteChipWithSpaces(chip)
      setChipTooltip(null)
      syncValue()
    }
    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const chip = target?.closest?.('.mention-chip') as HTMLElement | null
      if (!chip) return
      const rect = chip.getBoundingClientRect()
      const raw = chip.dataset.value ?? ''
      const text = chip.dataset.mention === 'code-snippet' ? raw.split('\n')[0] : raw
      setChipTooltip({
        text,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 6,
      })
    }
    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const related = e.relatedTarget as Node | null
      const chip = target?.closest?.('.mention-chip') as HTMLElement | null
      if (!chip) return
      if (related && chip.contains(related)) return
      setChipTooltip(null)
    }
    el.addEventListener('compositionstart', cs)
    el.addEventListener('compositionend', ce)
    el.addEventListener('beforeinput', onBeforeInput)
    el.addEventListener('click', onClick)
    el.addEventListener('mouseover', onMouseOver)
    el.addEventListener('mouseout', onMouseOut)
    return () => {
      el.removeEventListener('compositionstart', cs)
      el.removeEventListener('compositionend', ce)
      el.removeEventListener('beforeinput', onBeforeInput)
      el.removeEventListener('click', onClick)
      el.removeEventListener('mouseover', onMouseOver)
      el.removeEventListener('mouseout', onMouseOut)
    }
  }, [refreshTrigger, syncValue])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files)
    const imageFiles = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type))
    if (imageFiles.length > 0) {
      e.preventDefault()
      const remaining = MAX_IMAGES - pendingImages.length
      const toProcess = imageFiles.slice(0, remaining)
      for (const file of toProcess) {
        if (file.size > MAX_IMAGE_SIZE) continue
        const reader = new FileReader()
        reader.onload = () => {
          const dataUri = reader.result as string
          const commaIdx = dataUri.indexOf(',')
          const base64 = dataUri.slice(commaIdx + 1)
          setPendingImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev
            return [...prev, { data: base64, mediaType: file.type, preview: dataUri }]
          })
        }
        reader.readAsDataURL(file)
      }
      return
    }
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    document.execCommand('insertText', false, text)
    syncValue()
    refreshTrigger()
  }, [pendingImages.length, syncValue, refreshTrigger])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    for (const file of files) {
      if (ALLOWED_IMAGE_TYPES.includes(file.type)) {
        if (file.size > MAX_IMAGE_SIZE) continue
        const reader = new FileReader()
        reader.onload = () => {
          const dataUri = reader.result as string
          const commaIdx = dataUri.indexOf(',')
          const base64 = dataUri.slice(commaIdx + 1)
          setPendingImages((prev) => {
            if (prev.length >= MAX_IMAGES) return prev
            return [...prev, { data: base64, mediaType: file.type, preview: dataUri }]
          })
        }
        reader.readAsDataURL(file)
      } else {
        const path = (file as any).path as string | undefined
        if (!path) continue
        const name = path.split('/').pop() || path
        insertChipAtCursor(createFileChip({ kind: 'file', name, path }))
        syncValue()
      }
    }
  }, [syncValue])

  const handleRemoveImage = useCallback((index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // ── Slash command menu ──
  const mergedRegistry = useMemo(
    () => mergeWithDynamicCommands(COMMAND_REGISTRY, slashCommands, 'claude', 'Claude Code'),
    [slashCommands],
  )

  const filteredCmds = useMemo(
    () => filterCommands(value, mergedRegistry, 'claude'),
    [value, mergedRegistry],
  )

  const slashMenuOpen = filteredCmds.length > 0

  const effectiveMentionQuery = slashMenuOpen ? null : mentionQuery
  const fileQuery = effectiveMentionQuery ?? ''
  const fileSearchEnabled = effectiveMentionQuery !== null
  const { results: fileResults, loading: fileLoading, settled: fileSettled } = useFileSearch(cwd ?? null, fileQuery, fileSearchEnabled)

  const filteredAgents = useMemo(() => {
    if (effectiveMentionQuery === null || !agents.length) return []
    const q = effectiveMentionQuery.toLowerCase()
    return agents.filter((a) =>
      (a.id ?? a.name).toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
    )
  }, [effectiveMentionQuery, agents])

  const mentionItems: MentionItem[] = useMemo(() => {
    const items: MentionItem[] = []
    for (const file of fileResults) items.push({ kind: 'file', file })
    if (fileSettled) {
      for (const agent of filteredAgents) items.push({ kind: 'agent', agent })
    }
    return items
  }, [fileResults, filteredAgents, fileSettled])

  const mentionMenuOpen = effectiveMentionQuery !== null && (mentionItems.length > 0 || fileLoading)

  useEffect(() => {
    setMentionMenuIndex((i) => (mentionItems.length === 0 ? 0 : Math.min(i, mentionItems.length - 1)))
  }, [mentionItems.length])

  const activeMenu = slashMenuOpen ? 'slash' : mentionMenuOpen ? 'mention' : null

  // ── Handlers ──
  const handleSlashSelect = useCallback((cmd: CommandDef) => {
    const el = editorRef.current
    if (!el) return
    resetEditor(el, '')
    el.focus()
    const chip = createCommandChip({ kind: 'command', name: cmd.name, toolLabel: cmd.toolLabel })
    insertChipAtCursor(chip)
    syncValue()
    setSlashMenuIndex(0)
  }, [syncValue])

  const handleMentionItemSelect = useCallback((item: MentionItem) => {
    if (item.kind === 'file') {
      if (!clearAtToken()) return
      insertChipAtCursor(createFileChip({ kind: 'file', name: item.file.name, path: item.file.path }))
      setMentionQuery(null)
      setMentionMenuIndex(0)
      syncValue()
      editorRef.current?.focus()
      return
    }
    const agent = item.agent
    clearAtToken()
    setMentionQuery(null)
    setMentionMenuIndex(0)
    syncValue()
    onTargetChange?.(agent)
    editorRef.current?.focus()
  }, [onTargetChange, syncValue])

  const handleSend = useCallback(() => {
    const mentions = parseMentions(value, agents)
    onSend(mentions, pendingImages)
    setPendingImages([])
    sendAESEvent('chat', 'message_sent', { messageLength: value.trim().length, mentionCount: mentions.length, imageCount: pendingImages.length })
  }, [value, agents, onSend, pendingImages])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (activeMenu === 'slash') {
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashMenuIndex((i) => (i <= 0 ? filteredCmds.length - 1 : i - 1)); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashMenuIndex((i) => (i >= filteredCmds.length - 1 ? 0 : i + 1)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
        e.preventDefault(); handleSlashSelect(filteredCmds[slashMenuIndex]); return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (editorRef.current) resetEditor(editorRef.current, '')
        onChange('')
        return
      }
    }

    if (activeMenu === 'mention') {
      const count = mentionItems.length
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionMenuIndex((i) => (count === 0 ? 0 : i <= 0 ? count - 1 : i - 1)); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionMenuIndex((i) => (count === 0 ? 0 : i >= count - 1 ? 0 : i + 1)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing)) {
        if (count === 0) return
        e.preventDefault()
        const safeIdx = Math.min(mentionMenuIndex, count - 1)
        handleMentionItemSelect(mentionItems[safeIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        clearAtToken()
        setMentionQuery(null)
        syncValue()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); handleSend()
    }
  }

  const handleInput = () => {
    syncValue()
    refreshTrigger()
    setSlashMenuIndex(0)
  }

  const canSubmit = !disabled && (!!value.trim() || pendingImages.length > 0)
  const showAgentChip = agents.length > 0

  const activeAgent = useMemo(() => {
    if (!targetAgentId) return agents[0] ?? null
    return agents.find((a) => (a.id ?? a.name) === targetAgentId) ?? agents[0] ?? null
  }, [targetAgentId, agents])

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true
    return /Mac|iPhone|iPad/.test(navigator.platform)
  }, [])

  const placeholderText = disabled
    ? 'Connecting...'
    : isWorking
      ? (queueSize > 0
          ? t('input.queuedCount', { count: queueSize })
          : t('input.taskInProgress'))
      : singleAgentMode && lockedAgentName
        ? `Message ${lockedAgentName}…`
        : 'Send a message...'

  return (
    <div className="px-4 pt-1 pb-2.5 shrink-0 relative">
      <style>{MENTION_CHIP_CSS}</style>
      {chipTooltip && createPortal(
        <div className="mention-tooltip" style={{ left: chipTooltip.x, top: chipTooltip.y }}>
          {chipTooltip.text}
        </div>,
        document.body,
      )}
      {slashMenuOpen && (
        <SlashCommandMenu commands={filteredCmds} selectedIndex={slashMenuIndex} onSelect={handleSlashSelect} />
      )}
      {mentionMenuOpen && (
        <MentionMenu
          items={mentionItems}
          activities={expertActivities}
          selectedIndex={mentionMenuIndex}
          onSelect={handleMentionItemSelect}
          loading={fileLoading}
          showFilesSection={true}
          query={fileQuery}
        />
      )}

      <div
        className={cn(
          'border rounded-lg bg-bg-elevated transition-all',
          isDragOver ? 'border-accent-brand border-dashed bg-accent-brand/[0.04]' :
          focused ? 'border-accent-brand/70 shadow-[0_0_0_3px] shadow-accent-brand/20' : 'border-border shadow-none',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {pendingImages.length > 0 && (
          <div className="flex items-center gap-2 px-3 pt-2 pb-1 overflow-x-auto">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative shrink-0 group">
                <img
                  src={img.preview}
                  alt={`attachment ${i + 1}`}
                  className="w-[60px] h-[60px] object-cover rounded-md border border-border-subtle"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-bg-elevated border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <X size={8} />
                </button>
              </div>
            ))}
            {pendingImages.length < MAX_IMAGES && (
              <span className="text-[10px] text-text-muted px-1">
                <ImageIcon size={12} className="inline opacity-50" /> {pendingImages.length}/{MAX_IMAGES}
              </span>
            )}
          </div>
        )}

        <div
          ref={editorRef}
          className={cn(
            'mention-editor w-full bg-transparent border-none outline-none text-text-primary text-[13px] leading-[1.6] pt-2.5 px-3.5 pb-1 font-[inherit] min-h-[40px] max-h-[160px] overflow-y-auto',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text',
          )}
          contentEditable={!disabled}
          suppressContentEditableWarning
          data-placeholder={placeholderText}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={refreshTrigger}
          onClick={refreshTrigger}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center px-1.5 pt-0.5 pb-1.5 gap-1 min-w-0">
          {/* Agent switch chip — only shown in multi-agent mode. In single-agent mode the
              placeholder already names the locked agent, so the chip would just duplicate info. */}
          {showAgentChip && activeAgent && !singleAgentMode && (
            <button
              type="button"
              onClick={() => onOpenAgentSwitcher?.()}
              title={t('input.agentSwitchTitle', { name: activeAgent.name, shortcut: isMac ? '⌘K' : 'Ctrl+K' })}
              className="group flex items-center gap-1 text-xs text-text-secondary px-1.5 py-0.5 bg-bg-hover-muted rounded-sm whitespace-nowrap overflow-hidden cursor-pointer hover:text-text-primary hover:bg-bg-hover transition-colors max-w-[180px] shrink-[10] min-w-0"
            >
              <Users size={11} className="shrink-0 opacity-60" />
              <span className="truncate">{activeAgent.name}</span>
              <kbd className="shrink-0 text-[10px] font-mono text-text-muted opacity-60 ml-0.5 px-1 py-px rounded border border-border-subtle/60 group-hover:opacity-80 transition-opacity">
                {isMac ? '⌘K' : 'Ctrl+K'}
              </kbd>
            </button>
          )}

          <div ref={modelDropdownRef} className="relative shrink-[10] min-w-0">
            <button
              type="button"
              onClick={() => setModelDropdownOpen((v) => !v)}
              className="flex items-center gap-0.5 text-xs text-text-secondary px-1.5 py-0.5 bg-bg-hover-muted rounded-sm whitespace-nowrap overflow-hidden cursor-pointer hover:text-text-primary hover:bg-bg-hover transition-colors max-w-[180px]"
              title={model || undefined}
            >
              <span className="truncate">{availableModels.find((m) => m.value === model)?.label || model || 'Model'}</span>
              <ChevronDown size={10} className="shrink-0 opacity-50" />
            </button>
            {modelDropdownOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-52 bg-bg-elevated border border-border-subtle rounded-md shadow-lg z-50 py-1 max-h-60 overflow-y-auto">
                {availableModels.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => {
                      onModelChange?.(m.value)
                      setModelDropdownOpen(false)
                    }}
                    className={cn(
                      'flex items-center w-full px-3 py-1.5 text-xs text-left transition-colors hover:bg-bg-hover-muted cursor-pointer',
                      m.value === model ? 'text-accent-brand font-medium' : 'text-text-primary',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="flex-1 min-w-[4px]" />

          {isWorking ? (
            <>
              <button
                onClick={handleSend} disabled={!canSubmit}
                title={canSubmit ? t('input.queueTooltip') : t('input.queueDisabled')}
                className={cn(
                  'h-7 min-w-[28px] px-1.5 rounded-sm border-none flex items-center justify-center gap-1 transition-all shrink-0',
                  canSubmit
                    ? 'bg-bg-hover text-text-primary cursor-pointer hover:bg-bg-hover-muted border border-border-subtle'
                    : 'bg-bg-hover-muted text-text-muted cursor-default',
                )}
              >
                <Plus size={12} strokeWidth={2.5} />
                {queueSize > 0 && (
                  <span className="text-[10px] font-mono tabular-nums leading-none">{queueSize}</span>
                )}
              </button>
              <button
                onClick={() => { onInterrupt(); sendAESEvent('chat', 'agent_stopped') }}
                title="Stop"
                className="w-7 h-7 rounded-sm bg-accent-brand text-white cursor-pointer flex items-center justify-center transition-colors shrink-0 hover:bg-accent-brand/80"
              >
                <Square size={10} fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              onClick={handleSend} disabled={!canSubmit}
              className={cn(
                'w-7 h-7 rounded-sm border-none flex items-center justify-center transition-all shrink-0',
                canSubmit
                  ? 'bg-accent-brand text-white cursor-pointer hover:opacity-90'
                  : 'bg-bg-hover-muted text-text-secondary cursor-default',
              )}
            >
              <ArrowUp size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
})

InputArea.displayName = 'InputArea'

export default InputArea
