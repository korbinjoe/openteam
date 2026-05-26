/**
 * Mention chip DOM helpers for contentEditable InputArea.
 *
 * File mentions render as atomic chips that serialize to `@<path>`.
 * Agent mentions stay plain text `@<agent-id>` for parseMentions compatibility.
 */

export interface FileMention { kind: 'file'; name: string; path: string }
export interface FolderMention { kind: 'folder'; name: string; path: string }

export const isChip = (n: Node | null | undefined): n is HTMLElement =>
  n instanceof HTMLElement && (n.dataset.mention === 'file' || n.dataset.mention === 'folder' || n.dataset.mention === 'code-snippet' || n.dataset.mention === 'command')

/** DOM → plain text. File chip → @<path>. NBSP → space. <br> / <div> → \n */
export const serialize = (root: HTMLElement): string => {
  let out = ''
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\u00A0/g, ' ')
      return
    }
    if (node instanceof HTMLElement) {
      if (node.dataset.mention === 'file' || node.dataset.mention === 'folder') {
        out += `@${node.dataset.value ?? ''}`
        return
      }
      if (node.dataset.mention === 'code-snippet') {
        out += node.dataset.value ?? ''
        return
      }
      if (node.dataset.mention === 'command') {
        out += `/${node.dataset.value ?? ''}`
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

export const findTrigger = (): { query: string; textNode: Text; atIndex: number; cursorOffset: number } | null => {
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

export const findAdjacentChip = (direction: 'prev' | 'next'): HTMLElement | null => {
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

export const deleteChipWithSpaces = (chip: HTMLElement) => {
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

/**  File chip DOMicon + label + close button */
export const createFileChip = (file: FileMention): HTMLSpanElement => {
  const chip = document.createElement('span')
  chip.setAttribute('contenteditable', 'false')
  chip.dataset.mention = 'file'
  chip.dataset.value = file.path
  chip.className = 'mention-chip'
  chip.innerHTML = `
    <svg class="chip-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    <span class="chip-label">${escapeHtml(file.name)}</span>
    <span class="chip-close" data-chip-close="1" aria-label="remove">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </span>`.trim()
  return chip
}

/**  Folder chip DOMfolder icon + label + close button */
export const createFolderChip = (folder: FolderMention): HTMLSpanElement => {
  const chip = document.createElement('span')
  chip.setAttribute('contenteditable', 'false')
  chip.dataset.mention = 'folder'
  chip.dataset.value = folder.path
  chip.className = 'mention-chip'
  chip.innerHTML = `
    <svg class="chip-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    <span class="chip-label">${escapeHtml(folder.name)}</span>
    <span class="chip-close" data-chip-close="1" aria-label="remove">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </span>`.trim()
  return chip
}

export interface CodeSnippetMention {
  kind: 'code-snippet'
  fileName: string
  filePath: string
  startLine: number
  endLine: number
  code: string
  language: string
}

/**  Code Snippet chip DOMcode icon + label + close button */
export const createCodeSnippetChip = (snippet: CodeSnippetMention): HTMLSpanElement => {
  const label = `${snippet.fileName}:${snippet.startLine}-${snippet.endLine}`
  const lang = snippet.language || ''
  const serialized = `@${snippet.fileName}:${snippet.startLine}-${snippet.endLine}\n\`\`\`${lang}\n${snippet.code}\n\`\`\`\n`
  const chip = document.createElement('span')
  chip.setAttribute('contenteditable', 'false')
  chip.dataset.mention = 'code-snippet'
  chip.dataset.value = serialized
  chip.className = 'mention-chip code-snippet-chip'
  chip.innerHTML = `
    <svg class="chip-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    <span class="chip-label">${escapeHtml(label)}</span>
    <span class="chip-close" data-chip-close="1" aria-label="remove">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </span>`.trim()
  return chip
}

export interface CommandMention { kind: 'command'; name: string; toolLabel: string }

export const createCommandChip = (cmd: CommandMention): HTMLSpanElement => {
  const chip = document.createElement('span')
  chip.setAttribute('contenteditable', 'false')
  chip.dataset.mention = 'command'
  chip.dataset.value = cmd.name
  chip.className = 'mention-chip command-chip'
  chip.innerHTML = `
    <svg class="chip-icon" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
    <span class="chip-label">/${escapeHtml(cmd.name)}</span>`.trim()
  return chip
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const insertChipAtCursor = (chip: HTMLSpanElement) => {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(chip)
  const space = document.createTextNode('\u00A0')
  chip.after(space)
  const newRange = document.createRange()
  newRange.setStart(space, 1)
  newRange.collapse(true)
  sel.removeAllRanges()
  sel.addRange(newRange)
}

export const clearAtToken = (): boolean => {
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

export const resetEditor = (editor: HTMLElement, text: string) => {
  if (text === '') {
    editor.innerHTML = ''
  } else {
    editor.textContent = text
  }
}

/** Chip + tooltip  <style>  */
export const MENTION_CHIP_CSS = `
.mention-editor {
  outline: none;
  white-space: pre-wrap;
  word-break: break-word;
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
.mention-chip:hover { background: rgba(var(--accent-brand), 0.2); }
.mention-chip .chip-icon { opacity: 0.7; flex-shrink: 0; }
.mention-chip .chip-label { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
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
.mention-chip .chip-close svg { pointer-events: none; }
.code-snippet-chip {
  background: rgba(var(--accent-green, var(--accent-brand)), 0.12);
  color: rgb(var(--accent-green, var(--accent-brand)));
}
.code-snippet-chip:hover { background: rgba(var(--accent-green, var(--accent-brand)), 0.2); }
.code-snippet-chip .chip-close {
  background: rgb(var(--accent-green, var(--accent-brand)));
}
.code-snippet-chip .chip-close:hover {
  background: rgb(var(--accent-green, var(--accent-brand)));
}
.command-chip {
  background: rgba(var(--accent-purple, 168, 85, 247), 0.12);
  color: rgb(var(--accent-purple, 168, 85, 247));
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  letter-spacing: -0.01em;
}
.command-chip:hover { background: rgba(var(--accent-purple, 168, 85, 247), 0.2); }
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
  animation: mention-tooltip-fade 0.1s ease-out;
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
@keyframes mention-tooltip-fade { from { opacity: 0; } to { opacity: 1; } }
`
