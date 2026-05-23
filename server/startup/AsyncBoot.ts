import { createLogger } from '../lib/logger'
import { CliAutoInstaller, type CliAutoInstallResult } from '../services/CliAutoInstaller'
import { PreflightChecker, type PreflightResult } from '../services/PreflightChecker'
import { DirectoryEnumerator } from '../services/scanner/DirectoryEnumerator'
import { ExternalDirWatcher } from '../services/scanner/ExternalDirWatcher'
import { isExternalScanEnabled } from '../services/scanSettings'

const log = createLogger('AsyncBoot')

let externalDirWatcher: ExternalDirWatcher | null = null
export const getExternalDirWatcher = (): ExternalDirWatcher | null => externalDirWatcher

export interface AsyncBootResult {
  envCheckResult: CliAutoInstallResult | null
  preflightResult: PreflightResult | null
}

export const runAsyncBoot = (broadcast: (msg: Record<string, unknown>) => void): AsyncBootResult => {
  const result: AsyncBootResult = { envCheckResult: null, preflightResult: null }

  new CliAutoInstaller().run().then((envResult) => {
    result.envCheckResult = envResult
    if (!envResult.npmAvailable || envResult.cliInstallFailures.length > 0) {
      broadcast({ type: 'system:env-check', payload: envResult })
      if (envResult.cliInstallFailures.length > 0) {
        log.warn('CLI auto-install partial failure', {
          failures: envResult.cliInstallFailures.map(f => f.command).join(','),
          count: envResult.cliInstallFailures.length,
        })
      }
    }
    return new PreflightChecker(envResult.cliInstallFailures).run()
  }).then((pfResult) => {
    result.preflightResult = pfResult
    broadcast({ type: 'system:preflight', payload: pfResult })
  }).catch((err) => {
    log.warn('CLI auto-install or preflight failed', { error: err instanceof Error ? err.message : String(err) })
  })

  setImmediate(() => {
    if (!isExternalScanEnabled()) {
      log.debug('External session scan disabled, skipping')
      return
    }
    new DirectoryEnumerator().enumerate()
      .then((r) => {
        broadcast({ type: 'external-dirs:ready', payload: r })
        if (!externalDirWatcher) {
          externalDirWatcher = new ExternalDirWatcher(broadcast)
          externalDirWatcher.start()
        }
      })
      .catch((err) => {
        log.warn('Tier-1 enumeration failed', {
          error: err instanceof Error ? err.message : String(err),
        })
      })
  })

  return result
}
