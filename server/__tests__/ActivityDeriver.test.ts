import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ActivityDeriver } from '../terminal/ActivityDeriver'
import type { ParsedMessage } from '../terminal/ConversationParser'

const ts = Date.now()

function userMsg(): ParsedMessage {
  return { id: 'u1', role: 'user', content: 'hello', timestamp: ts, type: 'text', turnIndex: 0 }
}

function agentTextMsg(): ParsedMessage {
  return { id: 'a1', role: 'agent', content: 'response', timestamp: ts, type: 'text', turnIndex: 0 }
}

function thinkingMsg(): ParsedMessage {
  return { id: 't1', role: 'agent', content: '', timestamp: ts, type: 'thinking', turnIndex: 0 }
}

function toolUseMsg(toolName = 'Bash', input = '{"command":"ls"}'): ParsedMessage {
  return {
    id: 'tu1',
    role: 'agent',
    content: '',
    timestamp: ts,
    type: 'toolUse',
    toolUse: { toolName, toolId: 'tid-1', input, status: 'completed' },
    turnIndex: 0,
  }
}

function toolResultMsg(): ParsedMessage {
  return {
    id: 'tr1',
    role: 'agent',
    content: '',
    timestamp: ts,
    type: 'toolResult',
    toolResult: { toolUseId: 'tid-1', content: 'ok' },
    turnIndex: 0,
  }
}

function statsMsg(isTurnEnd = true, costUsd = 0.01, model = 'claude-3-5'): ParsedMessage {
  return {
    id: 's1',
    role: 'agent',
    content: '',
    timestamp: ts,
    type: 'stats',
    stats: { costUsd, inputTokens: 100, outputTokens: 50 },
    model,
    isTurnEnd,
    turnIndex: 0,
  }
}

function askUserQuestionToolUseMsg(): ParsedMessage {
  return {
    id: 'aq1',
    role: 'agent',
    content: '',
    timestamp: ts,
    type: 'toolUse',
    toolUse: { toolName: 'AskUserQuestion', toolId: 'aq-tid', input: '{"question":"y/n?"}', status: 'completed' },
    turnIndex: 0,
  }
}

describe('ActivityDeriver', () => {
  let deriver: ActivityDeriver

  beforeEach(() => {
    vi.useFakeTimers()
    deriver = new ActivityDeriver()
  })

  afterEach(() => {
    deriver.destroy()
    vi.useRealTimers()
  })

  it('initial phase is initializing', () => {
    expect(deriver.getState().phase).toBe('initializing')
  })

  // ── onUserInput ──

  it('onUserInput() switches to thinking', () => {
    deriver.onUserInput()
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('thinking')
  })

  it('onUserInput() resets toolCount and toolCompleted', () => {
    deriver.onDeltaMessages([toolUseMsg()])
    deriver.onDeltaMessages([toolResultMsg()])
    vi.runAllTimers()
    expect(deriver.getState().toolCount).toBe(1)

    deriver.onUserInput()
    vi.runAllTimers()
    expect(deriver.getState().toolCount).toBe(0)
    expect(deriver.getState().toolCompleted).toBe(0)
  })

  // ── onDeltaMessages ──

  it('user text → thinking', () => {
    deriver.onDeltaMessages([userMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('thinking')
  })

  it('agent text → responding', () => {
    deriver.onDeltaMessages([agentTextMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('responding')
    expect(deriver.getState().hasText).toBe(true)
  })

  it('thinking msg → thinking (when not in tool_running)', () => {
    deriver.onDeltaMessages([thinkingMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('thinking')
  })

  it('toolUse → tool_running, currentTool and toolCount correct', () => {
    deriver.onDeltaMessages([toolUseMsg('Read', '{"file_path":"foo.ts"}')])
    vi.runAllTimers()
    const state = deriver.getState()
    expect(state.phase).toBe('tool_running')
    expect(state.currentTool).toBe('Read')
    expect(state.toolCount).toBe(1)
  })

  it('toolUse produces correct logLine (Bash)', () => {
    deriver.onDeltaMessages([toolUseMsg('Bash', '{"command":"git status"}')])
    vi.runAllTimers()
    expect(deriver.getState().logLine).toBe('$ git status')
  })

  it('toolUse produces correct fileOp (Read)', () => {
    deriver.onDeltaMessages([toolUseMsg('Read', '{"file_path":"/a/b/foo.ts"}')])
    vi.runAllTimers()
    expect(deriver.getState().fileOp).toEqual({ path: '/a/b/foo.ts', operation: 'read' })
  })

  it('toolUse produces correct fileOp (Edit)', () => {
    deriver.onDeltaMessages([toolUseMsg('Edit', '{"file_path":"bar.ts"}')])
    vi.runAllTimers()
    expect(deriver.getState().fileOp).toEqual({ path: 'bar.ts', operation: 'edit' })
  })

  it('toolUse produces correct fileOp (Write)', () => {
    deriver.onDeltaMessages([toolUseMsg('Write', '{"file_path":"new.ts"}')])
    vi.runAllTimers()
    expect(deriver.getState().fileOp).toEqual({ path: 'new.ts', operation: 'create' })
  })

  it('toolResult → thinking，toolCompleted++，fileOp Clear', () => {
    deriver.onDeltaMessages([toolUseMsg('Read', '{"file_path":"x.ts"}')])
    deriver.onDeltaMessages([toolResultMsg()])
    vi.runAllTimers()
    const state = deriver.getState()
    expect(state.phase).toBe('thinking')
    expect(state.toolCompleted).toBe(1)
    expect(state.fileOp).toBeUndefined()
  })

  it('stats isTurnEnd → waiting_input', () => {
    deriver.onDeltaMessages([statsMsg(true)])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('waiting_input')
  })

  it('stats isTurnEnd + AskUserQuestion unresolved → waiting_confirmation', () => {
    deriver.onDeltaMessages([askUserQuestionToolUseMsg()])
    deriver.onDeltaMessages([statsMsg(true)])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('waiting_confirmation')
  })

  it('stats non-isTurnEnd does not change phase', () => {
    deriver.onDeltaMessages([agentTextMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('responding')

    deriver.onDeltaMessages([statsMsg(false)])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('responding')
  })

  it('stats updates cost and tokens', () => {
    deriver.onDeltaMessages([statsMsg(true, 0.05)])
    vi.runAllTimers()
    expect(deriver.getState().cost).toBeCloseTo(0.05)
    expect(deriver.getState().tokens?.input).toBe(100)
    expect(deriver.getState().tokens?.output).toBe(50)
  })

  // ── onProcessExit ──

  it('onProcessExit(0) → completed', () => {
    deriver.onProcessExit(0)
    expect(deriver.getState().phase).toBe('completed')
  })

  it('onProcessExit(1) from initializing → error', () => {
    deriver.onProcessExit(1)
    expect(deriver.getState().phase).toBe('error')
  })

  it('onProcessExit(1) from waiting_input → completed (task already done)', () => {
    deriver.onDeltaMessages([userMsg(), agentTextMsg(), statsMsg(true)])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('waiting_input')
    deriver.onProcessExit(1)
    expect(deriver.getState().phase).toBe('completed')
  })

  it('onDeltaMessages does not change phase after completed', () => {
    deriver.onProcessExit(0)
    deriver.onDeltaMessages([userMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('completed')
  })

  it('onDeltaMessages does not change phase after error', () => {
    deriver.onProcessExit(1)
    deriver.onDeltaMessages([agentTextMsg()])
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('error')
  })

  // ── onFullMessages ──

  it('onFullMessages: full replay produces correct final status', () => {
    const messages: ParsedMessage[] = [
      userMsg(),
      agentTextMsg(),
      statsMsg(true),
    ]
    deriver.onFullMessages(messages)
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('waiting_input')
    expect(deriver.getState().hasText).toBe(true)
  })

  it('onFullMessages: waiting_input after tool sequence', () => {
    const messages: ParsedMessage[] = [
      userMsg(),
      toolUseMsg(),
      toolResultMsg(),
      statsMsg(true),
    ]
    deriver.onFullMessages(messages)
    vi.runAllTimers()
    expect(deriver.getState().phase).toBe('waiting_input')
    expect(deriver.getState().toolCount).toBe(1)
    expect(deriver.getState().toolCompleted).toBe(1)
  })

  it('onFullMessages with empty messages does not change status', () => {
    deriver.onFullMessages([])
    expect(deriver.getState().phase).toBe('initializing')
  })

  // ── setBackground ──

  it('setBackground toggles background flag', () => {
    expect(deriver.getState().background).toBe(false)
    deriver.setBackground(true)
    vi.runAllTimers()
    expect(deriver.getState().background).toBe(true)
    deriver.setBackground(false)
    vi.runAllTimers()
    expect(deriver.getState().background).toBe(false)
  })

  it('setBackground does not trigger emit when value unchanged', () => {
    const events: unknown[] = []
    deriver.on('activity', (s) => events.push(s))
    deriver.setBackground(false)
    vi.runAllTimers()
    expect(events).toHaveLength(0)
  })

  // ── activity Event ──

  it('terminal state (completed) immediately triggers activity event (no debounce)', () => {
    const events: unknown[] = []
    deriver.on('activity', (s) => events.push(s))
    deriver.onProcessExit(0)
    expect(events).toHaveLength(1)
  })

  it('non-terminal status change triggers after debounce (100ms)', () => {
    const events: unknown[] = []
    deriver.on('activity', (s) => events.push(s))
    deriver.onDeltaMessages([agentTextMsg()])
    expect(events).toHaveLength(0)
    vi.advanceTimersByTime(100)
    expect(events).toHaveLength(1)
  })

  it('consecutive same status: debounce merges, only triggers emit once', () => {
    const events: unknown[] = []
    deriver.on('activity', (s) => events.push(s))
    deriver.onDeltaMessages([agentTextMsg()])
    deriver.onDeltaMessages([agentTextMsg()])
    vi.advanceTimersByTime(100)
    expect(events).toHaveLength(1)
  })
})
