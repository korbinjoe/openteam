/**
 * PluginCommandsScanner — discovers slash commands exposed by Claude Code plugins.
 *
 * Claude Code's stream-json `system init` event does not enumerate plugin-provided
 * slash commands. We scan ~/.claude/plugins so OpenTeam's slash-command menu can
 * surface them. Naming follows Claude Code convention: `<plugin>:<skill-or-command>`.
 */

import { readdir, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createLogger } from '../lib/logger'

const log = createLogger('PluginCommandsScanner')

const CLAUDE_HOME = join(homedir(), '.claude')
const SETTINGS_PATH = join(CLAUDE_HOME, 'settings.json')
const INSTALLED_PLUGINS_PATH = join(CLAUDE_HOME, 'plugins', 'installed_plugins.json')

interface InstalledPluginEntry {
  installPath: string
  scope?: string
  installedAt?: string
}

interface InstalledPluginsFile {
  version?: number
  plugins?: Record<string, InstalledPluginEntry[]>
}

interface UserSettings {
  enabledPlugins?: Record<string, boolean>
}

const readJsonSafe = async <T>(path: string): Promise<T | null> => {
  try {
    if (!existsSync(path)) return null
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as T
  } catch (err) {
    log.debug('Failed to read JSON', { path, error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

const listSubdirs = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

const listFilesWithExt = async (dir: string, ext: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Scan enabled plugins under ~/.claude and return command names like
 * `understand-anything:understand`. Always resolves — never throws.
 * Results are de-duplicated and sorted.
 */
export const scanPluginSlashCommands = async (): Promise<string[]> => {
  const settings = await readJsonSafe<UserSettings>(SETTINGS_PATH)
  const enabled = settings?.enabledPlugins ?? {}
  const enabledKeys = Object.entries(enabled)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
  if (enabledKeys.length === 0) return []

  const installed = await readJsonSafe<InstalledPluginsFile>(INSTALLED_PLUGINS_PATH)
  const plugins = installed?.plugins
  if (!plugins) return []

  const results = new Set<string>()

  for (const key of enabledKeys) {
    const entries = plugins[key]
    if (!entries?.length) continue
    // key is "<pluginName>@<marketplace>"
    const pluginName = key.split('@')[0]
    if (!pluginName) continue

    // Pick the latest-installed entry (last in array).
    const entry = entries[entries.length - 1]
    const installPath = entry?.installPath
    if (!installPath || !existsSync(installPath)) continue

    // Skills live under <installPath>/skills/<name>/SKILL.md
    const skillsDir = join(installPath, 'skills')
    const skillNames = await listSubdirs(skillsDir)
    for (const name of skillNames) {
      if (existsSync(join(skillsDir, name, 'SKILL.md'))) {
        results.add(`${pluginName}:${name}`)
      }
    }

    // Slash commands live under <installPath>/commands/*.md
    const commandsDir = join(installPath, 'commands')
    const cmdFiles = await listFilesWithExt(commandsDir, '.md')
    for (const file of cmdFiles) {
      results.add(`${pluginName}:${file.replace(/\.md$/, '')}`)
    }
  }

  const list = Array.from(results).sort()
  log.debug('Scanned plugin slash commands', { count: list.length })
  return list
}

/**
 * Scan custom slash commands from project-level and user-level `.claude/commands/`.
 *
 * Resolution:
 *   - Flat files:  `<dir>/.claude/commands/foo.md`        → "foo"
 *   - Nested:      `<dir>/.claude/commands/group/sub.md`  → "group/sub"
 *
 * Both `cwd`-relative (project) and `~/.claude/commands` (user) are scanned.
 * Results are de-duplicated (project wins) and sorted.
 */
export const scanProjectSlashCommands = async (cwd: string): Promise<string[]> => {
  const results = new Set<string>()

  const scanDir = async (baseDir: string) => {
    const commandsDir = join(baseDir, '.claude', 'commands')
    if (!existsSync(commandsDir)) return

    const entries = await readdir(commandsDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        results.add(entry.name.replace(/\.md$/, ''))
      } else if (entry.isDirectory()) {
        const subFiles = await listFilesWithExt(join(commandsDir, entry.name), '.md')
        for (const file of subFiles) {
          results.add(`${entry.name}:${file.replace(/\.md$/, '')}`)
        }
      }
    }
  }

  await scanDir(cwd)
  await scanDir(homedir())

  const list = Array.from(results).sort()
  log.debug('Scanned project slash commands', { cwd, count: list.length })
  return list
}
