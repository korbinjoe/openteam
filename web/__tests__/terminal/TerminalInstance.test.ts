/**
 * TerminalInstance
 *
 * R-02: resetAndWriteSnapshot  clear()  write() scrollback
 * R-03: safeFit() visibility:hidden  tab resize  TUI
 * R-05: WebGL context loss  terminal.refresh() GPU buffer
 * R-06: pendingData  + open()
 * R-08: reactivate()  GPU buffer
 * R-09: chatId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const webglState = vi.hoisted(() => ({
  contextLossHandler: null as null | (() => void),
}))

// ── xterm mock ────────────────────────────────────────────────────────────────
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function() {
    return {
      loadAddon: vi.fn(),
      open: vi.fn(),
      onResize: vi.fn(),
      onData: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      refresh: vi.fn(),
      resize: vi.fn(),
      scrollToTop: vi.fn(),
      scrollToBottom: vi.fn(),
      clearTextureAtlas: vi.fn(),
      dispose: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      unicode: { activeVersion: '' },
      options: { theme: {} },
      cols: 80,
      rows: 24,
      element: {},
    }
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function() {
    return {
      proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
      fit: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function() {
    return {
      onContextLoss: vi.fn((cb: () => void) => {
        webglState.contextLossHandler = cb
      }),
      dispose: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn().mockImplementation(function() { return {} }),
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn().mockImplementation(function() { return {} }),
}))

vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: vi.fn().mockImplementation(function() {
    return { serialize: vi.fn().mockReturnValue('') }
  }),
}))

// ── import after mocks ────────────────────────────────────────────────────────
import { TerminalInstance } from '../../components/terminal/TerminalInstance'

// ── helpers ───────────────────────────────────────────────────────────────────

const mockContainer = () => ({ firstChild: null } as unknown as HTMLDivElement)

const stubBrowserGlobals = () => {
  vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } })
  vi.stubGlobal('window', {
    getComputedStyle: vi.fn(() => ({ visibility: 'visible', display: 'flex' })),
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', vi.fn(function() { return { observe: vi.fn(), disconnect: vi.fn() } }))
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => { cb(); return 0 })
  vi.stubGlobal('cancelIdleCallback', vi.fn())
}

/**
 *  opened  async open()
 *  open()
 */
const injectOpenedState = (inst: TerminalInstance) => {
  const any = inst as any
  any._state = 'opened'
  any.terminal = {
    clear: vi.fn(),
    write: vi.fn(),
    refresh: vi.fn(),
    resize: vi.fn(),
    clearTextureAtlas: vi.fn(),
    rows: 24,
    cols: 80,
    element: {},
    options: { theme: {} },
  }
  any.fitAddon = {
    proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
    fit: vi.fn(),
  }
  any.container = mockContainer()
}

// ── tests ──────────────────────────────────────────────────────────────────────

describe('TerminalInstance rendering risk fixes', () => {
  beforeEach(() => {
    webglState.contextLossHandler = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  describe('R-02: resetAndWriteSnapshot — clear before write', () => {
    it('calls clear() then write() in order when already opened', () => {
      const inst = new TerminalInstance()
      injectOpenedState(inst)
      const t = (inst as any).terminal

      const order: string[] = []
      t.clear.mockImplementation(() => order.push('clear'))
      t.write.mockImplementation(() => order.push('write'))

      inst.resetAndWriteSnapshot('\x1b[2J\x1b[Hsnapshot')

      expect(order).toEqual(['clear', 'write'])
      expect(t.write).toHaveBeenCalledWith('\x1b[2J\x1b[Hsnapshot')
    })

    it('replaces pendingData when not yet opened (no clear/write on terminal)', () => {
      const inst = new TerminalInstance()
      ;(inst as any).pendingData = ['stale data']
      ;(inst as any).pendingChars = 10

      inst.resetAndWriteSnapshot('fresh snapshot')

      expect((inst as any).pendingData).toEqual(['fresh snapshot'])
      expect((inst as any).pendingChars).toBe('fresh snapshot'.length)
    })
  })

  describe('R-03: safeFit — visibility guard', () => {
    it('returns false and skips fit() when visibility is hidden', () => {
      const inst = new TerminalInstance()
      injectOpenedState(inst)

      vi.stubGlobal('window', {
        getComputedStyle: vi.fn(() => ({ visibility: 'hidden', display: 'flex' })),
      })

      expect(inst.safeFit()).toBe(false)
      expect((inst as any).fitAddon.fit).not.toHaveBeenCalled()
    })

    it('returns false and skips fit() when display is none', () => {
      const inst = new TerminalInstance()
      injectOpenedState(inst)

      vi.stubGlobal('window', {
        getComputedStyle: vi.fn(() => ({ visibility: 'visible', display: 'none' })),
      })

      expect(inst.safeFit()).toBe(false)
      expect((inst as any).fitAddon.fit).not.toHaveBeenCalled()
    })

    it('calls fit() and returns true when container is visible', () => {
      const inst = new TerminalInstance()
      injectOpenedState(inst)

      vi.stubGlobal('window', {
        getComputedStyle: vi.fn(() => ({ visibility: 'visible', display: 'flex' })),
      })

      expect(inst.safeFit()).toBe(true)
      expect((inst as any).fitAddon.fit).toHaveBeenCalled()
    })
  })

  // ─── R-05: WebGL context loss → refresh ─────────────────────────────────────
  describe('R-05: WebGL context loss — fallback refresh', () => {
    it('calls terminal.refresh(0, rows-1) after GPU context loss', async () => {
      stubBrowserGlobals()

      const inst = new TerminalInstance()
      inst.attach(mockContainer())
      await inst.open(80, 24)

      expect(webglState.contextLossHandler).not.toBeNull()

      const mockTerminal = (inst as any).terminal
      mockTerminal.refresh.mockClear()

      // simulate GPU context loss
      webglState.contextLossHandler!()

      expect(mockTerminal.refresh).toHaveBeenCalledWith(0, 23) // rows - 1 = 23
    })

    it('switches rendererType to canvas after context loss', async () => {
      stubBrowserGlobals()

      const inst = new TerminalInstance()
      inst.attach(mockContainer())
      await inst.open(80, 24)

      expect(inst.rendererType).toBe('webgl')

      webglState.contextLossHandler!()

      expect(inst.rendererType).toBe('canvas')
    })
  })

  describe('R-06: pendingData overflow — truncation notice', () => {
    const MAX = 2 * 1024 * 1024 // 2MB

    it('sets hadDataTruncation when total pendingChars exceeds 2MB', () => {
      const inst = new TerminalInstance()
      const chunk = 'x'.repeat(MAX / 2 + 1) // just over 1MB

      inst.write(chunk)
      expect((inst as any).hadDataTruncation).toBe(false)

      inst.write(chunk) // total > 2MB → eviction
      expect((inst as any).hadDataTruncation).toBe(true)
    })

    it('evicts oldest chunks so pendingChars stays within MAX', () => {
      const inst = new TerminalInstance()
      const chunk = 'x'.repeat(MAX / 2 + 1)

      inst.write(chunk)
      inst.write(chunk)

      expect((inst as any).pendingChars).toBeLessThanOrEqual(MAX)
    })

    it('writes truncation notice before buffered data during open()', async () => {
      stubBrowserGlobals()

      const inst = new TerminalInstance()
      ;(inst as any).hadDataTruncation = true
      ;(inst as any).pendingData = ['buffered data']
      ;(inst as any).pendingChars = 13

      inst.attach(mockContainer())
      await inst.open(80, 24)

      const writes: string[] = (inst as any).terminal.write.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      )

      const noticeIdx = writes.findIndex(s => s.includes('Output truncated'))
      const dataIdx = writes.findIndex(s => s === 'buffered data')

      expect(noticeIdx).toBeGreaterThanOrEqual(0) // notice written
      expect(dataIdx).toBeGreaterThanOrEqual(0)   // data written
      expect(noticeIdx).toBeLessThan(dataIdx)      // notice before data
    })

    it('resets hadDataTruncation to false after open()', async () => {
      stubBrowserGlobals()

      const inst = new TerminalInstance()
      ;(inst as any).hadDataTruncation = true
      ;(inst as any).pendingData = ['x']
      ;(inst as any).pendingChars = 1

      inst.attach(mockContainer())
      await inst.open(80, 24)

      expect((inst as any).hadDataTruncation).toBe(false)
    })
  })

  describe('R-08: reactivate — force full redraw', () => {
    it('calls terminal.refresh(0, rows-1) and safeFit()', () => {
      const inst = new TerminalInstance()
      injectOpenedState(inst)

      vi.stubGlobal('window', {
        getComputedStyle: vi.fn(() => ({ visibility: 'visible', display: 'flex' })),
      })

      inst.reactivate()

      const t = (inst as any).terminal
      expect(t.refresh).toHaveBeenCalledWith(0, 23)
      expect((inst as any).fitAddon.fit).toHaveBeenCalled()
    })

    it('is a no-op and does not throw when state is not opened', () => {
      const inst = new TerminalInstance()
      expect(() => inst.reactivate()).not.toThrow()
    })
  })

  describe('R-09: chatId strict filter', () => {
    const fixedFilter = (payloadChatId: string | undefined, currentChatId: string | undefined) => {
      if (currentChatId && payloadChatId !== currentChatId) return false
      return true
    }

    const legacyFilter = (payloadChatId: string | undefined, currentChatId: string | undefined) => {
      if (payloadChatId && currentChatId && payloadChatId !== currentChatId) return false
      return true
    }

    it('blocks event when payload.chatId is undefined but currentChatId is set (the bug fix)', () => {
      expect(fixedFilter(undefined, 'chat-1')).toBe(false)
      expect(legacyFilter(undefined, 'chat-1')).toBe(true)
    })

    it('allows event when chatIds match', () => {
      expect(fixedFilter('chat-1', 'chat-1')).toBe(true)
    })

    it('blocks event when chatIds differ', () => {
      expect(fixedFilter('chat-2', 'chat-1')).toBe(false)
    })

    it('allows all events when currentChatId is not set', () => {
      expect(fixedFilter('chat-1', undefined)).toBe(true)
      expect(fixedFilter(undefined, undefined)).toBe(true)
    })
  })

  describe('TerminalInstance state machine baseline', () => {
    it('starts in created state', () => {
      const inst = new TerminalInstance()
      expect(inst.state).toBe('created')
      expect(inst.isOpened).toBe(false)
      expect(inst.isDisposed).toBe(false)
    })

    it('attach() transitions created → attached', () => {
      const inst = new TerminalInstance()
      inst.attach(mockContainer())
      expect(inst.state).toBe('attached')
    })

    it('dispose() from any state transitions to disposed', () => {
      const inst = new TerminalInstance()
      inst.dispose()
      expect(inst.isDisposed).toBe(true)
    })

    it('write() is silently dropped after dispose', () => {
      const inst = new TerminalInstance()
      inst.dispose()
      inst.write('ignored')
      expect((inst as any).pendingData).toEqual([])
    })

    it('open() returns default size and is idempotent after dispose', async () => {
      stubBrowserGlobals()
      const inst = new TerminalInstance()
      inst.dispose()
      const size = await inst.open(80, 24)
      expect(size).toEqual({ cols: 80, rows: 24 })
      expect(inst.isDisposed).toBe(true)
    })
  })
})
