/**
 * TerminalInstance —  xterm
 *
 * v2
 * 1.  write() / resetAndWriteSnapshot()
 *    TerminalInstance  xterm
 * 2.  pendingData rAF
 * 3. open() Promise
 * 4.  writeopened
 * 5. snapshot resetAndWriteSnapshot
 *
 * xterm v6  visible
 *  openopen
 */
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SerializeAddon } from '@xterm/addon-serialize'
import { TERMINAL_OPTIONS } from './constants'

export type ResizeCallback = (size: { cols: number; rows: number }) => void
export type DataCallback = (data: string) => void

/**
 *   created → attached → opening → opened → disposed
 *                ↑                              ↓
 *                └──── ( dispose) ────┘
 */
export type TerminalState = 'created' | 'attached' | 'opening' | 'opened' | 'disposed'

export class TerminalInstance {
  private static readonly MAX_PENDING_CHARS = 2 * 1024 * 1024
  private terminal: Terminal | null = null
  private fitAddon: FitAddon | null = null
  private serializeAddon: SerializeAddon | null = null
  private container: HTMLDivElement | null = null
  private _state: TerminalState = 'created'
  private pendingData: string[] = []
  private pendingChars = 0
  private resizeObserver: ResizeObserver | null = null
  private resizeRafId = 0
  private suppressResize = true
  private dataCallbacks: DataCallback[] = []
  private resizeCallbacks: ResizeCallback[] = []
  private openPromise: Promise<{ cols: number; rows: number }> | null = null
  /** R-06: pendingData  trueopen  */
  private hadDataTruncation = false
  private _rendererType: 'canvas' | 'webgl' = 'canvas'

  private currentState(): TerminalState {
    return this._state
  }

  get state(): TerminalState {
    return this._state
  }

  get rendererType(): 'canvas' | 'webgl' {
    return this._rendererType
  }

  get isOpened(): boolean {
    return this._state === 'opened'
  }

  get isOpening(): boolean {
    return this._state === 'opening'
  }

  get isDisposed(): boolean {
    return this._state === 'disposed'
  }

  get hasPendingData(): boolean {
    return this.pendingData.length > 0
  }

  get cols(): number {
    return this.terminal?.cols ?? 80
  }

  get rows(): number {
    return this.terminal?.rows ?? 24
  }

  attach(container: HTMLDivElement): void {
    if (this._state === 'disposed') return
    this.container = container
    if (this._state === 'created') this._state = 'attached'
  }

  async open(initCols?: number, initRows?: number): Promise<{ cols: number; rows: number }> {
    if (this._state === 'opened') return { cols: this.cols, rows: this.rows }
    if (this._state === 'disposed') return { cols: 80, rows: 24 }
    if (this.openPromise) return this.openPromise

    if (this._state !== 'created' && this._state !== 'attached') {
      return { cols: this.cols, rows: this.rows }
    }
    if (!this.container) return { cols: this.cols, rows: this.rows }

    this.openPromise = this.doOpen(initCols, initRows)
    return this.openPromise
  }

  private async doOpen(initCols?: number, initRows?: number): Promise<{ cols: number; rows: number }> {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise<void>(r => setTimeout(r, 50)),
      ])
    }

    const stateAfterFonts = this.currentState()
    if (stateAfterFonts === 'opened' || stateAfterFonts === 'disposed' || !this.container) {
      return { cols: this.cols, rows: this.rows }
    }
    this._state = 'opening'

    const terminal = new Terminal({
      ...TERMINAL_OPTIONS,
      cols: initCols ?? 80,
      rows: initRows ?? 24,
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())

    const unicode11 = new Unicode11Addon()
    terminal.loadAddon(unicode11)
    terminal.unicode.activeVersion = '11'

    const serializeAddon = new SerializeAddon()
    terminal.loadAddon(serializeAddon)

    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if ((!e.metaKey && !e.ctrlKey) || e.type !== 'keydown') return true
      if (terminal.buffer.active.type === 'alternate') return true
      if (e.key === 'ArrowUp') { terminal.scrollToTop(); return false }
      if (e.key === 'ArrowDown') { terminal.scrollToBottom(); return false }
      return true
    })

    terminal.onResize(({ cols, rows }) => {
      if (this.suppressResize) return
      this.resizeCallbacks.forEach(cb => cb({ cols, rows }))
    })

    terminal.onData((data: string) => {
      this.dataCallbacks.forEach(cb => cb(data))
    })

    this.terminal = terminal
    this.fitAddon = fitAddon
    this.serializeAddon = serializeAddon

    try {
      while (this.container.firstChild) {
        this.container.removeChild(this.container.firstChild)
      }
      terminal.open(this.container)

      await this.waitForRenderer()

      this.safeFit()

      console.info('[DIAG] doOpen replay', { pendingDataCount: this.pendingData.length, pendingChars: this.pendingChars, hadTruncation: this.hadDataTruncation })
      if (this.pendingData.length > 0) {
        const buffered = this.pendingData.join('')
        this.pendingData = []
        this.pendingChars = 0
        if (this.hadDataTruncation) {
          this.hadDataTruncation = false
          terminal.write('\r\n\x1b[33m[Output truncated: buffer overflow, earlier content was dropped]\x1b[0m\r\n')
        }
        terminal.write(buffered)
      }

      if (this.currentState() === 'disposed' || this.terminal !== terminal) {
        return { cols: initCols ?? 80, rows: initRows ?? 24 }
      }

      this._state = 'opened'

      if (this.pendingData.length > 0) {
        const lateData = this.pendingData.join('')
        this.pendingData = []
        this.pendingChars = 0
        terminal.write(lateData)
      }

      this.suppressResize = false
      if (terminal.cols !== (initCols ?? 80) || terminal.rows !== (initRows ?? 24)) {
        this.resizeCallbacks.forEach(cb => cb({ cols: terminal.cols, rows: terminal.rows }))
      }

      if (this.container && this.currentState() !== 'disposed') {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.resizeRafId) return
          this.resizeRafId = requestAnimationFrame(() => {
            this.resizeRafId = 0
            this.safeFit()
          })
        })
        this.resizeObserver.observe(this.container)
      }

      this.deferWebGLUpgrade(terminal)

      return { cols: terminal.cols, rows: terminal.rows }
    } catch (error) {
      if (this.currentState() !== 'disposed') this._state = 'attached'
      this.openPromise = null
      throw error
    }
  }

  setTheme(theme: ITheme): void {
    if (!this.terminal) return
    this.terminal.options.theme = { ...theme }
    this.terminal.clearTextureAtlas()
  }

  reactivate(): void {
    if (this._state !== 'opened' || !this.terminal) return
    this.safeFit()
    this.terminal.clearTextureAtlas()
    this.terminal.refresh(0, this.terminal.rows - 1)
  }

  write(data: string): void {
    if (this._state === 'disposed') return
    if (this._state !== 'opened' || !this.terminal) {
      this.pendingData.push(data)
      this.pendingChars += data.length
      if (this.pendingChars > TerminalInstance.MAX_PENDING_CHARS) {
        this.hadDataTruncation = true
        while (this.pendingChars > TerminalInstance.MAX_PENDING_CHARS && this.pendingData.length > 0) {
          const dropped = this.pendingData.shift()
          if (!dropped) break
          this.pendingChars -= dropped.length
        }
      }
      return
    }
    this.terminal.write(data)
  }

  /**
   * snapshot  snapshot
   * -  open pendingData snapshot
   * -  open xtermsnapshot  \x1b[2J\x1b[H
   *
   * snapshot
   */
  resetAndWriteSnapshot(data: string): void {
    if (this._state === 'disposed') return
    if (this._state === 'opened' && this.terminal) {
      this.terminal.clear()
      this.terminal.write(data)
    } else {
      this.pendingData = [data]
      this.pendingChars = data.length
    }
  }

  /**
   *  PTY  re-attach  ptySize
   *  open  ResizeObserver  —  fit
   */
  syncSize(cols: number, rows: number): void {
    if (this._state === 'disposed') return
    if (this._state !== 'opened' || !this.terminal) return
    if (!this.suppressResize) return
    if (this.terminal.cols !== cols || this.terminal.rows !== rows) {
      this.terminal.resize(cols, rows)
    }
  }

  safeFit(): boolean {
    if (!this.terminal || !this.fitAddon || !this.terminal.element) return false
    if (this.container) {
      const style = window.getComputedStyle(this.container)
      if (style.visibility === 'hidden' || style.display === 'none') return false
    }
    try {
      const dims = this.fitAddon.proposeDimensions()
      if (!dims) return false
      this.fitAddon.fit()
      return true
    } catch {
      return false
    }
  }

  serialize(options?: { scrollback?: number }): string {
    if (!this.serializeAddon || this._state !== 'opened') return ''
    return this.serializeAddon.serialize(options)
  }

  onData(cb: DataCallback): void {
    this.dataCallbacks.push(cb)
  }

  onResize(cb: ResizeCallback): void {
    this.resizeCallbacks.push(cb)
  }

  dispose(): void {
    if (this._state === 'disposed') return
    this._state = 'disposed'
    if (this.resizeRafId) {
      cancelAnimationFrame(this.resizeRafId)
      this.resizeRafId = 0
    }
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.terminal?.dispose()
    this.terminal = null
    this.fitAddon = null
    this.serializeAddon = null
    this.container = null
    this.pendingData = []
    this.pendingChars = 0
    this.dataCallbacks = []
    this.resizeCallbacks = []
    this.openPromise = null
  }

  private deferWebGLUpgrade(terminal: Terminal): void {
    const upgrade = () => {
      if (this._state === 'disposed' || this.terminal !== terminal) return
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          this._rendererType = 'canvas'
          this.terminal?.refresh(0, (this.terminal.rows ?? 1) - 1)
        })
        terminal.loadAddon(webgl)
        this._rendererType = 'webgl'
      } catch {
      }
    }
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(upgrade)
    } else {
      setTimeout(upgrade, 50)
    }
  }

  /**
   * open()  1-2
   *  proposeDimensions()  undefinedcell  0
   *  10  160ms
   */
  private waitForRenderer(): Promise<void> {
    if (!this.fitAddon || this._state === 'disposed') return Promise.resolve()
    if (this.fitAddon.proposeDimensions()) return Promise.resolve()

    return new Promise((resolve) => {
      let attempts = 0
      const maxAttempts = 10

      const check = () => {
        attempts++
        if (this._state === 'disposed' || !this.fitAddon) {
          resolve()
          return
        }
        const dims = this.fitAddon.proposeDimensions()
        if (dims || attempts >= maxAttempts) {
          resolve()
          return
        }
        requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    })
  }
}
