
import { Router } from 'express'
import { resolve, dirname, join, basename } from 'path'
import { existsSync, readFileSync, statSync, writeFileSync, unlinkSync, rmSync, renameSync, copyFileSync, mkdirSync, readdirSync } from 'fs'
import { execFile } from 'child_process'
import { getGitWatchManager } from '../../git/GitWatchManager'

const router = Router()

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
])

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/**
 * GET /api/file?path=<absolute_path>
 */
router.get('/api/file', (req, res) => {
  const filePath = req.query.path as string
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' })
  }

  if (filePath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }

  const resolved = resolve(filePath)
  if (resolved !== filePath) {
    return res.status(403).json({ error: 'Path must be absolute and normalized' })
  }

  const dotIdx = resolved.lastIndexOf('.')
  const ext = dotIdx >= 0 ? resolved.slice(dotIdx).toLowerCase() : ''
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return res.status(403).json({ error: 'Only image files are allowed' })
  }

  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' })
  }

  const contentType = MIME_MAP[ext] || 'application/octet-stream'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.sendFile(resolved)
})

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

const isBinaryBuffer = (buf: Buffer): boolean => {
  const checkLen = Math.min(buf.length, 512)
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

router.get('/api/file-content', (req, res) => {
  const filePath = req.query.path as string
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' })
  }
  if (filePath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolved = resolve(filePath)
  if (resolved !== filePath) {
    return res.status(403).json({ error: 'Path must be absolute and normalized' })
  }
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    const st = statSync(resolved)
    if (!st.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' })
    }
    if (st.size > MAX_FILE_SIZE) {
      return res.status(400).json({ error: 'file_too_large', size: st.size })
    }
    const buf = readFileSync(resolved)
    if (isBinaryBuffer(buf)) {
      return res.status(400).json({ error: 'binary_file' })
    }
    res.json({ content: buf.toString('utf-8'), size: st.size, encoding: 'utf-8' })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot read file' })
  }
})

router.post('/api/file-content', (req, res) => {
  const { path: filePath, content } = req.body as { path?: string; content?: string }
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' })
  }
  if (filePath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolved = resolve(filePath)
  if (resolved !== filePath) {
    return res.status(403).json({ error: 'Path must be absolute and normalized' })
  }
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    const st = statSync(resolved)
    if (!st.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' })
    }
    writeFileSync(resolved, content, 'utf-8')
    getGitWatchManager()?.notifyChangeForFile(resolved)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot write file' })
  }
})

// ── WebIDE: File/DirectoryDelete ──

router.delete('/api/file-content', (req, res) => {
  const filePath = req.query.path as string
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path query parameter is required' })
  }
  if (filePath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolved = resolve(filePath)
  if (resolved !== filePath) {
    return res.status(403).json({ error: 'Path must be absolute and normalized' })
  }
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'File not found' })
  }

  try {
    const st = statSync(resolved)
    if (st.isDirectory()) {
      rmSync(resolved, { recursive: true })
    } else {
      unlinkSync(resolved)
    }
    getGitWatchManager()?.notifyChangeForFile(resolved)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot delete' })
  }
})

// ── WebIDE: NewFile ──

router.post('/api/file-create', (req, res) => {
  const { path: filePath } = req.body as { path?: string }
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  if (filePath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolved = resolve(filePath)
  if (resolved !== filePath) {
    return res.status(403).json({ error: 'Path must be absolute and normalized' })
  }
  if (existsSync(resolved)) {
    return res.status(409).json({ error: 'File already exists' })
  }

  try {
    const dir = dirname(resolved)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(resolved, '', 'utf-8')
    getGitWatchManager()?.notifyChangeForFile(resolved)
    res.json({ ok: true, path: resolved })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot create file' })
  }
})

router.post('/api/file-rename', (req, res) => {
  const { oldPath, newPath } = req.body as { oldPath?: string; newPath?: string }
  if (!oldPath || !newPath) {
    return res.status(400).json({ error: 'oldPath and newPath are required' })
  }
  if (oldPath.includes('..') || newPath.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolvedOld = resolve(oldPath)
  const resolvedNew = resolve(newPath)
  if (resolvedOld !== oldPath || resolvedNew !== newPath) {
    return res.status(403).json({ error: 'Paths must be absolute and normalized' })
  }
  if (!existsSync(resolvedOld)) {
    return res.status(404).json({ error: 'Source not found' })
  }
  if (existsSync(resolvedNew)) {
    return res.status(409).json({ error: 'Target already exists' })
  }

  try {
    const dir = dirname(resolvedNew)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    renameSync(resolvedOld, resolvedNew)
    getGitWatchManager()?.notifyChangeForFile(resolvedOld)
    getGitWatchManager()?.notifyChangeForFile(resolvedNew)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot rename' })
  }
})

const copyDirRecursive = (src: string, dest: string) => {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

router.post('/api/file-paste', (req, res) => {
  const { sourcePath, targetDir, cut } = req.body as { sourcePath?: string; targetDir?: string; cut?: boolean }
  if (!sourcePath || !targetDir) {
    return res.status(400).json({ error: 'sourcePath and targetDir are required' })
  }
  if (sourcePath.includes('..') || targetDir.includes('..')) {
    return res.status(403).json({ error: 'Path traversal is not allowed' })
  }
  const resolvedSource = resolve(sourcePath)
  const resolvedTarget = resolve(targetDir)
  if (resolvedSource !== sourcePath || resolvedTarget !== targetDir) {
    return res.status(403).json({ error: 'Paths must be absolute and normalized' })
  }
  if (!existsSync(resolvedSource)) {
    return res.status(404).json({ error: 'Source not found' })
  }

  try {
    const name = basename(resolvedSource)
    let destPath = join(resolvedTarget, name)

    if (existsSync(destPath) && !cut) {
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
      const base = ext ? name.slice(0, -ext.length) : name
      let i = 1
      do {
        destPath = join(resolvedTarget, `${base} copy${i > 1 ? ` ${i}` : ''}${ext}`)
        i++
      } while (existsSync(destPath))
    }

    if (cut) {
      renameSync(resolvedSource, destPath)
      getGitWatchManager()?.notifyChangeForFile(resolvedSource)
    } else {
      const st = statSync(resolvedSource)
      if (st.isDirectory()) {
        copyDirRecursive(resolvedSource, destPath)
      } else {
        copyFileSync(resolvedSource, destPath)
      }
    }
    getGitWatchManager()?.notifyChangeForFile(destPath)
    res.json({ ok: true, path: destPath })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Cannot paste' })
  }
})

router.post('/api/reveal-in-finder', (req, res) => {
  const { path: filePath } = req.body as { path?: string }
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  const resolved = resolve(filePath)
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'Path not found' })
  }

  execFile('open', ['-R', resolved], { timeout: 5000 }, (err) => {
    if (err) return res.status(500).json({ error: 'Cannot reveal in Finder' })
    res.json({ ok: true })
  })
})

router.post('/api/open-in-browser', (req, res) => {
  const { path: filePath } = req.body as { path?: string }
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  const resolved = resolve(filePath)
  if (!existsSync(resolved)) {
    return res.status(404).json({ error: 'Path not found' })
  }

  const url = `file://${resolved}`
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]

  execFile(cmd, args, { timeout: 5000 }, (err) => {
    if (err) return res.status(500).json({ error: 'Cannot open in browser' })
    res.json({ ok: true })
  })
})

export default router
