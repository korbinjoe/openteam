import { useCallback, useState } from 'react'

export type ChatViewMode = 'message' | 'terminal'

const KEY_PREFIX = 'openteam:chat-view:'

export const chatViewStorageKey = (
  chatId: string,
  agentScopeOverride?: string | null,
): string => agentScopeOverride
  ? `${KEY_PREFIX}${chatId}:${agentScopeOverride}`
  : `${KEY_PREFIX}${chatId}`

const isValidMode = (v: unknown): v is ChatViewMode =>
  v === 'message' || v === 'terminal'

const readStored = (key: string): ChatViewMode => {
  try {
    const v = localStorage.getItem(key)
    return isValidMode(v) ? v : 'message'
  } catch {
    return 'message'
  }
}

type SetViewMode = (next: ChatViewMode | ((prev: ChatViewMode) => ChatViewMode)) => void

/**
 * Per-chat persisted view mode. Quad tiles pinned to different agents under
 * the same chatId stay isolated via the agentScopeOverride suffix.
 *
 * Uses the "derived state during render" pattern instead of a mount-read
 * useEffect, so switching chatId/scope hydrates in a single render rather
 * than producing an extra paint with the previous chat's mode.
 */
export const useChatViewMode = (
  chatId: string,
  agentScopeOverride?: string | null,
): [ChatViewMode, SetViewMode] => {
  const key = chatViewStorageKey(chatId, agentScopeOverride)
  const [mode, setModeState] = useState<ChatViewMode>(() => readStored(key))
  const [trackedKey, setTrackedKey] = useState(key)

  if (key !== trackedKey) {
    setTrackedKey(key)
    setModeState(readStored(key))
  }

  const setMode = useCallback<SetViewMode>((next) => {
    setModeState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        localStorage.setItem(key, resolved)
      } catch {
        /* storage unavailable — keep in-memory state */
      }
      return resolved
    })
  }, [key])

  return [mode, setMode]
}

export default useChatViewMode
