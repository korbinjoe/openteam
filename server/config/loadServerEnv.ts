/**
 * loadServerEnv — apply the top-level `env` block from ~/.openteam/openteam.json
 * to process.env before the rest of the server boots.
 *
 * Shell-exported variables always win: a key already present in process.env is
 * never overwritten. Missing keys are populated from the JSON file.
 *
 * Runs as an import-time side effect so it executes before any subsequent
 * module reads env. Re-exports applyServerEnv for tests.
 *
 * Schema (subset):
 *   { "env": { "OPENTEAM_LIGHT_MODEL": "claude-opus-4-7", ... } }
 *
 * Failure modes (missing file, bad JSON, wrong type) are silent — config-driven
 * env is optional and must not block startup.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { OPENTEAM_HOME } from './paths'

const USER_CONFIG_PATH = join(OPENTEAM_HOME, 'openteam.json')

export const applyServerEnv = (configPath: string = USER_CONFIG_PATH): string[] => {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch {
    return []
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const envBlock = (parsed as { env?: unknown }).env
  if (!envBlock || typeof envBlock !== 'object' || Array.isArray(envBlock)) return []

  const applied: string[] = []
  for (const [key, value] of Object.entries(envBlock as Record<string, unknown>)) {
    if (typeof value !== 'string') continue
    if (key in process.env) continue
    process.env[key] = value
    applied.push(key)
  }
  return applied
}

applyServerEnv()
