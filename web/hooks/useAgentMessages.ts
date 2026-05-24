import { useState, useCallback, useMemo, useRef } from 'react'
import type { Message } from '../types/chat'

/**
 * Per-agent message store for a chat.
 *
 * A Mission (chat) hosts N independent agent conversations, each mapping 1:1 to a
 * Claude/Codex JSONL session. We keep them in separate slots so that:
 *   - Single-agent surfaces (Quad tile, agent-locked URL) read one slot directly
 *     and are guaranteed not to bleed into another agent's stream.
 *   - The aggregate Mission view merges by timestamp without losing per-agent
 *     ordering or threading.
 */

export type AgentMessagesMap = Record<string, Message[]>

const SYSTEM_AGENT_KEY = '__chat__'

export interface AgentMessagesAPI {
  agentMessages: AgentMessagesMap
  agentMessagesRef: React.MutableRefObject<AgentMessagesMap>
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentMessagesMap>>
  /** Append a single message to one agent slot. Tags msg.agentId if missing. */
  addMessage: (agentId: string, msg: Message) => void
  /** Updater-form mutate for one agent slot. */
  updateAgent: (agentId: string, updater: (prev: Message[]) => Message[]) => void
  /** Read snapshot for an agent slot (empty array if absent). */
  getAgentMessages: (agentId: string) => Message[]
  /** All messages flattened and timestamp-sorted — for aggregate Mission view. */
  mergedMessages: Message[]
}

export const SYSTEM_MESSAGE_AGENT = SYSTEM_AGENT_KEY

export const useAgentMessages = (): AgentMessagesAPI => {
  const [agentMessages, setAgentMessages] = useState<AgentMessagesMap>({})
  const agentMessagesRef = useRef(agentMessages)
  agentMessagesRef.current = agentMessages

  const addMessage = useCallback((agentId: string, msg: Message) => {
    const tagged: Message = msg.agentId ? msg : { ...msg, agentId }
    setAgentMessages((prev) => {
      const list = prev[agentId] ?? []
      return { ...prev, [agentId]: [...list, tagged] }
    })
  }, [])

  const updateAgent = useCallback((agentId: string, updater: (prev: Message[]) => Message[]) => {
    setAgentMessages((prev) => {
      const list = prev[agentId] ?? []
      const next = updater(list)
      if (next === list) return prev
      return { ...prev, [agentId]: next }
    })
  }, [])

  const getAgentMessages = useCallback((agentId: string): Message[] => {
    return agentMessagesRef.current[agentId] ?? []
  }, [])

  const mergedMessages = useMemo(() => {
    const all: Message[] = []
    for (const list of Object.values(agentMessages)) all.push(...list)
    all.sort((a, b) => a.timestamp - b.timestamp)
    return all
  }, [agentMessages])

  return {
    agentMessages,
    agentMessagesRef,
    setAgentMessages,
    addMessage,
    updateAgent,
    getAgentMessages,
    mergedMessages,
  }
}
