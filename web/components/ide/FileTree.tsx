import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  ChevronRight, ChevronDown, RefreshCcw, Loader2, File, Folder, FolderOpen,
  Search, ArrowLeft, SearchCode, Trash2, FilePlus, FolderPlus, Scissors,
  Copy, ClipboardPaste, Pencil, ExternalLink, Eye, EyeOff, MessageSquarePlus,
  Globe,
} from 'lucide-react'
import { API_BASE, authFetch } from '@/config/api'
import type { ChangeStatus, DirAggregate } from '@/lib/changeTree'
import { useFileSearch, type FileSearchResult } from '@/hooks/useFileSearch'
import { useFileTreeActions, type InlineInputState } from '@/hooks/useFileTreeActions'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: TreeNode[]
  isLoading?: boolean
  isExpanded?: boolean
  ignored?: boolean
}

interface DiffEntry {
  file: string
  status: ChangeStatus
  insertions: number
  deletions: number
}

export interface FileTreeRoot {
  path: string
  name: string
}

interface FileTreeProps {
  roots: FileTreeRoot[]
  onFileSelect: (filePath: string) => void
  selectedFile?: string | null
  changeMap?: Map<string, DiffEntry>
  dirAggregate?: Map<string, DirAggregate>
  onContentSearch?: () => void
  onFileDelete?: (filePath: string) => void
  refreshTrigger?: number
  revealPath?: string | null
  revealTrigger?: number
}

interface RootState {
  nodes: TreeNode[]
  loaded: boolean
  isLoading: boolean
  expanded: boolean
  autoExpandedChanges: boolean
}

const STATUS_LETTER: Record<ChangeStatus, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }
const STATUS_COLOR: Record<ChangeStatus, string> = { added: 'text-green-500', modified: 'text-amber-500', deleted: 'text-red-500', renamed: 'text-blue-500' }

const fetchEntries = async (dirPath: string, showIgnored = false): Promise<TreeNode[]> => {
  const params = new URLSearchParams({ path: dirPath })
  if (showIgnored) params.set('showIgnored', 'true')
  const res = await authFetch(`${API_BASE}/api/list-files?${params}`)
  const data = await res.json()
  return (data.entries || []).map((e: TreeNode) => ({
    ...e,
    children: e.type === 'directory' ? undefined : undefined,
    isExpanded: false,
    isLoading: false,
  }))
}

const mergeExpandedState = (newNodes: TreeNode[], oldNodes: TreeNode[]): TreeNode[] => {
  const oldMap = new Map(oldNodes.map(n => [n.path, n]))
  return newNodes.map(n => {
    const old = oldMap.get(n.path)
    if (!old || n.type !== 'directory' || !old.isExpanded) return n
    return { ...n, isExpanded: true, children: old.children }
  })
}

interface ContextMenuState {
  x: number
  y: number
  path: string
  name: string
  type: 'file' | 'directory'
}

const updateNodeChildren = (
  nodes: TreeNode[], targetPath: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] => {
  return nodes.map(n => {
    if (n.path === targetPath) return updater(n)
    if (n.children) return { ...n, children: updateNodeChildren(n.children, targetPath, updater) }
    return n
  })
}

const getDeletedChildren = (
  changeMap: Map<string, DiffEntry> | undefined,
  dirRelativePath: string,
  existingChildren: TreeNode[] | undefined,
  dirAbsPath: string,
): TreeNode[] => {
  if (!changeMap) return []
  const prefix = dirRelativePath ? `${dirRelativePath}/` : ''
  const existingNames = new Set(existingChildren?.map(c => c.name) ?? [])
  const result: TreeNode[] = []
  const addedDirs = new Set<string>()

  for (const [filePath, entry] of changeMap) {
    if (entry.status !== 'deleted') continue
    if (prefix && !filePath.startsWith(prefix)) continue
    const rest = prefix ? filePath.slice(prefix.length) : filePath
    if (!rest) continue

    if (rest.includes('/')) {
      const subDirName = rest.split('/')[0]
      if (!existingNames.has(subDirName) && !addedDirs.has(subDirName)) {
        addedDirs.add(subDirName)
        result.push({
          name: subDirName,
          path: `${dirAbsPath}/${subDirName}`,
          type: 'directory',
          isExpanded: true,
          children: [],
        })
      }
    } else {
      if (!existingNames.has(rest)) {
        result.push({
          name: rest,
          path: `${dirAbsPath}/${rest}`,
          type: 'file',
        })
      }
    }
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return result
}

const InlineInput = ({ defaultValue, onSubmit, onCancel, icon }: {
  defaultValue?: string
  onSubmit: (value: string) => void
  onCancel: () => void
  icon: React.ReactNode
}) => {
  const [value, setValue] = useState(defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      if (defaultValue) {
        const dotIdx = defaultValue.lastIndexOf('.')
        input.setSelectionRange(0, dotIdx > 0 ? dotIdx : defaultValue.length)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [defaultValue])

  const doSubmit = useCallback((v: string) => {
    if (submittedRef.current) return
    submittedRef.current = true
    onSubmit(v)
  }, [onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSubmit(value)
    } else if (e.key === 'Escape') {
      submittedRef.current = true
      onCancel()
    }
  }

  return (
    <div className="flex items-center gap-1 py-0.5 px-1">
      {icon}
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => doSubmit(value)}
        className="flex-1 min-w-0 bg-bg-secondary border border-accent-brand rounded px-1 py-px text-xs text-text-primary outline-none"
      />
    </div>
  )
}

const TreeNodeItem = ({
  node, depth, selectedFile, onFileSelect, onToggle, changeMap, dirAggregate,
  relativePath, onContextMenu, inlineInput, onInlineSubmit, onInlineCancel,
  parentIgnored,
}: {
  node: TreeNode
  depth: number
  selectedFile?: string | null
  onFileSelect: (path: string) => void
  onToggle: (path: string) => void
  changeMap?: Map<string, DiffEntry>
  dirAggregate?: Map<string, DirAggregate>
  relativePath: string
  onContextMenu?: (e: React.MouseEvent, node: TreeNode) => void
  inlineInput?: InlineInputState | null
  onInlineSubmit?: (value: string) => void
  onInlineCancel?: () => void
  parentIgnored?: boolean
}) => {
  const isDir = node.type === 'directory'
  const isSelected = selectedFile === node.path
  const isIgnored = node.ignored || parentIgnored
  const fileChange = changeMap?.get(relativePath)
  const dirAgg = isDir ? dirAggregate?.get(relativePath) : undefined
  const nameColorClass = fileChange ? STATUS_COLOR[fileChange.status] : dirAgg ? STATUS_COLOR[dirAgg.dominant] : ''

  const isRenaming = inlineInput?.type === 'rename' && inlineInput.originalPath === node.path

  const handleClick = () => {
    if (isDir) onToggle(node.path)
    else if (fileChange?.status !== 'deleted') onFileSelect(node.path)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu?.(e, node)
  }

  const showNewInput = isDir && node.isExpanded && inlineInput
    && (inlineInput.type === 'new-file' || inlineInput.type === 'new-folder')
    && inlineInput.parentPath === node.path

  const deletedChildren = isDir && node.isExpanded
    ? getDeletedChildren(changeMap, relativePath, node.children, node.path)
    : []

  return (
    <>
      {isRenaming ? (
        <div style={{ paddingLeft: `${depth * 12 + 4}px` }}>
          <InlineInput
            defaultValue={node.name}
            onSubmit={v => onInlineSubmit?.(v)}
            onCancel={() => onInlineCancel?.()}
            icon={isDir
              ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
              : <File size={13} className="shrink-0 text-text-muted" />
            }
          />
        </div>
      ) : (
        <button
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          data-filepath={node.path}
          className={cn(
            'flex items-center gap-1 w-full text-left py-0.5 px-1 text-xs hover:bg-bg-hover transition-colors rounded-sm',
            isSelected && 'bg-accent-brand/15 text-accent-brand',
            isIgnored && 'opacity-45',
          )}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {isDir ? (
            <>
              {node.isLoading ? (
                <Loader2 size={12} className="shrink-0 animate-spin text-text-muted" />
              ) : node.isExpanded ? (
                <ChevronDown size={12} className="shrink-0 text-text-muted" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-text-muted" />
              )}
              {node.isExpanded ? (
                <FolderOpen size={13} className="shrink-0 text-accent-brand/70" />
              ) : (
                <Folder size={13} className="shrink-0 text-accent-brand/70" />
              )}
            </>
          ) : (
            <>
              <span className="w-3 shrink-0" />
              <File size={13} className="shrink-0 text-text-muted" />
            </>
          )}
          <span className={cn('truncate', nameColorClass, fileChange?.status === 'deleted' && 'line-through')}>{node.name}</span>
          {fileChange && (
            <span className={cn('shrink-0 text-[10px] font-mono leading-none', STATUS_COLOR[fileChange.status])}>
              {STATUS_LETTER[fileChange.status]}
            </span>
          )}
        </button>
      )}
      {showNewInput && (
        <div style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}>
          <InlineInput
            onSubmit={v => onInlineSubmit?.(v)}
            onCancel={() => onInlineCancel?.()}
            icon={inlineInput.type === 'new-folder'
              ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
              : <File size={13} className="shrink-0 text-text-muted" />
            }
          />
        </div>
      )}
      {isDir && node.isExpanded && [...(node.children || []), ...deletedChildren].map(child => (
        <TreeNodeItem
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedFile={selectedFile}
          onFileSelect={onFileSelect}
          onToggle={onToggle}
          changeMap={changeMap}
          dirAggregate={dirAggregate}
          relativePath={relativePath ? `${relativePath}/${child.name}` : child.name}
          onContextMenu={onContextMenu}
          inlineInput={inlineInput}
          onInlineSubmit={onInlineSubmit}
          onInlineCancel={onInlineCancel}
          parentIgnored={isIgnored}
        />
      ))}
    </>
  )
}

const FileSearchRepoGroup = ({
  root, items, onFileSelect,
}: {
  root: string
  items: FileSearchResult[]
  onFileSelect: (path: string) => void
}) => {
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 w-full text-left py-0.5 px-1 text-xs hover:bg-bg-hover transition-colors rounded-sm"
      >
        {expanded
          ? <ChevronDown size={12} className="shrink-0 text-text-muted" />
          : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
        {expanded
          ? <FolderOpen size={13} className="shrink-0 text-accent-brand/70" />
          : <Folder size={13} className="shrink-0 text-accent-brand/70" />}
        <span className="truncate font-medium text-text-primary">{root.split('/').pop()}</span>
        <span className="shrink-0 ml-auto text-[10px] text-text-muted">{items.length}</span>
      </button>
      {expanded && items.map(r => {
        const fullPath = r.path.startsWith('/') ? r.path : `${root}/${r.path}`
        const isDir = r.type === 'directory'
        return (
          <button
            key={`${root}:${r.path}`}
            onClick={() => { if (!isDir) onFileSelect(fullPath) }}
            className={cn(
              'flex items-center gap-1 w-full text-left py-0.5 px-1 text-xs hover:bg-bg-hover transition-colors rounded-sm',
              isDir && 'opacity-60',
            )}
            style={{ paddingLeft: `${1 * 12 + 4}px` }}
          >
            <span className="w-3 shrink-0" />
            {isDir
              ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
              : <File size={13} className="shrink-0 text-text-muted" />}
            <span className="truncate text-text-primary">{r.path}</span>
          </button>
        )
      })}
    </div>
  )
}

const FileSearchResults = ({
  results, loading, query, onFileSelect, rootPath, multiRoot,
}: {
  results: FileSearchResult[]
  loading: boolean
  query: string
  onFileSelect: (path: string) => void
  rootPath: string
  multiRoot?: boolean
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={14} className="animate-spin text-text-muted" />
      </div>
    )
  }
  if (query && results.length === 0) {
    return <div className="px-2 py-4 text-xs text-text-muted text-center">No files found</div>
  }

  if (!multiRoot) {
    return <>{results.map(r => {
      const fullPath = r.path.startsWith('/') ? r.path : `${rootPath}/${r.path}`
      const isDir = r.type === 'directory'
      return (
        <button
          key={r.path}
          onClick={() => { if (!isDir) onFileSelect(fullPath) }}
          className={cn(
            'flex items-center gap-1.5 w-full text-left py-0.5 px-1 text-xs hover:bg-bg-hover transition-colors rounded-sm',
            isDir && 'opacity-60',
          )}
        >
          {isDir
            ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
            : <File size={13} className="shrink-0 text-text-muted" />}
          <span className="truncate text-text-primary">{r.path}</span>
        </button>
      )
    })}</>
  }

  const grouped = new Map<string, FileSearchResult[]>()
  for (const r of results) {
    const key = r.root || rootPath
    const list = grouped.get(key)
    if (list) list.push(r)
    else grouped.set(key, [r])
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([root, items]) => (
        <FileSearchRepoGroup key={root} root={root} items={items} onFileSelect={onFileSelect} />
      ))}
    </>
  )
}

const MenuDivider = () => <div className="my-0.5 border-t border-border-subtle" />

const MenuItem = ({ icon, label, onClick, danger, disabled }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) => (
  <button
    className={cn(
      'flex items-center gap-1.5 w-full px-2 py-1 text-[11px] hover:bg-bg-hover transition-colors text-left',
      danger ? 'text-red-400' : 'text-text-primary',
      disabled && 'opacity-40 pointer-events-none',
    )}
    onClick={onClick}
    disabled={disabled}
  >
    {icon}
    {label}
  </button>
)

const FileTree = ({ roots, onFileSelect, selectedFile, changeMap, dirAggregate, onContentSearch, onFileDelete, refreshTrigger, revealPath, revealTrigger }: FileTreeProps) => {
  const { t } = useTranslation('workspace')
  const [rootsState, setRootsState] = useState<Record<string, RootState>>({})
  const rootsRef = useRef<FileTreeRoot[]>([])
  rootsRef.current = roots
  const [showIgnored, setShowIgnored] = useState(false)
  const showIgnoredRef = useRef(showIgnored)
  showIgnoredRef.current = showIgnored
  const [searchMode, setSearchMode] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const primaryRoot = roots[0]?.path ?? ''
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const { results: searchResults, loading: searchLoading } = useFileSearch(
    searchMode ? roots.map(r => r.path).join(',') : null, searchQuery, searchMode,
  )

  const showRootHeaders = roots.length > 1

  const loadSeqRef = useRef(0)

  const loadRoot = useCallback(async (rootPath: string) => {
    const seq = ++loadSeqRef.current
    setRootsState(prev => {
      const existing = prev[rootPath]
      if (existing?.loaded) return prev
      return {
        ...prev,
        [rootPath]: { ...(existing ?? { nodes: [], loaded: false, expanded: true, autoExpandedChanges: false }), isLoading: true },
      }
    })
    try {
      const entries = await fetchEntries(rootPath, showIgnoredRef.current)
      if (seq !== loadSeqRef.current) return
      setRootsState(prev => {
        const existing = prev[rootPath]
        const merged = existing?.nodes?.length
          ? mergeExpandedState(entries, existing.nodes)
          : entries
        return {
          ...prev,
          [rootPath]: {
            nodes: merged,
            loaded: true,
            isLoading: false,
            expanded: existing?.expanded ?? true,
            autoExpandedChanges: existing?.autoExpandedChanges ?? false,
          },
        }
      })
    } catch {
      if (seq !== loadSeqRef.current) return
      setRootsState(prev => ({
        ...prev,
        [rootPath]: { ...(prev[rootPath] ?? { nodes: [], loaded: false, expanded: true, autoExpandedChanges: false }), isLoading: false },
      }))
    }
  }, [])

  const actions = useFileTreeActions(loadRoot, onFileDelete, onFileSelect, roots)

  useEffect(() => {
    setRootsState(prev => {
      const next: Record<string, RootState> = {}
      roots.forEach((root, idx) => {
        const existing = prev[root.path]
        next[root.path] = existing ?? {
          nodes: [], loaded: false, isLoading: false,
          expanded: idx === 0 || !showRootHeaders, autoExpandedChanges: false,
        }
      })
      return next
    })
    const primary = roots[0]
    if (primary) {
      loadRoot(primary.path)
    }
  }, [roots, loadRoot, showRootHeaders])

  useEffect(() => {
    const primary = roots[0]
    if (!primary) return
    const state = rootsState[primary.path]
    if (!state?.loaded || state.autoExpandedChanges) return
    if (!dirAggregate || dirAggregate.size === 0) return

    setRootsState(prev => ({
      ...prev,
      [primary.path]: { ...prev[primary.path], autoExpandedChanges: true },
    }))

    const expandDir = async (currentNodes: TreeNode[], currentPath: string, depth: number) => {
      if (depth >= 3) return
      for (const node of currentNodes) {
        if (node.type !== 'directory') continue
        const rel = currentPath ? `${currentPath}/${node.name}` : node.name
        if (!dirAggregate.has(rel)) continue
        if (!node.children) {
          try {
            const children = await fetchEntries(node.path, showIgnoredRef.current)
            setRootsState(prev => ({
              ...prev,
              [primary.path]: {
                ...prev[primary.path],
                nodes: updateNodeChildren(prev[primary.path].nodes, node.path, n => ({
                  ...n, children, isExpanded: true, isLoading: false,
                })),
              },
            }))
            await expandDir(children, rel, depth + 1)
          } catch { /* ignore */ }
        } else if (!node.isExpanded) {
          setRootsState(prev => ({
            ...prev,
            [primary.path]: {
              ...prev[primary.path],
              nodes: updateNodeChildren(prev[primary.path].nodes, node.path, n => ({ ...n, isExpanded: true })),
            },
          }))
          await expandDir(node.children, rel, depth + 1)
        }
      }
    }
    expandDir(state.nodes, '', 0)
  }, [rootsState, dirAggregate, roots])

  const handleToggle = useCallback(async (rootPath: string, dirPath: string) => {
    const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.path === dirPath) return n
        if (n.children) { const found = findNode(n.children); if (found) return found }
      }
      return undefined
    }
    const state = rootsState[rootPath]
    if (!state) return
    const node = findNode(state.nodes)
    if (!node) return

    if (node.isExpanded) {
      setRootsState(prev => ({
        ...prev,
        [rootPath]: { ...prev[rootPath], nodes: updateNodeChildren(prev[rootPath].nodes, dirPath, n => ({ ...n, isExpanded: false })) },
      }))
      return
    }
    if (node.children) {
      setRootsState(prev => ({
        ...prev,
        [rootPath]: { ...prev[rootPath], nodes: updateNodeChildren(prev[rootPath].nodes, dirPath, n => ({ ...n, isExpanded: true })) },
      }))
      return
    }
    setRootsState(prev => ({
      ...prev,
      [rootPath]: { ...prev[rootPath], nodes: updateNodeChildren(prev[rootPath].nodes, dirPath, n => ({ ...n, isLoading: true, isExpanded: true })) },
    }))
    try {
      const children = await fetchEntries(dirPath, showIgnoredRef.current)
      setRootsState(prev => ({
        ...prev,
        [rootPath]: { ...prev[rootPath], nodes: updateNodeChildren(prev[rootPath].nodes, dirPath, n => ({ ...n, children, isLoading: false })) },
      }))
    } catch {
      setRootsState(prev => ({
        ...prev,
        [rootPath]: { ...prev[rootPath], nodes: updateNodeChildren(prev[rootPath].nodes, dirPath, n => ({ ...n, isLoading: false, isExpanded: false })) },
      }))
    }
  }, [rootsState])

  const handleToggleRoot = useCallback((rootPath: string) => {
    const state = rootsState[rootPath]
    if (!state) return
    const nextExpanded = !state.expanded
    setRootsState(prev => ({ ...prev, [rootPath]: { ...prev[rootPath], expanded: nextExpanded } }))
    if (nextExpanded && !state.loaded && !state.isLoading) loadRoot(rootPath)
  }, [rootsState, loadRoot])

  const handleRefresh = useCallback(() => {
    rootsRef.current.forEach(root => {
      const state = rootsState[root.path]
      if (state?.expanded) loadRoot(root.path)
    })
  }, [rootsState, loadRoot])

  const showIgnoredPrevRef = useRef(showIgnored)
  useEffect(() => {
    if (showIgnoredPrevRef.current === showIgnored) return
    showIgnoredPrevRef.current = showIgnored

    const collectExpanded = (nodes: TreeNode[]): string[] => {
      const paths: string[] = []
      for (const n of nodes) {
        if (n.type === 'directory' && n.isExpanded && n.children) {
          paths.push(n.path)
          paths.push(...collectExpanded(n.children))
        }
      }
      return paths
    }

    rootsRef.current.forEach(root => {
      const state = rootsState[root.path]
      if (!state?.loaded) return
      loadRoot(root.path)
      if (!state.expanded) return
      const expandedDirs = collectExpanded(state.nodes)
      for (const dirPath of expandedDirs) {
        fetchEntries(dirPath, showIgnoredRef.current).then(children => {
          setRootsState(prev => {
            const rs = prev[root.path]
            if (!rs) return prev
            return { ...prev, [root.path]: { ...rs, nodes: updateNodeChildren(rs.nodes, dirPath, n => {
              const merged = n.children ? mergeExpandedState(children, n.children) : children
              return { ...n, children: merged }
            }) } }
          })
        }).catch(() => { /* ignore */ })
      }
    })
  }, [showIgnored, rootsState, loadRoot])

  const refreshTriggerRef = useRef(refreshTrigger ?? 0)
  useEffect(() => {
    if (refreshTrigger === undefined || refreshTrigger === refreshTriggerRef.current) return
    refreshTriggerRef.current = refreshTrigger
    const collectExpanded = (nodes: TreeNode[]): string[] => {
      const paths: string[] = []
      for (const n of nodes) {
        if (n.type === 'directory' && n.isExpanded && n.children) {
          paths.push(n.path)
          paths.push(...collectExpanded(n.children))
        }
      }
      return paths
    }
    rootsRef.current.forEach(root => {
      const state = rootsState[root.path]
      if (!state?.expanded || !state.loaded) return
      loadRoot(root.path)
      const expandedDirs = collectExpanded(state.nodes)
      for (const dirPath of expandedDirs) {
        fetchEntries(dirPath, showIgnoredRef.current).then(children => {
          setRootsState(prev => {
            const rs = prev[root.path]
            if (!rs) return prev
            return { ...prev, [root.path]: { ...rs, nodes: updateNodeChildren(rs.nodes, dirPath, n => {
              const merged = n.children ? mergeExpandedState(children, n.children) : children
              return { ...n, children: merged }
            }) } }
          })
        }).catch(() => { /* ignore */ })
      }
    })
  }, [refreshTrigger, rootsState, loadRoot])

  const revealTriggerRef = useRef(revealTrigger ?? 0)
  useEffect(() => {
    if (!revealPath || revealTrigger === undefined || revealTrigger === revealTriggerRef.current) return
    revealTriggerRef.current = revealTrigger

    const root = rootsRef.current.find(r => revealPath.startsWith(r.path + '/'))
    if (!root) return

    const rel = revealPath.slice(root.path.length + 1)
    const segments = rel.split('/')
    segments.pop()
    const dirPaths = segments.filter(Boolean).map((_, i) => root.path + '/' + segments.slice(0, i + 1).join('/'))

    const scrollToEl = (el: Element) => {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }

    const scrollToTarget = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-filepath="${CSS.escape(revealPath)}"]`)
          if (el) {
            scrollToEl(el)
          } else {
            setTimeout(() => {
              const retryEl = document.querySelector(`[data-filepath="${CSS.escape(revealPath)}"]`)
              if (retryEl) scrollToEl(retryEl)
            }, 300)
          }
        })
      })
    }

    const existingEl = document.querySelector(`[data-filepath="${CSS.escape(revealPath)}"]`)
    if (existingEl) {
      scrollToEl(existingEl)
      return
    }

    if (dirPaths.length === 0) {
      scrollToTarget()
      return
    }

    const expandSequentially = async () => {
      for (const dirPath of dirPaths) {
        const needsFetch = await new Promise<'full' | 'refresh' | false>((resolve) => {
          setRootsState(prev => {
            const rs = prev[root.path]
            if (!rs) { resolve(false); return prev }
            const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
              for (const n of nodes) {
                if (n.path === dirPath) return n
                if (n.children) { const found = findNode(n.children); if (found) return found }
              }
              return undefined
            }
            const node = findNode(rs.nodes)
            if (!node) { resolve(false); return prev }
            if (node.isExpanded) {
              const isLastDir = dirPath === dirPaths[dirPaths.length - 1]
              resolve(isLastDir ? 'refresh' : false)
              return prev
            }
            if (node.children) {
              resolve(false)
              return { ...prev, [root.path]: { ...rs, nodes: updateNodeChildren(rs.nodes, dirPath, n => ({ ...n, isExpanded: true })) } }
            }
            resolve('full')
            return { ...prev, [root.path]: { ...rs, nodes: updateNodeChildren(rs.nodes, dirPath, n => ({ ...n, isExpanded: true, isLoading: true })) } }
          })
        })

        if (needsFetch) {
          try {
            const children = await fetchEntries(dirPath, showIgnoredRef.current)
            setRootsState(prev => ({
              ...prev,
              [root.path]: { ...prev[root.path], nodes: updateNodeChildren(prev[root.path].nodes, dirPath, n => ({ ...n, children, isLoading: false })) },
            }))
          } catch {
            if (needsFetch === 'full') {
              setRootsState(prev => ({
                ...prev,
                [root.path]: { ...prev[root.path], nodes: updateNodeChildren(prev[root.path].nodes, dirPath, n => ({ ...n, isExpanded: false, isLoading: false })) },
              }))
              return
            }
          }
        }
      }

      scrollToTarget()
    }

    expandSequentially()
  }, [revealPath, revealTrigger])

  const headerLabel = showRootHeaders
    ? t('fileTree.dirCount', { count: roots.length })
    : (roots[0]?.name || roots[0]?.path.split('/').pop() || '')

  const handleToggleSearch = useCallback(() => {
    setSearchMode(prev => {
      if (!prev) setTimeout(() => searchInputRef.current?.focus(), 0)
      return !prev
    })
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setSearchMode(false)
  }, [])

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    setContextMenu({ x: e.clientX, y: e.clientY, path: node.path, name: node.name, type: node.type })
  }, [])

  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    if (!contextMenu) { setMenuPos(null); return }
    requestAnimationFrame(() => {
      const el = contextMenuRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const left = contextMenu.x + rect.width > vw ? vw - rect.width - 4 : contextMenu.x
      const top = contextMenu.y + rect.height > vh ? vh - rect.height - 4 : contextMenu.y
      setMenuPos({ left: Math.max(4, left), top: Math.max(4, top) })
    })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setContextMenu(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  const ensureDirExpanded = useCallback(async (rootPath: string, dirPath: string) => {
    const state = rootsState[rootPath]
    if (!state) return
    const findNode = (nodes: TreeNode[]): TreeNode | undefined => {
      for (const n of nodes) {
        if (n.path === dirPath) return n
        if (n.children) { const found = findNode(n.children); if (found) return found }
      }
      return undefined
    }
    const node = findNode(state.nodes)
    if (!node || node.type !== 'directory') return
    if (node.isExpanded) return
    await handleToggle(rootPath, dirPath)
  }, [rootsState, handleToggle])

  const handleMenuAction = useCallback(async (action: string) => {
    if (!contextMenu) return
    const { path, name, type } = contextMenu
    const parentDir = type === 'directory' ? path : path.slice(0, path.length - name.length - 1)
    setContextMenu(null)

    switch (action) {
      case 'new-file': {
        if (type === 'directory') {
          const root = roots.find(r => path.startsWith(r.path))
          if (root) await ensureDirExpanded(root.path, path)
        }
        actions.handleNewFile(type === 'directory' ? path : parentDir)
        break
      }
      case 'new-folder': {
        if (type === 'directory') {
          const root = roots.find(r => path.startsWith(r.path))
          if (root) await ensureDirExpanded(root.path, path)
        }
        actions.handleNewFolder(type === 'directory' ? path : parentDir)
        break
      }
      case 'cut':
        actions.handleCut(path, name)
        break
      case 'copy':
        actions.handleCopy(path, name)
        break
      case 'paste':
        await actions.handlePaste(type === 'directory' ? path : parentDir)
        break
      case 'rename':
        actions.handleRename(path, name)
        break
      case 'delete':
        actions.setDeleteConfirm({ path, name })
        break
      case 'reveal':
        await actions.handleReveal(path)
        break
      case 'open-in-browser':
        await actions.handleOpenInBrowser(path)
        break
      case 'add-to-chat': {
        window.dispatchEvent(new CustomEvent('chat:add-files', {
          detail: { files: [{ name, path, type }] },
        }))
        break
      }
    }
  }, [contextMenu, roots, actions, ensureDirExpanded])

  const handleTreeAreaContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const primary = roots[0]
    if (!primary) return
    setContextMenu({ x: e.clientX, y: e.clientY, path: primary.path, name: primary.name, type: 'directory' })
  }, [roots])

  return (
    <div className="h-full flex flex-col text-text-primary bg-bg-primary">
      {searchMode ? (
        <>
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle shrink-0">
            <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider">{t('fileTree.fileSearch')}</span>
            <button
              onClick={handleToggleSearch}
              className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              title={t('fileTree.backToTree')}
            >
              <ArrowLeft size={12} />
            </button>
          </div>
          <div className="shrink-0 px-2 pt-2 pb-1 border-b border-border-subtle">
            <div className="flex items-center gap-1.5 bg-bg-secondary rounded px-2 py-1">
              <Search size={13} className="shrink-0 text-text-muted" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('fileTree.searchPlaceholder')}
                className="flex-1 min-w-0 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
                autoFocus
              />
            </div>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-border-subtle shrink-0">
          <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wider truncate">
            {headerLabel}
          </span>
          <div className="flex items-center gap-0.5">
            {onContentSearch && (
              <button onClick={onContentSearch} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" title={t('fileTree.globalSearch')}>
                <SearchCode size={13} />
              </button>
            )}
            <button onClick={handleToggleSearch} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" title={t('fileTree.searchFiles')}>
              <Search size={12} />
            </button>
            <button
              onClick={() => { setShowIgnored(prev => !prev) }}
              className={cn(
                'p-0.5 rounded hover:bg-bg-hover transition-colors',
                showIgnored ? 'text-accent-brand' : 'text-text-muted hover:text-text-primary',
              )}
              title={showIgnored ? t('fileTree.hideIgnored') : t('fileTree.showIgnored')}
            >
              {showIgnored ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
            <button onClick={handleRefresh} className="p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors" title={t('fileTree.refresh')}>
              <RefreshCcw size={12} />
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1" onContextMenu={!searchMode ? handleTreeAreaContextMenu : undefined}>
        {searchMode ? (
          <FileSearchResults results={searchResults} loading={searchLoading} query={searchQuery} onFileSelect={onFileSelect} rootPath={primaryRoot} multiRoot={showRootHeaders} />
        ) : (<>
        {actions.inlineInput && !showRootHeaders
          && (actions.inlineInput.type === 'new-file' || actions.inlineInput.type === 'new-folder')
          && actions.inlineInput.parentPath === primaryRoot && (
          <div style={{ paddingLeft: '4px' }}>
            <InlineInput
              onSubmit={actions.handleInlineSubmit}
              onCancel={() => actions.setInlineInput(null)}
              icon={actions.inlineInput.type === 'new-folder'
                ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
                : <File size={13} className="shrink-0 text-text-muted" />
              }
            />
          </div>
        )}
        {roots.map((root, idx) => {
          const state = rootsState[root.path]
          const isPrimary = idx === 0
          const rootChangeMap = isPrimary ? changeMap : undefined
          const rootDirAggregate = isPrimary ? dirAggregate : undefined
          const rootAgg = isPrimary ? dirAggregate?.get('') : undefined

          return (
            <div key={root.path} className={cn(showRootHeaders && idx > 0 && 'mt-1')}>
              {showRootHeaders && (
                <button
                  onClick={() => handleToggleRoot(root.path)}
                  className="flex items-center gap-1 w-full text-left py-0.5 px-1 text-xs hover:bg-bg-hover transition-colors rounded-sm"
                >
                  {state?.expanded
                    ? <ChevronDown size={12} className="shrink-0 text-text-muted" />
                    : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
                  {state?.expanded
                    ? <FolderOpen size={13} className="shrink-0 text-accent-brand/70" />
                    : <Folder size={13} className="shrink-0 text-accent-brand/70" />}
                  <span className={cn('truncate font-medium', rootAgg && STATUS_COLOR[rootAgg.dominant])}>
                    {root.name}
                  </span>
                  {rootAgg && (
                    <span className={cn('shrink-0 text-[10px] font-mono leading-none', STATUS_COLOR[rootAgg.dominant])}>
                      {STATUS_LETTER[rootAgg.dominant]}
                    </span>
                  )}
                </button>
              )}
              {state?.expanded && (
                <>
                  {state.isLoading && (
                    <div className="flex items-center justify-center py-2">
                      <Loader2 size={14} className="animate-spin text-text-muted" />
                    </div>
                  )}
                  {!state.isLoading && state.loaded && state.nodes.length === 0 && (
                    <div className="px-2 py-2 text-xs text-text-muted text-center">{t('fileTree.emptyDir')}</div>
                  )}
                  {showRootHeaders && actions.inlineInput
                    && (actions.inlineInput.type === 'new-file' || actions.inlineInput.type === 'new-folder')
                    && actions.inlineInput.parentPath === root.path && (
                    <div style={{ paddingLeft: `${1 * 12 + 4}px` }}>
                      <InlineInput
                        onSubmit={actions.handleInlineSubmit}
                        onCancel={() => actions.setInlineInput(null)}
                        icon={actions.inlineInput.type === 'new-folder'
                          ? <Folder size={13} className="shrink-0 text-accent-brand/70" />
                          : <File size={13} className="shrink-0 text-text-muted" />
                        }
                      />
                    </div>
                  )}
                  {state.nodes.map(node => (
                    <TreeNodeItem
                      key={node.path}
                      node={node}
                      depth={showRootHeaders ? 1 : 0}
                      selectedFile={selectedFile}
                      onFileSelect={onFileSelect}
                      onToggle={(p) => handleToggle(root.path, p)}
                      changeMap={rootChangeMap}
                      dirAggregate={rootDirAggregate}
                      relativePath={node.name}
                      onContextMenu={handleNodeContextMenu}
                      inlineInput={actions.inlineInput}
                      onInlineSubmit={actions.handleInlineSubmit}
                      onInlineCancel={() => actions.setInlineInput(null)}
                    />
                  ))}
                  {rootChangeMap && getDeletedChildren(rootChangeMap, '', state.nodes, root.path).map(vNode => (
                    <TreeNodeItem
                      key={`deleted:${vNode.path}`}
                      node={vNode}
                      depth={showRootHeaders ? 1 : 0}
                      selectedFile={selectedFile}
                      onFileSelect={onFileSelect}
                      onToggle={(p) => handleToggle(root.path, p)}
                      changeMap={rootChangeMap}
                      dirAggregate={rootDirAggregate}
                      relativePath={vNode.name}
                      onContextMenu={handleNodeContextMenu}
                      inlineInput={actions.inlineInput}
                      onInlineSubmit={actions.handleInlineSubmit}
                      onInlineCancel={() => actions.setInlineInput(null)}
                    />
                  ))}
                </>
              )}
            </div>
          )
        })}
        </>)}
      </div>

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-bg-secondary border border-border-subtle rounded shadow-lg py-0.5 min-w-[120px]"
          style={{
            left: menuPos?.left ?? contextMenu.x,
            top: menuPos?.top ?? contextMenu.y,
            visibility: menuPos ? 'visible' : 'hidden',
          }}
        >
          <MenuItem icon={<FilePlus size={10} />} label={t('fileTree.newFile')} onClick={() => handleMenuAction('new-file')} />
          <MenuItem icon={<FolderPlus size={10} />} label={t('fileTree.newFolder')} onClick={() => handleMenuAction('new-folder')} />
          <MenuDivider />
          <MenuItem icon={<Scissors size={10} />} label={t('fileTree.cut')} onClick={() => handleMenuAction('cut')} />
          <MenuItem icon={<Copy size={10} />} label={t('fileTree.copy')} onClick={() => handleMenuAction('copy')} />
          <MenuItem icon={<ClipboardPaste size={10} />} label={t('fileTree.paste')} onClick={() => handleMenuAction('paste')} disabled={!actions.clipboard} />
          <MenuDivider />
          <MenuItem icon={<Pencil size={10} />} label={t('fileTree.rename')} onClick={() => handleMenuAction('rename')} />
          <MenuItem icon={<Trash2 size={10} />} label={t('fileTree.delete')} onClick={() => handleMenuAction('delete')} danger />
          <MenuDivider />
          <MenuItem icon={<MessageSquarePlus size={10} />} label={t('fileTree.addToChat')} onClick={() => handleMenuAction('add-to-chat')} />
          <MenuDivider />
          {contextMenu.type === 'file' && /\.html?$/i.test(contextMenu.name) && (
            <MenuItem icon={<Globe size={10} />} label={t('fileTree.openInBrowser')} onClick={() => handleMenuAction('open-in-browser')} />
          )}
          <MenuItem icon={<ExternalLink size={10} />} label={t('fileTree.revealInFinder')} onClick={() => handleMenuAction('reveal')} />
        </div>
      )}

      {/* DeleteConfirmDialog */}
      {actions.deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !actions.deleting && actions.setDeleteConfirm(null)}>
          <div className="bg-bg-secondary border border-border-subtle rounded-lg p-4 max-w-sm mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-sm text-text-primary mb-3">
              {t('fileTree.deleteConfirm', { name: actions.deleteConfirm.name }).split(actions.deleteConfirm.name).map((part, i, arr) =>
                i < arr.length - 1 ? <span key={i}>{part}<span className="font-mono font-medium text-red-400">{actions.deleteConfirm!.name}</span></span> : <span key={i}>{part}</span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                className="px-3 py-1.5 text-xs text-text-secondary bg-bg-hover rounded hover:bg-bg-primary transition-colors"
                onClick={() => actions.setDeleteConfirm(null)}
                disabled={actions.deleting}
              >
                {t('commitPanel.cancel')}
              </button>
              <button
                className="px-3 py-1.5 text-xs text-white bg-red-600 rounded hover:bg-red-700 transition-colors flex items-center gap-1"
                onClick={actions.handleDelete}
                disabled={actions.deleting}
              >
                {actions.deleting && <Loader2 size={10} className="animate-spin" />}
                {t('fileTree.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileTree
