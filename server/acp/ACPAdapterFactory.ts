/**
 * ACPAdapterFactory - Provider
 *
 *  CliProvider  ACPAgentAdapter
 * claude / codex / qoder  CliACPAdapter
 */

import type { CliProvider } from '../config/types'
import type { StreamJsonManager } from '../terminal/StreamJsonManager'
import type { ACPAgentAdapter } from './ACPAgentAdapter'
import { CliACPAdapter } from './CliACPAdapter'

export interface CreateAdapterOptions {
  command: string
  baseArgs: string[]
  env?: Record<string, string>
  cwd?: string
}

export const createACPAdapter = (
  provider: CliProvider,
  streamManager: StreamJsonManager,
  options: CreateAdapterOptions,
): ACPAgentAdapter => {
  switch (provider) {
    case 'claude':
    case 'qoder':
    case 'codex':
      return new CliACPAdapter(streamManager, { ...options, provider })
    case 'acp':
      throw new Error('Phase 3: NativeACPAdapter not implemented yet')
    default: {
      const _exhaustive: never = provider
      throw new Error(`Unsupported provider: ${_exhaustive}`)
    }
  }
}
