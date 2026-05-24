/**
 * ChatTitleService — Generate chat titles via local Claude CLI
 */

import { cliPrompt } from '../../lib/cliPrompt'
import { createLogger } from '../../lib/logger'

const log = createLogger('ChatTitleService')

const TIMEOUT_MS = 10_000

export class ChatTitleService {
  async generate(firstMessage: string): Promise<string | null> {
    const prompt = `Generate a concise title (5-8 words, no punctuation, just the title itself) for this user message:\n\n${firstMessage.slice(0, 500)}`

    const result = await cliPrompt({
      prompt,
      timeoutMs: TIMEOUT_MS,
    })

    if (!result.success) {
      log.debug('Title generation failed (non-critical)', { error: result.error })
      return null
    }

    const text = result.text!.trim()
    if (!text) return null

    return text.replace(/^["「『【]|["」』】]$/g, '').slice(0, 40)
  }
}
