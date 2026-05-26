// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatViewMode, chatViewStorageKey } from '../../hooks/useChatViewMode'

describe('useChatViewMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to message mode when nothing is stored', () => {
    const { result } = renderHook(() => useChatViewMode('chat-a'))
    expect(result.current[0]).toBe('message')
  })

  it('hydrates from existing storage entry', () => {
    localStorage.setItem(chatViewStorageKey('chat-b'), 'terminal')
    const { result } = renderHook(() => useChatViewMode('chat-b'))
    expect(result.current[0]).toBe('terminal')
  })

  it('round-trips through setMode -> storage -> next hook mount', () => {
    const { result } = renderHook(() => useChatViewMode('chat-c'))
    act(() => result.current[1]('terminal'))
    expect(result.current[0]).toBe('terminal')
    expect(localStorage.getItem(chatViewStorageKey('chat-c'))).toBe('terminal')

    const { result: result2 } = renderHook(() => useChatViewMode('chat-c'))
    expect(result2.current[0]).toBe('terminal')
  })

  it('falls back to message when stored value is invalid', () => {
    localStorage.setItem(chatViewStorageKey('chat-d'), 'foo')
    const { result } = renderHook(() => useChatViewMode('chat-d'))
    expect(result.current[0]).toBe('message')
  })

  it('isolates Quad tile modes via agentScopeOverride suffix', () => {
    const chatId = 'shared-chat'
    const { result: tileA } = renderHook(() =>
      useChatViewMode(chatId, 'agent-a'),
    )
    const { result: tileB } = renderHook(() =>
      useChatViewMode(chatId, 'agent-b'),
    )

    act(() => tileA.current[1]('terminal'))

    expect(tileA.current[0]).toBe('terminal')
    expect(tileB.current[0]).toBe('message')
    expect(localStorage.getItem(chatViewStorageKey(chatId, 'agent-a'))).toBe('terminal')
    expect(localStorage.getItem(chatViewStorageKey(chatId, 'agent-b'))).toBeNull()
  })

  it('plain chatId key does not collide with agentScopeOverride key', () => {
    const chatId = 'mission-1'
    expect(chatViewStorageKey(chatId)).toBe('openteam:chat-view:mission-1')
    expect(chatViewStorageKey(chatId, 'fullstack')).toBe('openteam:chat-view:mission-1:fullstack')
  })
})
