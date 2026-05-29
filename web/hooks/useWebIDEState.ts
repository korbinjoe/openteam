import { useState, useCallback, useRef } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getLanguage, getPreviewType } from '@/components/ide/utils'
import type { PreviewType } from '@/components/ide/utils'

export interface EditorTab {
  path: string
  name: string
  content: string
  originalContent: string
  language: string
  isDirty: boolean
  isLoading: boolean
  previewType: PreviewType
}

export const useWebIDEState = (worktreePath?: string) => {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const [pendingLine, setPendingLine] = useState<number | null>(null)
  const [pendingKeyword, setPendingKeyword] = useState<string | null>(null)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  const clearPendingLine = useCallback(() => {
    setPendingLine(null)
    setPendingKeyword(null)
  }, [])

  const openFile = useCallback(async (filePath: string, line?: number, keyword?: string) => {
    setPendingLine(line ?? null)
    setPendingKeyword(keyword ?? null)
    if (tabsRef.current.some(t => t.path === filePath)) {
      setActiveTabPath(filePath)
      return
    }

    const name = filePath.split('/').pop() || filePath
    const language = getLanguage(filePath)
    const previewType = getPreviewType(filePath)

    if (previewType === 'image') {
      const tab: EditorTab = {
        path: filePath, name, content: '', originalContent: '',
        language, isDirty: false, isLoading: false, previewType,
      }
      setTabs(prev => {
        if (prev.some(t => t.path === filePath)) return prev
        return [...prev, tab]
      })
      setActiveTabPath(filePath)
      return
    }

    const placeholder: EditorTab = {
      path: filePath, name, content: '', originalContent: '',
      language, isDirty: false, isLoading: true, previewType,
    }
    setTabs(prev => {
      if (prev.some(t => t.path === filePath)) return prev
      return [...prev, placeholder]
    })
    setActiveTabPath(filePath)

    try {
      const res = await authFetch(`${API_BASE}/api/file-content?path=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (data.error) {
        const isBinary = data.error === 'binary_file'
        setTabs(prev => prev.map(t =>
          t.path === filePath
            ? { ...t, content: isBinary ? '' : `// Error: ${data.error}`, isLoading: false, previewType: isBinary ? 'binary' as PreviewType : t.previewType }
            : t
        ))
        return
      }
      setTabs(prev => prev.map(t =>
        t.path === filePath ? { ...t, content: data.content, originalContent: data.content, isLoading: false } : t
      ))
    } catch {
      setTabs(prev => prev.map(t =>
        t.path === filePath ? { ...t, content: '// Failed to load file', isLoading: false } : t
      ))
    }
  }, [])

  const closeTab = useCallback((filePath: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.path === filePath)
      const next = prev.filter(t => t.path !== filePath)
      if (activeTabPath === filePath) {
        const newIdx = Math.min(idx, next.length - 1)
        setActiveTabPath(next[newIdx]?.path ?? null)
      }
      return next
    })
  }, [activeTabPath])

  const updateContent = useCallback((filePath: string, content: string) => {
    setTabs(prev => prev.map(t =>
      t.path === filePath ? { ...t, content, isDirty: content !== t.originalContent } : t
    ))
  }, [])

  const saveFile = useCallback(async (filePath: string, content: string) => {
    const relPath = worktreePath && filePath.startsWith(worktreePath)
      ? filePath.slice(worktreePath.length).replace(/^\//, '')
      : undefined

    const endpoint = relPath
      ? `${API_BASE}/api/worktree/save-file`
      : `${API_BASE}/api/file-content`

    const body = relPath
      ? { worktreePath, filePath: relPath, content }
      : { path: filePath, content }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      setTabs(prev => prev.map(t =>
        t.path === filePath ? { ...t, isDirty: false, originalContent: content } : t
      ))
    }
  }, [worktreePath])

  const pruneDeletedTabs = useCallback(async () => {
    const current = tabsRef.current
    if (current.length === 0) return
    const results = await Promise.all(
      current.map(async (t) => {
        try {
          const res = await fetch(`${API_BASE}/api/file-content?path=${encodeURIComponent(t.path)}`, { method: 'HEAD' })
          return { path: t.path, exists: res.ok }
        } catch {
          return { path: t.path, exists: true }
        }
      })
    )
    const deleted = results.filter(r => !r.exists).map(r => r.path)
    if (deleted.length === 0) return
    setTabs(prev => {
      const next = prev.filter(t => !deleted.includes(t.path))
      if (activeTabPath && deleted.includes(activeTabPath)) {
        const idx = prev.findIndex(t => t.path === activeTabPath)
        const newIdx = Math.min(idx, next.length - 1)
        setActiveTabPath(next[newIdx]?.path ?? null)
      }
      return next
    })
  }, [activeTabPath])

  const refreshOpenTabs = useCallback(async () => {
    const current = tabsRef.current
    if (current.length === 0) return
    const nonDirtyTabs = current.filter(t => !t.isDirty && t.previewType !== 'image' && t.previewType !== 'binary')
    if (nonDirtyTabs.length === 0) return

    await Promise.all(
      nonDirtyTabs.map(async (tab) => {
        try {
          const res = await fetch(`${API_BASE}/api/file-content?path=${encodeURIComponent(tab.path)}`)
          const data = await res.json()
          if (data.error || typeof data.content !== 'string') return
          if (data.content === tab.content) return
          setTabs(prev => prev.map(t =>
            t.path === tab.path && !t.isDirty
              ? { ...t, content: data.content, originalContent: data.content }
              : t
          ))
        } catch {}
      })
    )
  }, [])

  const refreshTab = useCallback(async (filePath: string) => {
    const tab = tabsRef.current.find(t => t.path === filePath)
    if (!tab || tab.isDirty || tab.previewType === 'image' || tab.previewType === 'binary') return
    try {
      const res = await fetch(`${API_BASE}/api/file-content?path=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      if (data.error || typeof data.content !== 'string') return
      if (data.content === tab.content) return
      setTabs(prev => prev.map(t =>
        t.path === filePath && !t.isDirty
          ? { ...t, content: data.content, originalContent: data.content }
          : t
      ))
    } catch { /* ignore */ }
  }, [])

  return { tabs, activeTabPath, setActiveTabPath, openFile, closeTab, updateContent, saveFile, pendingLine, pendingKeyword, clearPendingLine, pruneDeletedTabs, refreshOpenTabs, refreshTab }
}
