/**
 * SlashCommandResolver — expand custom slash commands before sending to Claude Code.
 *
 * Claude Code's stream-json mode does not load `.claude/commands/*.md` or plugin-provided
 * commands. When a user types `/openspec:proposal <args>` the CLI rejects it with a
 * synthetic "Unknown command" message. We pre-expand here so the agent receives the
 * command file body as a plain user prompt.
 *
 * Resolution order (first hit wins; `:` and `/` are both treated as path separators):
 *   1. Project-level:  <cwd>/.claude/commands/<group>/<sub>.md
 *   2. User-level:     ~/.claude/commands/<group>/<sub>.md
 *   3. Plugin:         <installPath>/[.claude/]commands/<sub>.md
 *                      <installPath>/skills/<sub>/SKILL.md
 *
 * Misses fall through with the original text — we never swallow input.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createLogger } from '../lib/logger'

const log = createLogger('SlashCommandResolver')

const CLAUDE_HOME = join(homedir(), '.claude')
const INSTALLED_PLUGINS_PATH = join(CLAUDE_HOME, 'plugins', 'installed_plugins.json')

interface InstalledPluginEntry {
  installPath: string
}

interface InstalledPluginsFile {
  plugins?: Record<string, InstalledPluginEntry[]>
}

const SLASH_COMMAND_RE = /^\/([A-Za-z0-9_:./-]+)(?:\s+([\s\S]*))?$/

const stripFrontmatter = (raw: string): string => {
  if (!raw.startsWith('---')) return raw
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return raw
  // Skip the closing '---' line and any trailing newline.
  const after = raw.slice(end + 4)
  return after.startsWith('\n') ? after.slice(1) : after
}

const applyArguments = (body: string, args: string): string => {
  const trimmedArgs = args.trim()
  if (body.includes('$ARGUMENTS')) {
    return body.replaceAll('$ARGUMENTS', trimmedArgs)
  }
  if (!trimmedArgs) return body
  return `${body.replace(/\s+$/, '')}\n\n## User arguments\n${trimmedArgs}\n`
}

const firstExisting = (paths: string[]): string | null => {
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

const projectCandidates = (cwd: string, segments: string[]): string[] => {
  const rel = segments.join('/')
  return [join(cwd, '.claude', 'commands', `${rel}.md`)]
}

const userCandidates = (segments: string[]): string[] => {
  const rel = segments.join('/')
  return [join(CLAUDE_HOME, 'commands', `${rel}.md`)]
}

const pluginCandidates = async (segments: string[]): Promise<string[]> => {
  if (segments.length === 0) return []
  const [pluginPrefix, ...rest] = segments
  if (!pluginPrefix || rest.length === 0) return []

  let installed: InstalledPluginsFile | null = null
  try {
    if (!existsSync(INSTALLED_PLUGINS_PATH)) return []
    installed = JSON.parse(await readFile(INSTALLED_PLUGINS_PATH, 'utf-8')) as InstalledPluginsFile
  } catch (err) {
    log.debug('Failed to read installed_plugins.json', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const plugins = installed?.plugins ?? {}
  const candidates: string[] = []
  const subRel = rest.join('/')
  const lastSeg = rest[rest.length - 1]

  for (const [key, entries] of Object.entries(plugins)) {
    const pluginName = key.split('@')[0]
    if (pluginName !== pluginPrefix) continue
    const entry = entries?.[entries.length - 1]
    if (!entry?.installPath) continue
    const base = entry.installPath
    candidates.push(join(base, 'commands', `${subRel}.md`))
    candidates.push(join(base, '.claude', 'commands', `${subRel}.md`))
    candidates.push(join(base, 'skills', lastSeg, 'SKILL.md'))
    candidates.push(join(base, '.claude', 'skills', lastSeg, 'SKILL.md'))
  }

  return candidates
}

const resolveCommandFile = async (cwd: string, segments: string[]): Promise<string | null> => {
  const projectHit = firstExisting(projectCandidates(cwd, segments))
  if (projectHit) return projectHit
  const userHit = firstExisting(userCandidates(segments))
  if (userHit) return userHit
  const pluginHit = firstExisting(await pluginCandidates(segments))
  return pluginHit
}

/**
 * Marker prefix injected into the expanded prompt so the chat UI can recover
 * the user-typed slash command from JSONL-derived messages and render it as a
 * compact chip instead of dumping the full command body.
 *
 * Format: `<!--OT_SLASH:<base64-json>-->\n<expanded body>`
 * Payload: `{ cmd: "/openspec:proposal", args: "raw user args", original: "/openspec:proposal raw user args" }`
 */
const SLASH_MARKER_PREFIX = '<!--OT_SLASH:'
const SLASH_MARKER_SUFFIX = '-->'

const encodeSlashMarker = (payload: { cmd: string; args: string; original: string }): string => {
  const json = JSON.stringify(payload)
  const b64 = Buffer.from(json, 'utf-8').toString('base64')
  return `${SLASH_MARKER_PREFIX}${b64}${SLASH_MARKER_SUFFIX}\n`
}

/**
 * If `text` starts with a custom slash command that resolves to a local
 * command/skill markdown file, return the expanded prompt (prefixed with an
 * OT_SLASH marker carrying the original user input). Otherwise return the
 * original text unchanged.
 */
export const expandSlashCommand = async (text: string, cwd: string): Promise<string> => {
  if (!text || !text.startsWith('/')) return text
  const match = text.match(SLASH_COMMAND_RE)
  if (!match) return text

  const [, rawName, rawArgs = ''] = match
  // Skip bare names with no group separator — built-in commands (e.g. /clear,
  // /help) are handled by the CLI itself; we only expand custom hierarchical
  // commands.
  if (!rawName.includes(':') && !rawName.includes('/')) return text

  const segments = rawName.split(/[:/]/).filter(Boolean)
  if (segments.length < 2) return text

  try {
    const file = await resolveCommandFile(cwd, segments)
    if (!file) return text
    const raw = await readFile(file, 'utf-8')
    const body = stripFrontmatter(raw).trim()
    if (!body) return text
    const expanded = applyArguments(body, rawArgs)
    log.debug('Expanded slash command', { name: rawName, file, argsLen: rawArgs.length })
    const marker = encodeSlashMarker({
      cmd: `/${rawName}`,
      args: rawArgs.trim(),
      original: text.trim(),
    })
    return `${marker}${expanded}`
  } catch (err) {
    log.warn('Slash command expansion failed; passing through', {
      name: rawName,
      error: err instanceof Error ? err.message : String(err),
    })
    return text
  }
}
