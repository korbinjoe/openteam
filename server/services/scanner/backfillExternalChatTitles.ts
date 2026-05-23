/**
 * One-shot startup backfill that updates `chats.title` for adopted external
 * sessions whose title was set before the parser could resolve the real first
 * user message. Without this, those chats stay frozen on the
 * "<cwd-basename>/<8-char-id>" fallback title forever.
 *
 * Only touches chats whose current title still matches the fallback pattern —
 * if the user renamed it, we leave it alone.
 */

import { basename } from 'path'
import { getDatabase } from '../../stores/Database'
import { createLogger } from '../../lib/logger'

const log = createLogger('backfillExtTitle')

const FIRST_USER_CAP = 200
const TITLE_CAP = 80

const truncateTitle = (s: string, max: number = TITLE_CAP): string => {
  const single = s.replace(/\s+/g, ' ').trim()
  return single.length > max ? single.slice(0, max - 1) + '…' : single
}

const isFallbackTitle = (title: string, cwd: string, sessionId: string): boolean => {
  const expected = `${basename(cwd)}/${sessionId.slice(0, 8)}`
  return title === expected || title.startsWith(expected)
}

export const backfillExternalChatTitles = async (): Promise<number> => {
  const db = getDatabase()

  // Rows we *could* fix: have a resolved first_user_message AND an adopted chat.
  const rows = db
    .prepare(
      `SELECT esi.adopted_chat_id AS chatId,
              esi.first_user_message AS firstUser,
              esi.cwd AS cwd,
              esi.session_id AS sessionId,
              c.title AS title
       FROM external_session_index esi
       JOIN chats c ON c.id = esi.adopted_chat_id
       WHERE esi.adopted_chat_id IS NOT NULL
         AND esi.first_user_message IS NOT NULL
         AND length(esi.first_user_message) > 0`,
    )
    .all() as Array<{
    chatId: string
    firstUser: string
    cwd: string
    sessionId: string
    title: string
  }>

  if (rows.length === 0) return 0

  const update = db.prepare('UPDATE chats SET title = ? WHERE id = ?')
  let fixed = 0
  for (const r of rows) {
    if (!isFallbackTitle(r.title, r.cwd, r.sessionId)) continue
    const next = truncateTitle(r.firstUser.length > FIRST_USER_CAP
      ? r.firstUser.slice(0, FIRST_USER_CAP)
      : r.firstUser)
    if (next === r.title) continue
    update.run(next, r.chatId)
    fixed++
  }
  if (fixed > 0) log.info('Backfilled external chat titles', { fixed, candidates: rows.length })
  return fixed
}
