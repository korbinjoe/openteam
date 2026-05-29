import { authFetch } from '@/config/api'

export interface ModelOption {
  value: string
  label: string
  provider?: 'claude' | 'codex' | 'qoder'
}

const FALLBACK_MODELS: ModelOption[] = [
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

const FALLBACK_DEFAULT_MODEL = 'claude-opus-4-8'

// Mutable state — updated by initModels() before first render
// eslint-disable-next-line import/no-mutable-exports
export let DEFAULT_MODELS: ModelOption[] = FALLBACK_MODELS
// eslint-disable-next-line import/no-mutable-exports
export let DEFAULT_MODEL: string = FALLBACK_DEFAULT_MODEL

export const initModels = async (): Promise<void> => {
  try {
    const res = await authFetch('/api/config/models')
    if (!res.ok) return
    const data = await res.json() as { models?: ModelOption[], defaultModel?: string }
    if (Array.isArray(data.models) && data.models.length > 0) {
      DEFAULT_MODELS = data.models
    }
    if (data.defaultModel) {
      DEFAULT_MODEL = data.defaultModel
    }
  } catch {
    // fallback to hardcoded
  }
}

export const getModelsForProvider = (provider?: string): ModelOption[] => {
  if (!provider) return DEFAULT_MODELS
  if (provider === 'codex') return DEFAULT_MODELS.filter((m) => m.provider === 'codex')
  return DEFAULT_MODELS.filter((m) => !m.provider || m.provider === provider)
}
