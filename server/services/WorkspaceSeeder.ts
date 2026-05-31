/**
 * WorkspaceSeeder -
 *
 *  app bundle  ai-assets/{agents,skills,workspace}
 *  ~/.openteam/{agents,skills,workspace}
 * agents/skills workspace
 *
 * Node 18  withFileTypes: true  entry.parentPath
 */

import { mkdir, readFile, writeFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { createLogger } from '../lib/logger'

const log = createLogger('WorkspaceSeeder')

export class WorkspaceSeeder {
  constructor(
    /** extraResources/ai-assets/ asar  */
    private bundledAssetsDir: string,
    private openteamHome: string,
  ) {}

  async seed(): Promise<void> {
    await Promise.all([
      this.seedDir('agents', true),
      this.seedDir('skills', true),
      this.seedDir('hooks', true),
      this.seedDir('system', true),
      this.seedOpenTeamJson(),
    ])
    await this.ensureAgentMemoryDirs()
  }

  private async ensureAgentMemoryDirs(): Promise<void> {
    const agentsDir = join(this.openteamHome, 'agents')
    if (!existsSync(agentsDir)) return
    try {
      const entries = await readdir(agentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await mkdir(join(agentsDir, entry.name, 'memory'), { recursive: true })
        }
      }
      log.debug('Ensured memory/ dirs for all agents')
    } catch (err) {
      log.warn('Failed to ensure agent memory dirs', { error: String(err) })
    }
  }

  /**
   *  bundled openteam.json  ~/.openteam/openteam.json
   * -  bundled  agent  agent
   */
  private async seedOpenTeamJson(): Promise<void> {
    const src = join(this.bundledAssetsDir, '..', 'openteam.json')
    const dst = join(this.openteamHome, 'openteam.json')

    if (!existsSync(src)) {
      log.debug('Bundled openteam.json not found, skipping seed')
      return
    }

    if (!existsSync(dst)) {
      await writeFile(dst, await readFile(src))
      log.info('Seeded openteam.json to user home')
      return
    }

    try {
      const bundledRaw = await readFile(src, 'utf-8')
      const userRaw = await readFile(dst, 'utf-8')
      const bundled = JSON.parse(bundledRaw) as Record<string, unknown>
      const user = JSON.parse(userRaw) as Record<string, unknown>

      const bundledAgents = (bundled as { agents?: { list?: Array<{ id: string }> } }).agents
      const userAgents = (user as { agents?: { list?: Array<{ id: string }> } }).agents
      if (!bundledAgents?.list || !userAgents?.list) return

      const builtinIds = new Set(bundledAgents.list.map((a) => a.id))

      const userCreatedAgents = userAgents.list.filter((a) => !builtinIds.has(a.id))

      const merged = { ...bundled }
      const mergedAgentsSection = { ...(bundled as { agents: Record<string, unknown> }).agents }
      mergedAgentsSection.list = [...bundledAgents.list, ...userCreatedAgents]
      ;(merged as { agents: Record<string, unknown> }).agents = mergedAgentsSection

      await writeFile(dst, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
      log.info('Merged bundled openteam.json into user config', {
        builtinUpdated: bundledAgents.list.length,
        userPreserved: userCreatedAgents.length,
      })
    } catch (err) {
      log.warn('Failed to merge openteam.json, skipping', { error: String(err) })
    }
  }

  private async seedDir(sub: string, overwrite = false): Promise<void> {
    const src = join(this.bundledAssetsDir, sub)
    const dst = join(this.openteamHome, sub)

    if (!existsSync(src)) {
      log.debug('Seed source not found, skipping', { sub })
      return
    }

    await this.copyRecursive(src, dst, overwrite)
    log.info('WorkspaceSeeder: done', { sub })
  }

  private async copyRecursive(src: string, dst: string, overwrite: boolean): Promise<void> {
    await mkdir(dst, { recursive: true })

    const entries = await readdir(src, { withFileTypes: true })

    for (const entry of entries) {
      const srcPath = join(src, entry.name)
      const dstPath = join(dst, entry.name)

      if (entry.isDirectory()) {
        await this.copyRecursive(srcPath, dstPath, overwrite)
      } else if (overwrite || !existsSync(dstPath)) {
        await writeFile(dstPath, await readFile(srcPath))
        log.debug('Seeded', { file: dstPath })
      }
    }
  }
}
