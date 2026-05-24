import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { PipelineSnapshot, PipelineZone, PipelineZoneId } from '@/hooks/useDevPanel'
import { PipelineStage } from './PipelineStage'

const healthColor = (h: 'green' | 'yellow' | 'red') => {
  switch (h) {
    case 'green': return 'text-green-400'
    case 'yellow': return 'text-yellow-400'
    case 'red': return 'text-red-400'
  }
}

const healthDot = (h: 'green' | 'yellow' | 'red') => {
  switch (h) {
    case 'green': return 'bg-green-400'
    case 'yellow': return 'bg-yellow-400 animate-pulse'
    case 'red': return 'bg-red-400'
  }
}

const modeDescription: Record<string, string> = {
  'local': 'User → WS → PTY → JSONL → UI',
}

const zoneColor: Record<PipelineZoneId, { border: string; bg: string; text: string; icon: string }> = {
  local: { border: 'border-blue-500/30', bg: 'bg-blue-500/5', text: 'text-blue-400', icon: '💻' },
  network: { border: 'border-purple-500/30', bg: 'bg-purple-500/5', text: 'text-purple-400', icon: '🌐' },
  backflow: { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-400', icon: '⬇' },
}

const formatElapsed = (ms: number | null) => {
  if (ms == null) return null
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const min = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${min}m ${sec}s`
}

const ZoneHeader = ({ zone }: { zone: PipelineZone }) => {
  const style = zoneColor[zone.id]
  const doneCount = zone.stages.filter((s) => s.status === 'done').length
  const hasError = zone.stages.some((s) => s.status === 'error')
  const hasActive = zone.stages.some((s) => s.status === 'active')
  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 border-l-2', style.border, style.bg)}>
      <span className="text-xs">{style.icon}</span>
      <span className={cn('text-[11px] font-medium', style.text)}>{zone.label}</span>
      <span className="text-[10px] text-zinc-500 ml-auto">
        {doneCount}/{zone.stages.length}
      </span>
      {hasError && <span className="text-[10px] text-red-400">error</span>}
      {!hasError && hasActive && <span className="text-[10px] text-yellow-400">active</span>}
    </div>
  )
}

const ZoneProgressBar = ({ zone }: { zone: PipelineZone }) => {
  const style = zoneColor[zone.id]
  return (
    <div className="flex items-center gap-0.5 px-3 pb-1">
      {zone.stages.map((s) => (
        <div
          key={s.id}
          className={cn(
            'h-1 flex-1 rounded-full',
            s.status === 'done' ? 'bg-green-400' :
            s.status === 'active' ? 'bg-yellow-400 animate-pulse' :
            s.status === 'error' ? 'bg-red-400' :
            'bg-zinc-800',
          )}
          title={`${s.label}: ${s.status}`}
        />
      ))}
      {zone.stages.length === 0 && (
        <div className={cn('h-1 flex-1 rounded-full', style.bg)} />
      )}
    </div>
  )
}

export const DevPipelinePanel = ({ pipeline }: { pipeline: PipelineSnapshot | null }) => {
  const { t } = useTranslation('chat')
  if (!pipeline) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
        {t('dev.waitingPipeline')}
      </div>
    )
  }

  const elapsed = formatElapsed(pipeline.totalElapsedMs)
  const allStages = pipeline.zones.flatMap((z) => z.stages)
  const doneCount = allStages.filter((s) => s.status === 'done').length
  const activeStage = allStages.find((s) => s.status === 'active')

  return (
    <div className="py-2">
      <div className="px-3 mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className={cn('w-2 h-2 rounded-full', healthDot(pipeline.health))} />
            <span className={cn('text-xs font-medium', healthColor(pipeline.health))}>
              Pipeline {pipeline.health === 'green' ? 'Healthy' : pipeline.health === 'yellow' ? 'Active' : 'Error'}
            </span>
          </div>
          {elapsed && (
            <span className="text-[10px] text-zinc-500 font-mono">elapsed: {elapsed}</span>
          )}
        </div>
        <div className="text-[10px] text-zinc-600 font-mono">{modeDescription[pipeline.mode] ?? pipeline.mode}</div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="text-[10px] text-zinc-500">
            Progress: {doneCount}/{allStages.length}
          </span>
          {activeStage && (
            <span className="text-[10px] text-yellow-400">
              Current: {activeStage.label}
            </span>
          )}
          {pipeline.missionId && (
            <span className="text-[10px] text-zinc-600 font-mono">
              mission={pipeline.missionId.slice(0, 16)}
            </span>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-800/50">
        {pipeline.zones.map((zone) => {
          let stageIndex = 0
          return (
            <div key={zone.id} className="mb-1">
              <ZoneHeader zone={zone} />
              <ZoneProgressBar zone={zone} />
              {zone.stages.map((stage) => {
                const idx = stageIndex++
                return (
                  <PipelineStage
                    key={stage.id}
                    stage={stage}
                    index={idx}
                    isLast={idx === zone.stages.length - 1}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
