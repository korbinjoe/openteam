import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'
import { X, Loader2, Image, FileText, Eye, Code2, FileQuestion, Save, Lock, Pencil, Scissors, Copy, ClipboardPaste, CheckSquare, MessageSquarePlus } from 'lucide-react'
import '@/lib/monaco'
import Editor from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { KeyMod, KeyCode } from 'monaco-editor'
import type { EditorTab } from '@/hooks/useWebIDEState'
import type { ChangeStatus } from '@/lib/changeTree'
import { API_BASE } from '@/config/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'

interface EditorContextMenuState {
  x: number
  y: number
  hasSelection: boolean
}

const EditorMenuDivider = () => <div className="my-0.5 border-t border-border-subtle" />

const EditorMenuItem = ({ icon, label, onClick, disabled, shortcut }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  shortcut?: string
}) => (
  <button
    className={cn(
      'flex items-center gap-1.5 w-full px-2 py-1 text-[11px] hover:bg-bg-hover transition-colors text-left',
      'text-text-primary',
      disabled && 'opacity-40 pointer-events-none',
    )}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
    <span className="flex-1">{label}</span>
    {shortcut && <span className="text-text-muted text-[10px] ml-3">{shortcut}</span>}
  </button>
)

const InlineDiffViewer = lazy(() => import('@/components/changes/InlineDiffViewer'))

interface DiffEntry {
  file: string
  status: ChangeStatus
  staged?: boolean
  insertions: number
  deletions: number
}

interface EditorTabsProps {
  tabs: EditorTab[]
  activeTabPath: string | null
  onTabSelect: (path: string) => void
  onTabClose: (path: string) => void
  onContentChange: (path: string, content: string) => void
  onSave: (path: string, content: string) => void
  /** Worktree  →  + InlineDiffViewer */
  worktreePath?: string
  baseBranch?: string
  changeMap?: Map<string, DiffEntry>
  agentActive?: boolean
  pendingLine?: number | null
  pendingKeyword?: string | null
  onPendingLineHandled?: () => void
  onRefreshTab?: (filePath: string) => void
}

const toRelative = (absolutePath: string, worktreePath?: string): string | null => {
  if (!worktreePath) return null
  if (!absolutePath.startsWith(worktreePath)) return null
  return absolutePath.slice(worktreePath.length).replace(/^\//, '')
}

const ImagePreview = ({ filePath }: { filePath: string }) => (
  <div className="h-full flex items-center justify-center p-4 overflow-auto bg-bg-primary">
    <img
      src={`${API_BASE}/api/file?path=${encodeURIComponent(filePath)}`}
      alt={filePath.split('/').pop() || ''}
      className="max-w-full max-h-full object-contain"
      draggable={false}
    />
  </div>
)

const MarkdownPreview = ({ content }: { content: string }) => (
  <div className="h-full overflow-auto bg-bg-primary p-4">
    <div className="md-preview max-w-[760px]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  </div>
)

const BinaryPlaceholder = ({ name }: { name: string }) => {
  const { t } = useTranslation('workspace')
  return (
    <div className="h-full flex flex-col items-center justify-center text-text-muted gap-3 select-none">
      <FileQuestion size={40} className="opacity-40" />
      <div className="text-sm">{t('ide.binaryFile')}</div>
      <div className="text-xs opacity-60">{name}</div>
    </div>
  )
}

const EditorTabs = ({
  tabs, activeTabPath, onTabSelect, onTabClose,
  onContentChange, onSave,
  worktreePath, baseBranch, changeMap, agentActive: _agentActive,
  pendingLine, pendingKeyword, onPendingLineHandled, onRefreshTab,
}: EditorTabsProps) => {
  const { t } = useTranslation(['workspace', 'chat'])
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabPathRef = useRef(activeTabPath)
  activeTabPathRef.current = activeTabPath
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const handleSaveWithFeedbackRef = useRef<(filePath: string, content: string) => void>(null!)
  const pendingLineRef = useRef(pendingLine)
  pendingLineRef.current = pendingLine
  const pendingKeywordRef = useRef(pendingKeyword)
  pendingKeywordRef.current = pendingKeyword
  const onPendingLineHandledRef = useRef(onPendingLineHandled)
  onPendingLineHandledRef.current = onPendingLineHandled
  const decorationsRef = useRef<MonacoEditor.IEditorDecorationsCollection | null>(null)
  const activeTab = tabs.find(t => t.path === activeTabPath)
  const [, setSavedPath] = useState<string | null>(null)
  const [, setSavedVisible] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [editorContextMenu, setEditorContextMenu] = useState<EditorContextMenuState | null>(null)
  const editorContextMenuRef = useRef<HTMLDivElement>(null)
  const [editorMenuPos, setEditorMenuPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (!editorContextMenu) { setEditorMenuPos(null); return }
    requestAnimationFrame(() => {
      const el = editorContextMenuRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = editorContextMenu.x + rect.width > vw ? vw - rect.width - 4 : editorContextMenu.x
      const top = editorContextMenu.y + rect.height > vh ? vh - rect.height - 4 : editorContextMenu.y
      setEditorMenuPos({ left: Math.max(4, left), top: Math.max(4, top) })
    })
  }, [editorContextMenu])

  useEffect(() => {
    if (!editorContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (editorContextMenuRef.current && !editorContextMenuRef.current.contains(e.target as Node)) {
        setEditorContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [editorContextMenu])

  const isMac = useMemo(() => navigator.platform.toUpperCase().includes('MAC'), [])
  const modKey = isMac ? '⌘' : 'Ctrl+'

  const handleEditorContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const editor = editorRef.current
    const hasSelection = editor ? !editor.getSelection()?.isEmpty() : false
    setEditorContextMenu({ x: e.clientX, y: e.clientY, hasSelection })
  }, [])

  const handleEditorMenuAction = useCallback((action: string) => {
    const editor = editorRef.current
    setEditorContextMenu(null)
    if (!editor) return

    switch (action) {
      case 'cut':
        editor.focus()
        editor.trigger('contextmenu', 'editor.action.clipboardCutAction', null)
        break
      case 'copy':
        editor.focus()
        editor.trigger('contextmenu', 'editor.action.clipboardCopyAction', null)
        break
      case 'paste':
        editor.focus()
        editor.trigger('contextmenu', 'editor.action.clipboardPasteAction', null)
        break
      case 'select-all':
        editor.focus()
        editor.trigger('contextmenu', 'editor.action.selectAll', null)
        break
      case 'add-to-chat': {
        const selection = editor.getSelection()
        const edModel = editor.getModel()
        if (!selection || !edModel || selection.isEmpty()) return
        const code = edModel.getValueInRange(selection)
        const filePath = activeTabPathRef.current || ''
        const language = edModel.getLanguageId() || ''
        window.dispatchEvent(new CustomEvent('chat:insert-code-snippet', {
          detail: {
            code,
            filePath,
            startLine: selection.startLineNumber,
            endLine: selection.endLineNumber,
            language,
          },
        }))
        break
      }
    }
  }, [])

  const handleSaveWithFeedback = useCallback((filePath: string, content: string) => {
    onSave(filePath, content)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSavedPath(filePath)
    setSavedVisible(true)
    savedTimerRef.current = setTimeout(() => {
      setSavedVisible(false)
      savedTimerRef.current = setTimeout(() => setSavedPath(null), 300)
    }, 800)
  }, [onSave])
  handleSaveWithFeedbackRef.current = handleSaveWithFeedback

  useEffect(() => {
    setSavedPath(null)
    setSavedVisible(false)
  }, [activeTabPath])

  const [mdPreviewMode, setMdPreviewMode] = useState<Record<string, boolean>>({})

  const { activeRelativePath, isActiveChanged, isActiveStaged } = useMemo(() => {
    if (!activeTab || !worktreePath || !changeMap) {
      return { activeRelativePath: null, isActiveChanged: false, isActiveStaged: false }
    }
    const rel = toRelative(activeTab.path, worktreePath)
    const entry = rel ? changeMap.get(rel) : undefined
    return {
      activeRelativePath: rel,
      isActiveChanged: !!entry,
      isActiveStaged: !!entry?.staged,
    }
  }, [activeTab, worktreePath, changeMap])

  const applyKeywordHighlight = useCallback((editor: MonacoEditor.IStandaloneCodeEditor, keyword: string | null | undefined) => {
    decorationsRef.current?.clear()
    if (!keyword) return
    const model = editor.getModel()
    if (!model) return
    const matches = model.findMatches(keyword, false, false, false, null, false)
    if (matches.length === 0) return
    decorationsRef.current = editor.createDecorationsCollection(
      matches.map(m => ({
        range: m.range,
        options: {
          className: 'search-highlight-match',
          overviewRuler: { color: '#f59e0b', position: 1 },
        },
      }))
    )
  }, [])

  const handleEditorMount = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    const line = pendingLineRef.current
    if (line) {
      editor.revealLineInCenter(line)
      editor.setPosition({ lineNumber: line, column: 1 })
      editor.focus()
      applyKeywordHighlight(editor, pendingKeywordRef.current)
      onPendingLineHandledRef.current?.()
    }

    // eslint-disable-next-line no-bitwise
    editor.addCommand(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL, () => {
      const selection = editor.getSelection()
      const model = editor.getModel()
      if (!selection || !model || selection.isEmpty()) return
      const code = model.getValueInRange(selection)
      const filePath = activeTabPathRef.current || ''
      const language = model.getLanguageId() || ''
      window.dispatchEvent(new CustomEvent('chat:insert-code-snippet', {
        detail: {
          code,
          filePath,
          startLine: selection.startLineNumber,
          endLine: selection.endLineNumber,
          language,
        },
      }))
    })
  }, [applyKeywordHighlight])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        const currentTab = tabsRef.current.find(t => t.path === activeTabPathRef.current)
        if (currentTab?.isDirty && editorRef.current) {
          onSaveRef.current(currentTab.path, editorRef.current.getValue())
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (activeTabPath && value !== undefined) {
      onContentChange(activeTabPath, value)
    }
  }, [activeTabPath, onContentChange])

  useEffect(() => {
    if (editorRef.current && activeTab && !activeTab.isLoading) {
      const model = editorRef.current.getModel()
      if (model && model.getValue() !== activeTab.content) {
        model.setValue(activeTab.content)
      }
    }
  }, [activeTabPath, activeTab?.content])

  useEffect(() => {
    if (!pendingLine || !editorRef.current || !activeTab || activeTab.isLoading) return
    const editor = editorRef.current
    editor.revealLineInCenter(pendingLine)
    editor.setPosition({ lineNumber: pendingLine, column: 1 })
    editor.focus()
    applyKeywordHighlight(editor, pendingKeyword)
    onPendingLineHandled?.()
  }, [pendingLine, activeTab?.isLoading, activeTabPath, pendingKeyword, applyKeywordHighlight])

  if (tabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm select-none">
        <div className="text-center space-y-1">
          <div className="text-base opacity-50">{t('workspace:ide.clickToOpen')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center h-8 bg-bg-secondary border-b border-border-subtle overflow-x-auto shrink-0">
        {tabs.map(tab => {
          const isActive = tab.path === activeTabPath
          const tabIcon = tab.previewType === 'image' ? <Image size={10} className="shrink-0 text-green-400" />
            : tab.previewType === 'markdown' ? <FileText size={10} className="shrink-0 text-blue-400" />
            : null

          return (
            <button
              key={tab.path}
              onClick={() => onTabSelect(tab.path)}
              className={cn(
                'group flex items-center gap-1 px-3 h-full text-xs border-r border-border-subtle whitespace-nowrap shrink-0 transition-colors',
                isActive
                  ? 'bg-bg-primary text-text-primary'
                  : 'bg-bg-secondary text-text-secondary hover:bg-bg-hover',
              )}
            >
              {tabIcon}
              <span className="truncate max-w-[120px]">{tab.name}</span>
              {tab.isDirty && (
                <span className="size-1.5 rounded-full bg-accent-brand shrink-0" />
              )}
              {tab.isLoading && (
                <Loader2 size={10} className="animate-spin shrink-0" />
              )}
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onTabClose(tab.path) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onTabClose(tab.path) } }}
                className="ml-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-bg-hover transition-opacity"
              >
                <X size={10} />
              </span>
            </button>
          )
        })}
      </div>

      {/* Editor area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab?.previewType === 'markdown' && !activeTab.isLoading && (
          <div className="flex items-center gap-1 px-2 py-1 bg-bg-secondary border-b border-border-subtle shrink-0">
            <button
              onClick={() => setMdPreviewMode(prev => ({ ...prev, [activeTab.path]: false }))}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors',
                !(mdPreviewMode[activeTab.path] ?? true)
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
              )}
            >
              <Code2 size={11} />
              {t('workspace:ide.source')}
            </button>
            <button
              onClick={() => {
                setMdPreviewMode(prev => ({ ...prev, [activeTab.path]: true }))
                onRefreshTab?.(activeTab.path)
              }}
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors',
                (mdPreviewMode[activeTab.path] ?? true)
                  ? 'bg-bg-primary text-text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover',
              )}
            >
              <Eye size={11} />
              Preview
            </button>
          </div>
        )}

        <div className="flex-1 min-h-0">
          {activeTab?.isLoading ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={20} className="animate-spin text-text-muted" />
            </div>
          ) : activeTab?.previewType === 'image' ? (
            <ImagePreview filePath={activeTab.path} />
          ) : activeTab?.previewType === 'binary' ? (
            <BinaryPlaceholder name={activeTab.name} />
          ) : activeTab?.previewType === 'markdown' && (mdPreviewMode[activeTab.path] ?? true) ? (
            <MarkdownPreview content={activeTab.content} />
          ) : activeTab && isActiveChanged && worktreePath && baseBranch && activeRelativePath ? (
            <Suspense fallback={
              <div className="h-full flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            }>
              <InlineDiffViewer
                key={activeTab.path}
                worktreePath={worktreePath}
                filePath={activeRelativePath}
                baseBranch={baseBranch}
                readOnly={isActiveStaged}
                refreshKey={activeTab.originalContent.length}
              />
            </Suspense>
          ) : activeTab ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center gap-2 px-3 py-1 border-b border-border-subtle/50 shrink-0 bg-bg-secondary/50">
                <span className="text-xs font-mono text-text-secondary truncate" title={activeTab.path}>
                  {activeTab.name}
                </span>
                {activeTab.isDirty && !isActiveStaged && (
                  <span className="text-xs text-accent-yellow font-medium">{t('changes.unsaved', { defaultValue: 'Unsaved' })}</span>
                )}
                <span className="flex-1" />
                {!isActiveStaged && activeTab.isDirty && (
                  <button
                    type="button"
                    onClick={() => {
                      if (editorRef.current) {
                        onSave(activeTab.path, editorRef.current.getValue())
                      }
                    }}
                    className="flex items-center gap-1 px-1.5 py-0.5 text-xs text-accent-brand bg-accent-brand/10 rounded border-none cursor-pointer hover:bg-accent-brand/20 transition-colors"
                  >
                    <Save size={9} />
                    {t('changes.save', { defaultValue: 'Save' })}
                  </button>
                )}
                {isActiveStaged ? (
                  <span className="flex items-center gap-1 text-xs text-text-secondary">
                    <Lock size={9} />
                    {t('changes.readOnly', { defaultValue: 'Read-only' })}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-accent-green">
                    <Pencil size={9} />
                    {t('changes.editable', { defaultValue: 'Editable' })}
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <div className="h-full" onContextMenu={handleEditorContextMenu}>
                  <Editor
                    key={activeTab.path}
                    value={activeTab.content}
                    language={activeTab.language}
                    theme="vs-dark"
                    onChange={handleEditorChange}
                    onMount={handleEditorMount}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      tabSize: 2,
                      readOnly: isActiveStaged,
                      automaticLayout: true,
                      padding: { top: 8 },
                      contextmenu: false,
                    }}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {editorContextMenu && (
        <div
          ref={editorContextMenuRef}
          className="fixed z-50 bg-bg-secondary border border-border-subtle rounded shadow-lg py-0.5 min-w-[160px]"
          style={{
            left: editorMenuPos?.left ?? editorContextMenu.x,
            top: editorMenuPos?.top ?? editorContextMenu.y,
            visibility: editorMenuPos ? 'visible' : 'hidden',
          }}
        >
          <EditorMenuItem icon={<Scissors size={10} />} label={t('workspace:ide.cut')} shortcut={`${modKey}X`} onClick={() => handleEditorMenuAction('cut')} disabled={!editorContextMenu.hasSelection || isActiveStaged} />
          <EditorMenuItem icon={<Copy size={10} />} label="Copy" shortcut={`${modKey}C`} onClick={() => handleEditorMenuAction('copy')} disabled={!editorContextMenu.hasSelection} />
          <EditorMenuItem icon={<ClipboardPaste size={10} />} label="Paste" shortcut={`${modKey}V`} onClick={() => handleEditorMenuAction('paste')} disabled={isActiveStaged} />
          <EditorMenuDivider />
          <EditorMenuItem icon={<CheckSquare size={10} />} label="Select All" shortcut={`${modKey}A`} onClick={() => handleEditorMenuAction('select-all')} />
          <EditorMenuDivider />
          <EditorMenuItem icon={<MessageSquarePlus size={10} />} label={t('workspace:ide.addToChat')} shortcut={`${modKey}⇧L`} onClick={() => handleEditorMenuAction('add-to-chat')} disabled={!editorContextMenu.hasSelection} />
        </div>
      )}
    </div>
  )
}

export default EditorTabs
