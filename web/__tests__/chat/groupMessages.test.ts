import { describe, it, expect } from 'vitest'
import { groupMessages } from '../../components/chat/messages/groupMessages'
import type { Message } from '../../types/chat'

const msg = (overrides: Partial<Message> & { id: string; role: Message['role'] }): Message => ({
  type: 'text',
  content: '',
  timestamp: Date.now(),
  ...overrides,
} as Message)

describe('groupMessages', () => {
  it('empty messages returns empty array', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('single user → one group, agentMessages is empty', () => {
    const groups = groupMessages([msg({ id: '1', role: 'user' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].userMessage?.id).toBe('1')
    expect(groups[0].agentMessages).toHaveLength(0)
  })

  it('user + agent → one group', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user' }),
      msg({ id: 'a1', role: 'agent' }),
      msg({ id: 'a2', role: 'agent' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].agentMessages).toHaveLength(2)
  })

  it('multi-turn conversation → multiple groups', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user' }),
      msg({ id: 'a1', role: 'agent' }),
      msg({ id: 'u2', role: 'user' }),
      msg({ id: 'a2', role: 'agent' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].userMessage?.id).toBe('u1')
    expect(groups[1].userMessage?.id).toBe('u2')
  })

  it('no user at start → orphan group', () => {
    const groups = groupMessages([
      msg({ id: 'a1', role: 'agent' }),
      msg({ id: 'a2', role: 'agent' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].userMessage).toBeNull()
    expect(groups[0].id).toContain('orphan')
    expect(groups[0].agentMessages).toHaveLength(2)
  })

  it('Last group has running tool → isStreaming', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user' }),
      msg({ id: 'a1', role: 'agent', type: 'tool_use', toolUse: { toolName: 'Read', toolId: 't1', input: '{}', status: 'running' } } as unknown as Message),
    ])
    expect(groups[0].isStreaming).toBe(true)
  })

  it('Last group has stats → not streaming', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user' }),
      msg({ id: 'a1', role: 'agent', type: 'text' }),
      msg({ id: 'a2', role: 'agent', type: 'stats' }),
    ])
    expect(groups[groups.length - 1].isStreaming).toBe(false)
  })

  it('Last group ends with text and no stats → isStreaming', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user' }),
      msg({ id: 'a1', role: 'agent', type: 'text' }),
    ])
    expect(groups[groups.length - 1].isStreaming).toBe(true)
  })

  it('cross-agent interleaved replies attach to the right group, not the latest one', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user', agentId: 'A', timestamp: 1 }),
      msg({ id: 'u2', role: 'user', agentId: 'B', timestamp: 2 }),
      msg({ id: 'a1', role: 'agent', agentId: 'A', timestamp: 3, content: 'from A' }),
      msg({ id: 'a2', role: 'agent', agentId: 'B', timestamp: 4, content: 'from B' }),
    ])
    expect(groups).toHaveLength(2)
    const groupA = groups.find(g => g.agentId === 'A')!
    const groupB = groups.find(g => g.agentId === 'B')!
    expect(groupA.agentMessages.map(m => m.id)).toEqual(['a1'])
    expect(groupB.agentMessages.map(m => m.id)).toEqual(['a2'])
  })

  it('agent message with no matching prior group → opens orphan group instead of being dropped', () => {
    const groups = groupMessages([
      msg({ id: 'u1', role: 'user', agentId: 'A' }),
      msg({ id: 'a1', role: 'agent', agentId: 'B', content: 'B speaks first' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[1].userMessage).toBeNull()
    expect(groups[1].agentId).toBe('B')
    expect(groups[1].agentMessages.map(m => m.id)).toEqual(['a1'])
  })
})
