import { Router } from 'express'
import type { WhiteboardManager } from '../../whiteboard/WhiteboardManager'
import { WhiteboardValidationError } from '../../whiteboard/WhiteboardManager'
import type { ChatStore } from '../../stores/ChatStore'
import type {
  WhiteboardEntryInput,
  WhiteboardEntryRefs,
  WhiteboardQueryOptions,
  WhiteboardEntryType,
  WhiteboardEntryStatus,
} from '../../../shared/whiteboard-types'
import { WHITEBOARD_SUMMARY_MAX } from '../../../shared/whiteboard-types'
import { join } from 'path'
import { WHITEBOARD_ROOT } from '../../config/paths'
import { createLogger } from '../../lib/logger'

const log = createLogger('WhiteboardRoutes')

interface WhiteboardRouteDeps {
  whiteboardManager: WhiteboardManager
  chatStore: ChatStore
  broadcastToChat?: (chatId: string, msg: Record<string, unknown>) => void
}

const VALID_TYPES: WhiteboardEntryType[] = [
  'goal', 'decision', 'artifact', 'progress', 'open_question', 'constraint', 'handoff',
]
const VALID_STATUS: WhiteboardEntryStatus[] = ['active', 'archived', 'superseded']

const REFS_ARRAY_KEYS = ['files', 'entries', 'artifacts'] as const
const parseRefs = (raw: unknown): WhiteboardEntryRefs | undefined => {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('refs must be an object')
  }
  const input = raw as Record<string, unknown>
  const out: WhiteboardEntryRefs = {}
  for (const key of REFS_ARRAY_KEYS) {
    const val = input[key]
    if (val === undefined) continue
    if (!Array.isArray(val)) throw new Error(`refs.${key} must be a string array`)
    const arr = val.map((v, i) => {
      if (typeof v !== 'string') throw new Error(`refs.${key}[${i}] must be a string`)
      return v
    })
    if (arr.length > 0) out[key] = arr
  }
  if (input.mailbox !== undefined) {
    if (typeof input.mailbox !== 'string') throw new Error('refs.mailbox must be a string')
    out.mailbox = input.mailbox
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const parseEntryInput = (body: Record<string, unknown>): WhiteboardEntryInput => {
  const type = String(body.type ?? '') as WhiteboardEntryType
  if (!VALID_TYPES.includes(type)) throw new Error(`invalid type: ${type}`)
  const by = String(body.by ?? '').trim()
  if (!by) throw new Error('missing by (agent id)')
  const summary = String(body.summary ?? '').trim()
  if (!summary) throw new Error('missing summary')
  if (summary.length > WHITEBOARD_SUMMARY_MAX) {
    throw new Error(`summary too long (${summary.length} > ${WHITEBOARD_SUMMARY_MAX})`)
  }
  const status = body.status === undefined ? undefined : String(body.status)
  if (status !== undefined && !VALID_STATUS.includes(status as WhiteboardEntryStatus)) {
    throw new Error(`invalid status: ${status}`)
  }
  return {
    type,
    by,
    summary,
    refs: parseRefs(body.refs),
    tags: Array.isArray(body.tags)
      ? (body.tags as unknown[]).map((t, i) => {
          if (typeof t !== 'string') throw new Error(`tags[${i}] must be a string`)
          return t
        })
      : undefined,
    status: status as WhiteboardEntryStatus | undefined,
  }
}

export const createWhiteboardRoutes = (deps: WhiteboardRouteDeps): Router => {
  const { whiteboardManager: wb, chatStore, broadcastToChat } = deps
  const router = Router()

  router.post('/api/chats/:chatId/whiteboard/entries', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    let input: WhiteboardEntryInput
    try {
      input = parseEntryInput(req.body ?? {})
    } catch (e) {
      return res.status(400).json({ error: 'invalid_input', message: e instanceof Error ? e.message : String(e) })
    }
    try {
      const entry = wb.appendEntry(chatId, input)
      void persistChatMeta(chatId, entry)
      broadcastToChat?.(chatId, { type: 'whiteboard:entry-added', payload: { chatId, entry } })
      return res.status(201).json({ entry })
    } catch (e) {
      if (e instanceof WhiteboardValidationError) {
        if (e.code === 'whiteboard.goal_already_exists' && input.type === 'goal') {
          const existing = wb.query(chatId, { types: ['goal'], status: 'active' })[0]
          if (existing) {
            try {
              const entry = wb.supersede(chatId, existing.id, input)
              void persistChatMeta(chatId, entry)
              broadcastToChat?.(chatId, { type: 'whiteboard:entry-added', payload: { chatId, entry, supersededId: existing.id } })
              return res.status(201).json({ entry, superseded: existing.id })
            } catch (e2) {
              log.error('Auto-supersede goal failed', { chatId, existingId: existing.id, error: e2 instanceof Error ? e2.message : String(e2) })
            }
          }
        }
        return res.status(422).json({ error: e.code, message: e.message })
      }
      log.error('appendEntry failed', { chatId, error: e instanceof Error ? e.message : String(e) })
      return res.status(500).json({ error: 'internal_error' })
    }
  })

  /**  snapshot cold start / Briefing  Manager  */
  router.get('/api/chats/:chatId/whiteboard/snapshot', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const instanceId = typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : ''
    const snap = wb.getSnapshot(chatId)
    if (instanceId) {
      try {
        wb.setCursor(chatId, instanceId, wb.getLatestSeq(chatId))
      } catch (e) {
        log.warn('snapshot setCursor failed', { chatId, instanceId, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return res.json(snap)
  })

  /**
   *  diffPostToolUse hook agent
   *   GET /api/chats/:chatId/whiteboard/diff?since=<seq>&instanceId=<id>
   *   -  seq > since  latestSeq
   *   - instanceId  cursor = latestSeq
   *   - since  →  0fallback
   */
  router.get('/api/chats/:chatId/whiteboard/diff', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const sinceRaw = typeof req.query.since === 'string' ? Number(req.query.since) : 0
    const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0
    const instanceId = typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : ''

    const entries = wb.getDiff(chatId, since)
    const latestSeq = wb.getLatestSeq(chatId)

    if (instanceId) {
      try {
        wb.setCursor(chatId, instanceId, latestSeq)
      } catch (e) {
        log.warn('diff setCursor failed', { chatId, instanceId, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return res.json({ entries, latestSeq, since })
  })

  /**
   *  /  cursoragent
   *   GET  /api/chats/:chatId/whiteboard/cursor?instanceId=<id>
   *   POST /api/chats/:chatId/whiteboard/cursor  body: { instanceId, seq? }
   */
  router.get('/api/chats/:chatId/whiteboard/cursor', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const instanceId = typeof req.query.instanceId === 'string' ? req.query.instanceId.trim() : ''
    if (!instanceId) return res.status(400).json({ error: 'missing_instance_id' })
    const rec = wb.getCursor(chatId, instanceId)
    return res.json({ cursor: rec, latestSeq: wb.getLatestSeq(chatId) })
  })

  router.post('/api/chats/:chatId/whiteboard/cursor', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const body = (req.body ?? {}) as { instanceId?: unknown; seq?: unknown }
    const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : ''
    if (!instanceId) return res.status(400).json({ error: 'missing_instance_id' })
    const seqRaw = body.seq
    const seq =
      seqRaw === undefined || seqRaw === null
        ? undefined
        : typeof seqRaw === 'number' && Number.isFinite(seqRaw) && seqRaw >= 0
          ? seqRaw
          : null
    if (seq === null) return res.status(400).json({ error: 'invalid_seq' })
    try {
      const rec = wb.setCursor(chatId, instanceId, seq)
      return res.json({ cursor: rec, latestSeq: wb.getLatestSeq(chatId) })
    } catch (e) {
      log.warn('cursor setCursor failed', { chatId, instanceId, error: e instanceof Error ? e.message : String(e) })
      return res.status(500).json({ error: 'internal_error' })
    }
  })

  /**  type / by / tags / sinceTs / limit / status  */
  router.get('/api/chats/:chatId/whiteboard/entries', (req, res) => {
    const { chatId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const opts: WhiteboardQueryOptions = {}
    const q = req.query
    if (typeof q.types === 'string') {
      opts.types = q.types.split(',')
        .map((s) => s.trim() as WhiteboardEntryType)
        .filter((t) => VALID_TYPES.includes(t))
    }
    if (typeof q.byAgent === 'string') opts.byAgent = q.byAgent
    if (typeof q.tags === 'string') opts.tags = q.tags.split(',').map((s) => s.trim()).filter(Boolean)
    if (typeof q.sinceTs === 'string') opts.sinceTs = q.sinceTs
    if (typeof q.status === 'string' && VALID_STATUS.includes(q.status as WhiteboardEntryStatus)) {
      opts.status = q.status as WhiteboardEntryStatus
    }
    if (typeof q.limit === 'string') {
      const n = Number(q.limit)
      if (Number.isFinite(n) && n > 0) opts.limit = Math.min(n, 200)
    }
    return res.json({ entries: wb.query(chatId, opts) })
  })

  router.post('/api/chats/:chatId/whiteboard/entries/:entryId/supersede', (req, res) => {
    const { chatId, entryId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    let input: WhiteboardEntryInput
    try {
      input = parseEntryInput(req.body ?? {})
    } catch (e) {
      return res.status(400).json({ error: 'invalid_input', message: e instanceof Error ? e.message : String(e) })
    }
    try {
      const entry = wb.supersede(chatId, entryId, input)
      void persistChatMeta(chatId, entry)
      broadcastToChat?.(chatId, { type: 'whiteboard:entry-added', payload: { chatId, entry, supersededId: entryId } })
      return res.json({ entry })
    } catch (e) {
      if (e instanceof WhiteboardValidationError) {
        const status = e.code === 'whiteboard.entry_not_found' ? 404 : 422
        return res.status(status).json({ error: e.code, message: e.message })
      }
      log.error('supersede failed', { chatId, entryId, error: e instanceof Error ? e.message : String(e) })
      return res.status(500).json({ error: 'internal_error' })
    }
  })

  router.post('/api/chats/:chatId/whiteboard/entries/:entryId/archive', (req, res) => {
    const { chatId, entryId } = req.params
    if (!chatStore.get(chatId)) {
      return res.status(404).json({ error: 'chat_not_found' })
    }
    const by = String((req.body as { by?: unknown })?.by ?? '').trim()
    if (!by) return res.status(400).json({ error: 'missing_by' })
    try {
      wb.archive(chatId, entryId, by)
      const snap = wb.getSnapshot(chatId)
      broadcastToChat?.(chatId, { type: 'whiteboard:entry-archived', payload: { chatId, entryId, archivedCount: snap.archivedCount } })
      return res.json({ ok: true })
    } catch (e) {
      if (e instanceof WhiteboardValidationError) {
        return res.status(404).json({ error: e.code, message: e.message })
      }
      return res.status(500).json({ error: 'internal_error' })
    }
  })

  /** chat  whiteboard_path / whiteboard_goal PR1 v16  */
  const persistChatMeta = async (chatId: string, latestEntry: { type: WhiteboardEntryType; summary: string }) => {
    try {
      const updates: Record<string, unknown> = {
        whiteboardPath: join(WHITEBOARD_ROOT, chatId, 'entries.jsonl'),
      }
      if (latestEntry.type === 'goal') {
        updates.whiteboardGoal = latestEntry.summary
      }
      await chatStore.update(chatId, updates as Parameters<typeof chatStore.update>[1])
    } catch (e) {
      log.warn('Failed to persist chat whiteboard meta', { chatId, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return router
}
