/**
 * cliPrompt — Lightweight one-shot LLM calls.
 *
 * Default path: Anthropic SDK (no JSONL session files written to disk).
 *   Auth source priority:
 *     1. ANTHROPIC_API_KEY (x-api-key header)
 *     2. ANTHROPIC_AUTH_TOKEN (Bearer token, e.g. proxied gateways)
 *   Honors ANTHROPIC_BASE_URL for self-hosted / proxied endpoints.
 *
 * Fallback: local `claude --print` CLI when neither auth env var is set.
 *   Kept for backward compatibility — same JSONL-creating behavior as before.
 */

import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'child_process'
import { createLogger } from './logger'
import { resolveCliCommandAsync, resolveInterpreter } from './resolveCliCommand'

const log = createLogger('cliPrompt')

const FALLBACK_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_MAX_TOKENS = 1024

const resolveDefaultModel = (): string =>
  process.env.OPENTEAM_LIGHT_MODEL || FALLBACK_MODEL

export interface CliPromptOptions {
  prompt: string
  systemPrompt?: string
  model?: string
  maxTurns?: number
  timeoutMs?: number
}

export interface CliPromptResult {
  success: boolean
  text?: string
  error?: string
}

let cachedClient: Anthropic | null = null

const getClient = (): Anthropic | null => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  if (!apiKey && !authToken) return null
  if (cachedClient) return cachedClient
  cachedClient = new Anthropic({
    apiKey: apiKey || undefined,
    authToken: !apiKey && authToken ? authToken : undefined,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  })
  return cachedClient
}

export const cliPrompt = async (options: CliPromptOptions): Promise<CliPromptResult> => {
  const client = getClient()
  if (client) {
    return promptViaSdk(client, options)
  }
  return promptViaCli(options)
}

const promptViaSdk = async (
  client: Anthropic,
  options: CliPromptOptions,
): Promise<CliPromptResult> => {
  const { prompt, systemPrompt, model = resolveDefaultModel(), timeoutMs = 15_000 } = options

  try {
    const resp = await client.messages.create(
      {
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      },
      { timeout: timeoutMs },
    )

    const text = resp.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    if (!text) {
      return { success: false, error: 'SDK returned empty response' }
    }
    return { success: true, text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.debug('cliPrompt SDK call failed', { error: message })
    return { success: false, error: message }
  }
}

const promptViaCli = async (options: CliPromptOptions): Promise<CliPromptResult> => {
  const { prompt, systemPrompt, model, maxTurns = 1, timeoutMs = 15_000 } = options

  const resolvedClaude = await resolveCliCommandAsync('claude')
  if (!resolvedClaude) {
    return { success: false, error: 'Claude CLI not found' }
  }

  const args = [
    '--print',
    '--output-format', 'text',
    '--max-turns', String(maxTurns),
    '--dangerously-skip-permissions',
  ]

  if (model) {
    args.push('--model', model)
  }

  if (systemPrompt) {
    args.push('--append-system-prompt', systemPrompt)
  }

  args.push('-p', prompt)

  const { command: spawnCmd, prependArgs } = resolveInterpreter(resolvedClaude)
  const fullArgs = [...prependArgs, ...args]

  return new Promise((resolve) => {
    execFile(spawnCmd, fullArgs, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const errMsg = err.killed
          ? `CLI timeout (${timeoutMs}ms)`
          : stderr.trim() || err.message
        log.debug('cliPrompt CLI call failed', { error: errMsg })
        resolve({ success: false, error: errMsg })
        return
      }

      const text = stdout.trim()
      if (!text) {
        resolve({ success: false, error: 'CLI returned empty response' })
        return
      }

      resolve({ success: true, text })
    })
  })
}
