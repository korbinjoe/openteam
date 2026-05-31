/**
 * MentionInputDemo v2 —
 *
 * 1. File =  →  chip + tooltip @<full-path>
 * 2. Agent =  target →  target  Agent chip
 * 3. Chip Backspace  chip
 * 4.  Claude Code / Codex  @<relative-path>agent
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Users } from 'lucide-react'

type FileItem = { kind: 'file'; id: string; name: string; path: string }
type AgentItem = { kind: 'agent'; id: string; name: string }
type Item = FileItem | AgentItem

const MOCK_FILES: FileItem[] = [
  { kind: 'file', id: 'f1', name: 'InputArea.tsx', path: 'web/components/chat/InputArea.tsx' },
  { kind: 'file', id: 'f2', name: 'MentionMenu.tsx', path: 'web/components/chat/MentionMenu.tsx' },
  { kind: 'file', id: 'f3', name: 'useFileSearch.ts', path: 'web/hooks/useFileSearch.ts' },
  { kind: 'file', id: 'f4', name: 'directoryRoutes.ts', path: 'server/routes/directoryRoutes.ts' },
  { kind: 'file', id: 'f5', name: 'ChatPage.tsx', path: 'web/pages/ChatPage.tsx' },
]

const MOCK_AGENTS: AgentItem[] = [
  { kind: 'agent', id: 'fullstack-engineer', name: 'Full-stack product engineer' },
  { kind: 'agent', id: 'code-reviewer', name: 'Code review expert' },
  { kind: 'agent', id: 'ui-designer', name: 'Visual design expert' },
  { kind: 'agent', id: 'architect', name: 'Architecture review expert' },
]

/** DOM → File chip  @<path>NBSP  */
const serialize = (root: HTMLElement): string => {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\u00A0/g, ' ')
      return
    }
    if (node instanceof HTMLElement) {
      if (node.dataset.mention === 'file') {
        out += `@${node.dataset.value ?? ''}`
        return
      }
      if (node.tagName === 'BR') { out += '\n'; return }
      if (node.tagName === 'DIV' && out && !out.endsWith('\n')) out += '\n'
      for (const c of Array.from(node.childNodes)) walk(c)
    }
  }
  for (const c of Array.from(root.childNodes)) walk(c)
  return out
}

const findTrigger = () => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType !== Node.TEXT_NODE) return null
  const text = node.textContent ?? ''
  const before = text.slice(0, range.startOffset)
  const match = before.match(/(?:^|[\s\u00A0])@(\S*)$|^@(\S*)$/)
  if (!match) return null
  const query = match[1] ?? match[2] ?? ''
  const atIndex = range.startOffset - query.length - 1
  return { query, textNode: node as Text, atIndex, cursorOffset: range.startOffset }
}

const isChip = (n: Node | null | undefined): n is HTMLElement =>
  n instanceof HTMLElement && n.dataset.mention === 'file'

const findAdjacentChip = (direction: 'prev' | 'next'): HTMLElement | null => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const { startContainer, startOffset } = sel.getRangeAt(0)

  if (direction === 'prev') {
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent ?? ''
      const before = text.slice(0, startOffset)
      if (!/^[\s\u00A0]*$/.test(before)) return null
      const prev = startContainer.previousSibling
      return isChip(prev) ? prev : null
    }
    const el = startContainer as HTMLElement
    const child = el.childNodes[startOffset - 1]
    return isChip(child) ? child : null
  }

  // next
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer.textContent ?? ''
    const after = text.slice(startOffset)
    if (!/^[\s\u00A0]*$/.test(after)) return null
    const next = startContainer.nextSibling
    return isChip(next) ? next : null
  }
  const el = startContainer as HTMLElement
  const child = el.childNodes[startOffset]
  return isChip(child) ? child : null
}

const deleteChipWithSpaces = (chip: HTMLElement) => {
  const prev = chip.previousSibling
  const next = chip.nextSibling
  const parent = chip.parentNode
  chip.remove()
  if (next && next.nodeType === Node.TEXT_NODE) {
    const t = next as Text
    if (t.data.startsWith('\u00A0')) t.deleteData(0, 1)
  }
  const sel = window.getSelection()
  if (!sel || !parent) return
  const range = document.createRange()
  if (next) {
    range.setStart(next, 0)
  } else if (prev) {
    if (prev.nodeType === Node.TEXT_NODE) {
      range.setStart(prev, (prev as Text).length)
    } else {
      range.setStartAfter(prev)
    }
  } else {
    range.selectNodeContents(parent)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

const MentionInputDemo = () => {
  const editorRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [menuItems, setMenuItems] = useState<Item[]>([])
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const [selectedIndex, setSelectedIndex] = useState(0)

  const [serialized, setSerialized] = useState('')
  const [targetAgent, setTargetAgent] = useState<AgentItem>(MOCK_AGENTS[0])
  const [sentHistory, setSentHistory] = useState<Array<{ text: string; agent: string }>>([])
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)

  const sync = () => { if (editorRef.current) setSerialized(serialize(editorRef.current)) }

  const refreshMenu = () => {
    if (composingRef.current) return
    const trigger = findTrigger()
    if (!trigger) { setMenuOpen(false); return }
    const q = trigger.query.toLowerCase()
    const items: Item[] = [
      ...MOCK_FILES.filter((f) => !q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)),
      ...MOCK_AGENTS.filter((a) => !q || a.name.toLowerCase().includes(q)),
    ]
    setMenuItems(items)
    setSelectedIndex((i) => (items.length === 0 ? 0 : Math.min(i, items.length - 1)))
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && editorRef.current) {
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      const eRect = editorRef.current.getBoundingClientRect()
      setMenuPos({ top: rect.bottom - eRect.top + 6, left: rect.left - eRect.left })
    }
    setMenuOpen(items.length > 0)
  }

  const clearAtToken = (): boolean => {
    const trigger = findTrigger()
    if (!trigger) return false
    const range = document.createRange()
    range.setStart(trigger.textNode, trigger.atIndex)
    range.setEnd(trigger.textNode, trigger.cursorOffset)
    range.deleteContents()
    const sel = window.getSelection()
    if (sel) { sel.removeAllRanges(); sel.addRange(range) }
    return true
  }

  const insertFileChip = (file: FileItem) => {
    if (!clearAtToken()) return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)

    const chip = document.createElement('span')
    chip.setAttribute('contenteditable', 'false')
    chip.dataset.mention = 'file'
    chip.dataset.value = file.path
    chip.className = 'mention-chip'
    chip.innerHTML = `
      <svg class="chip-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="chip-label">${file.name}</span>
      <span class="chip-close" data-chip-close="1" aria-label="remove">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </span>`.trim()

    range.insertNode(chip)
    const space = document.createTextNode('\u00A0')
    chip.after(space)
    const newRange = document.createRange()
    newRange.setStart(space, 1)
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)

    setMenuOpen(false)
    sync()
    editorRef.current?.focus()
  }

  const switchAgent = (agent: AgentItem) => {
    clearAtToken()
    setTargetAgent(agent)
    setMenuOpen(false)
    sync()
    editorRef.current?.focus()
  }

  const handleSelect = (item: Item) => {
    if (item.kind === 'file') insertFileChip(item)
    else switchAgent(item)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (menuOpen && menuItems.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => (i + 1) % menuItems.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => (i - 1 + menuItems.length) % menuItems.length); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !composingRef.current)) {
        e.preventDefault(); handleSelect(menuItems[selectedIndex]); return
      }
      if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); return }
    }

    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
      e.preventDefault()
      const text = editorRef.current ? serialize(editorRef.current) : ''
      if (text.trim()) {
        setSentHistory((h) => [{ text, agent: targetAgent.id }, ...h].slice(0, 8))
        if (editorRef.current) editorRef.current.innerHTML = ''
        setSerialized('')
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    sel.getRangeAt(0).deleteContents()
    sel.getRangeAt(0).insertNode(document.createTextNode(text))
    sel.collapseToEnd()
    sync()
  }

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    const cs = () => { composingRef.current = true }
    const ce = () => { composingRef.current = false; refreshMenu() }
    const onBeforeInput = (e: Event) => {
      const ie = e as InputEvent
      const sel = window.getSelection()
      if (!sel || !sel.isCollapsed) return
      if (ie.inputType === 'deleteContentBackward') {
        const chip = findAdjacentChip('prev')
        if (chip) {
          ie.preventDefault()
          deleteChipWithSpaces(chip)
          sync()
        }
      } else if (ie.inputType === 'deleteContentForward') {
        const chip = findAdjacentChip('next')
        if (chip) {
          ie.preventDefault()
          deleteChipWithSpaces(chip)
          sync()
        }
      }
    }
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const closeBtn = target.closest('[data-chip-close="1"]') as HTMLElement | null
      if (!closeBtn) return
      const chip = closeBtn.closest('.mention-chip') as HTMLElement | null
      if (!isChip(chip)) return
      e.preventDefault()
      e.stopPropagation()
      deleteChipWithSpaces(chip)
      setTooltip(null)
      sync()
    }
    /** hover chip →  tooltip  overflow  */
    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      const chip = target?.closest?.('.mention-chip') as HTMLElement | null
      if (!chip) return
      const rect = chip.getBoundingClientRect()
      setTooltip({
        text: chip.dataset.value ?? '',
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
      setTooltip(null)
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
  }, [])

  return (
    <div style={{ padding: 32, maxWidth: 760, margin: '0 auto', color: 'rgb(var(--text-primary))' }}>
      <style>{`
        .mention-editor {
          min-height: 80px;
          max-height: 240px;
          overflow-y: auto;
          padding: 10px 12px;
          border: 1px solid rgb(var(--border-color));
          border-radius: 8px;
          background: rgb(var(--bg-elevated));
          font-size: 13px;
          line-height: 1.75;
          outline: none;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .mention-editor:focus {
          border-color: rgba(var(--accent-brand), 0.5);
          box-shadow: 0 0 0 3px rgba(var(--accent-brand), 0.08);
        }
        .mention-editor:empty::before {
          content: attr(data-placeholder);
          color: rgb(var(--text-muted));
          pointer-events: none;
        }
        .mention-chip {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 0 6px;
          margin: 0 1px;
          background: rgba(var(--accent-brand), 0.12);
          color: rgb(var(--accent-brand));
          border-radius: 4px;
          font-weight: 500;
          font-size: 12px;
          line-height: 1.5;
          white-space: nowrap;
          user-select: all;
          cursor: default;
          vertical-align: baseline;
          max-width: 260px;
          transition: background 0.15s;
        }
        .mention-chip:hover {
          background: rgba(var(--accent-brand), 0.2);
        }
        .mention-chip .chip-icon {
          opacity: 0.7;
          flex-shrink: 0;
        }
        .mention-chip .chip-label {
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
        .mention-chip .chip-close {
          position: absolute;
          right: 2px;
          top: 50%;
          transform: translateY(-50%);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgb(var(--accent-brand));
          color: #fff;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.12s, transform 0.12s;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
        }
        .mention-chip:hover .chip-close {
          opacity: 1;
          pointer-events: auto;
          cursor: pointer;
        }
        .mention-chip .chip-close:hover {
          background: rgb(var(--accent-brand-deep));
          transform: translateY(-50%) scale(1.1);
        }
        .mention-chip .chip-close svg {
          pointer-events: none;
        }
        .mention-tooltip {
          position: fixed;
          z-index: 9999;
          background: #111;
          color: #fff;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          line-height: 1.4;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 6px 20px rgba(0,0,0,0.4);
          transform: translateX(-50%);
          border: 1px solid rgba(255,255,255,0.08);
          animation: tooltipFadeIn 0.1s ease-out;
        }
        .mention-tooltip::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 5px solid transparent;
          border-bottom-color: #111;
        }
        @keyframes tooltipFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .mention-menu {
          position: absolute;
          z-index: 50;
          background: rgb(var(--bg-elevated));
          border: 1px solid rgb(var(--border-color));
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.12);
          min-width: 320px;
          max-height: 280px;
          overflow-y: auto;
        }
        .mention-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
          cursor: pointer;
        }
        .mention-menu-item.active {
          background: rgba(var(--accent-brand), 0.08);
          color: rgb(var(--accent-brand));
        }
        .mention-menu-section {
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgb(var(--text-muted));
          border-bottom: 1px solid rgb(var(--border-color));
        }
        .agent-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          background: rgba(var(--accent-brand), 0.12);
          color: rgb(var(--accent-brand));
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
        }
      `}</style>

      <h2 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>Mention Chip Demo v2</h2>
      <p style={{ marginBottom: 16, fontSize: 12, color: 'rgb(var(--text-muted))', lineHeight: 1.7 }}>
        <b>Product logic:</b><br />
        • <b>File</b> = Message content → insert chip (short name display + tooltip full path), serialized as <code>@&lt;path&gt;</code> on send<br />
        • <b>Agent</b> = Conversation target → <b>not inserted in message</b>, directly switches target indicator (equivalent to bottom Agent chip)<br />
        • <b>Chip delete</b>: press Backspace once after chip to delete entire chip<br />
        <b>Shortcuts:</b><kbd>↑↓</kbd> Navigate · <kbd>Enter/Tab</kbd> Select · <kbd>Esc</kbd> Close · <kbd>Backspace</kbd> Delete chip · <kbd>Enter</kbd> Send
      </p>

      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: 'rgb(var(--text-muted))' }}>Target Agent：</span>
        <span className="agent-chip">
          <Users size={11} />
          {targetAgent.name}
        </span>
        <span style={{ color: 'rgb(var(--text-muted))' }}>(session config, not in message)</span>
      </div>

      <div style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          className="mention-editor"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Type a message... try @"
          onInput={() => { refreshMenu(); sync() }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onKeyUp={refreshMenu}
          onClick={refreshMenu}
        />

        {menuOpen && (
          <div className="mention-menu" style={{ top: menuPos.top, left: menuPos.left }}>
            {(() => {
              const files = menuItems.filter((i): i is FileItem => i.kind === 'file')
              const agents = menuItems.filter((i): i is AgentItem => i.kind === 'agent')
              const out: React.ReactNode[] = []
              if (files.length > 0) {
                out.push(<div key="fs" className="mention-menu-section">Files</div>)
                files.forEach((f) => {
                  const idx = menuItems.indexOf(f)
                  out.push(
                    <div
                      key={f.id}
                      className={`mention-menu-item ${idx === selectedIndex ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(f) }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <FileText size={12} style={{ opacity: 0.6 }} />
                      <span style={{ fontWeight: 500 }}>{f.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgb(var(--text-muted))' }}>
                        {f.path}
                      </span>
                    </div>,
                  )
                })
              }
              if (agents.length > 0) {
                out.push(<div key="as" className="mention-menu-section">Agents (select = switch target, no trace in message)</div>)
                agents.forEach((a) => {
                  const idx = menuItems.indexOf(a)
                  out.push(
                    <div
                      key={a.id}
                      className={`mention-menu-item ${idx === selectedIndex ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); handleSelect(a) }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Users size={12} style={{ opacity: 0.6 }} />
                      <span style={{ fontWeight: 500 }}>{a.name}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgb(var(--text-muted))' }}>
                        {a.id}
                      </span>
                    </div>,
                  )
                })
              }
              return out
            })()}
          </div>
        )}
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ fontSize: 11, color: 'rgb(var(--text-muted))', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.04 }}>
          Send Payload (Claude Code / Codex compatible format)
        </div>
        <div style={{ background: 'rgb(var(--bg-secondary))', padding: 10, borderRadius: 6, fontSize: 12 }}>
          <div style={{ color: 'rgb(var(--text-muted))', marginBottom: 4 }}>message.content:</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{serialized || <span style={{ color: 'rgb(var(--text-muted))' }}>(empty)</span>}</pre>
          <div style={{ color: 'rgb(var(--text-muted))', marginTop: 8, marginBottom: 4 }}>session.targetAgent:</div>
          <pre style={{ margin: 0 }}>{targetAgent.id}</pre>
        </div>
      </div>

      {tooltip && createPortal(
        <div className="mention-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          {tooltip.text}
        </div>,
        document.body,
      )}

      {sentHistory.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 11, color: 'rgb(var(--text-muted))', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.04 }}>
            SendHistory
          </div>
          {sentHistory.map((msg, i) => (
            <div key={i} style={{
              background: 'rgb(var(--bg-secondary))',
              padding: 8,
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 6,
            }}>
              <div style={{ color: 'rgb(var(--text-muted))', fontSize: 10, marginBottom: 2 }}>
                → {msg.agent}
              </div>
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{msg.text}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default MentionInputDemo
