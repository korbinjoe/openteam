import { readFileSync } from 'fs'
import { join } from 'path'
import { OPENTEAM_HOME } from './paths'

export interface ModelOption {
  value: string
  label: string
  provider?: 'claude' | 'codex' | 'qoder'
}

const HARDCODED_MODELS: ModelOption[] = [
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'claude' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'claude' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'claude' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'claude' },
  { value: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash', provider: 'claude' },
  { value: 'gpt-5.3-codex-0224-global', label: 'GPT-5.3 Codex', provider: 'codex' },
  { value: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
  { value: 'bailian/glm-5', label: 'GLM-5' },
  { value: 'MiniMax/MiniMax-M2.7', label: 'MiniMax M2.7' },
  { value: 'kimi-k2.5', label: 'Kimi K2.5' },
]

const HARDCODED_DEFAULT_MODEL = 'claude-opus-4-8'

const CONFIG_PATH = join(OPENTEAM_HOME, 'config.json')

interface ConfigFile {
  models?: ModelOption[]
  defaultModel?: string
}

const loadConfig = (): ConfigFile => {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as ConfigFile
    return parsed
  } catch {
    return {}
  }
}

export const getModels = (): ModelOption[] => {
  const config = loadConfig()
  if (config.models && Array.isArray(config.models) && config.models.length > 0) {
    return config.models
  }
  return HARDCODED_MODELS
}

export const getDefaultModel = (): string => {
  const config = loadConfig()
  return config.defaultModel || HARDCODED_DEFAULT_MODEL
}
