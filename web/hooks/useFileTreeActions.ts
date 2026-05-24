import { useState, useCallback, useRef } from 'react'
import { API_BASE } from '@/config/api'

export interface ClipboardState {
  path: string
  name: string
  cut: boolean
}

export interface InlineInputState {
  parentPath: string
  type: 'new-file' | 'new-folder' | 'rename'
  originalName?: string
  originalPath?: string
}

// ── API helpers ──

export const deleteEntry = async (entryPath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/file-content?path=${encodeURIComponent(entryPath)}`, { method: 'DELETE' })
  return res.ok
}

export const createFile = async (filePath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/file-create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  })
  return res.ok
}

export const createFolder = async (dirPath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/mkdir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: dirPath }),
  })
  return res.ok
}

export const renameEntry = async (oldPath: string, newPath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/file-rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath, newPath }),
  })
  return res.ok
}

export const pasteEntry = async (sourcePath: string, targetDir: string, cut: boolean): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/file-paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourcePath, targetDir, cut }),
  })
  return res.ok
}

export const revealInFinder = async (filePath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/reveal-in-finder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  })
  return res.ok
}

export const openInBrowser = async (filePath: string): Promise<boolean> => {
  const res = await fetch(`${API_BASE}/api/open-in-browser`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  })
  return res.ok
}

// ── Hook ──

export const useFileTreeActions = (
  onRefreshRoot: (rootPath: string) => void,
  onFileDelete?: (filePath: string) => void,
  onFileSelect?: (filePath: string) => void,
  roots?: Array<{ path: string }>,
) => {
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const rootsRef = useRef(roots)
  rootsRef.current = roots

  const refreshForPath = useCallback((filePath: string) => {
    rootsRef.current?.forEach(root => {
      if (filePath.startsWith(root.path)) {
        onRefreshRoot(root.path)
      }
    })
  }, [onRefreshRoot])

  const handleCopy = useCallback((path: string, name: string) => {
    setClipboard({ path, name, cut: false })
  }, [])

  const handleCut = useCallback((path: string, name: string) => {
    setClipboard({ path, name, cut: true })
  }, [])

  const handlePaste = useCallback(async (targetDir: string) => {
    if (!clipboard) return
    const ok = await pasteEntry(clipboard.path, targetDir, clipboard.cut)
    if (ok) {
      if (clipboard.cut) refreshForPath(clipboard.path)
      refreshForPath(targetDir)
      setClipboard(null)
    }
  }, [clipboard, refreshForPath])

  const handleDelete = useCallback(async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    const ok = await deleteEntry(deleteConfirm.path)
    setDeleting(false)
    if (ok) {
      onFileDelete?.(deleteConfirm.path)
      refreshForPath(deleteConfirm.path)
    }
    setDeleteConfirm(null)
  }, [deleteConfirm, refreshForPath, onFileDelete])

  const handleNewFile = useCallback((parentDir: string) => {
    setInlineInput({ parentPath: parentDir, type: 'new-file' })
  }, [])

  const handleNewFolder = useCallback((parentDir: string) => {
    setInlineInput({ parentPath: parentDir, type: 'new-folder' })
  }, [])

  const handleRename = useCallback((path: string, name: string) => {
    const parentPath = path.slice(0, path.length - name.length - 1)
    setInlineInput({ parentPath, type: 'rename', originalName: name, originalPath: path })
  }, [])

  const handleInlineSubmit = useCallback(async (value: string) => {
    if (!inlineInput || !value.trim()) {
      setInlineInput(null)
      return
    }
    const name = value.trim()
    const fullPath = `${inlineInput.parentPath}/${name}`

    let ok = false
    if (inlineInput.type === 'new-file') {
      ok = await createFile(fullPath)
      if (ok) onFileSelect?.(fullPath)
    } else if (inlineInput.type === 'new-folder') {
      ok = await createFolder(fullPath)
    } else if (inlineInput.type === 'rename' && inlineInput.originalPath) {
      ok = await renameEntry(inlineInput.originalPath, fullPath)
    }

    if (ok) refreshForPath(inlineInput.parentPath)
    setInlineInput(null)
  }, [inlineInput, refreshForPath, onFileSelect])

  const handleReveal = useCallback(async (path: string) => {
    await revealInFinder(path)
  }, [])

  const handleOpenInBrowser = useCallback(async (path: string) => {
    await openInBrowser(path)
  }, [])

  return {
    clipboard,
    inlineInput,
    deleteConfirm,
    deleting,
    setDeleteConfirm,
    handleCopy,
    handleCut,
    handlePaste,
    handleDelete,
    handleNewFile,
    handleNewFolder,
    handleRename,
    handleInlineSubmit,
    handleReveal,
    handleOpenInBrowser,
    setInlineInput,
  }
}
