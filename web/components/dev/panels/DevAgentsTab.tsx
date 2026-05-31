import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { DevSnapshot, DevSessionSnapshot, DevJsonlMessage, DevRawJsonlContent } from '@/hooks/useDevPanel'
import { Section } from './helpers'

interface DevAgentsTabProps {
  snapshot: DevSnapshot
  jsonlStreams: Record<string, DevJsonlMessage[]>
  rawJsonlCache: Record<string, DevRawJsonlContent>
  onRequestRaw: (sessionId: string) => void
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const formatCost = (cost: number) => cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`

const AgentCard = ({ session }: { session: DevSessionSnapshot }) => {
  const [expanded, setExpanded] = useState(false)
  const totalCost = Object.values(session.activity.modelUsage).reduce((sum, u) => sum + (u.cost ?? 0), 0)
  const totalInput = Object.values(session.activity.modelUsage).reduce((sum, u) => sum + u.input, 0)
  const totalOutput = Object.values(session.activity.modelUsage).reduce((sum, u) => sum + u.output, 0)

  const phaseColor = session.activity.phase === 'running' ? 'text-blue-400' :
    session.activity.phase === 'completed' ? 'text-green-400/60' :
    session.activity.phase === 'waiting_input' || session.activity.phase === 'waiting_confirmation' ? 'text-yellow-400' :
    session.activity.phase === 'failed' ? 'text-red-400' : 'text-zinc-400'

  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 hover:bg-zinc-800/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded) }}
        role="button"
        tabIndex={0}
      >
        <div className={cn(
          'w-2 h-2 rounded-full shrink-0',
          session.activity.phase === 'running' ? 'bg-blue-400' :
          session.activity.phase === 'completed' ? 'bg-green-400/60' :
          session.activity.phase === 'failed' ? 'bg-red-400' :
          session.activity.phase === 'waiting_input' ? 'bg-yellow-400' :
          'bg-zinc-500',
        )} />
        <span className="text-[11px] text-zinc-200 font-medium truncate">{session.agentName}</span>
        <span className={cn('text-[10px] font-mono', phaseColor)}>{session.activity.phase}</span>
        {session.activity.currentTool && (
          <span className="text-[10px] text-zinc-600 font-mono truncate">→ {session.activity.currentTool}</span>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto font-mono shrink-0">{formatCost(totalCost)}</span>
      </div>

      {expanded && (
        <div className="px-3 py-2 space-y-2 text-[10px] border-t border-zinc-800">
          {/* ACP State */}
          {session.acp && (
            <div className="space-y-0.5">
              <div className="text-zinc-500 font-medium">ACP</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-400">
                <span>Adapter: <span className="text-zinc-300 font-mono">{session.acp.adapterState}</span></span>
                <span>Provider: <span className="text-zinc-300 font-mono">{session.acp.provider}</span></span>
                <span>Prompt In-Flight: <span className={session.acp.promptInFlight ? 'text-blue-400' : 'text-zinc-500'}>{String(session.acp.promptInFlight)}</span></span>
                {session.acp.lastPromptDurationMs !== null && (
                  <span>Last Prompt: <span className="text-zinc-300 font-mono">{session.acp.lastPromptDurationMs}ms</span></span>
                )}
                <span>Updates: <span className="text-zinc-300">{session.acp.updateCount}</span></span>
              </div>
            </div>
          )}

          {/* Token Usage */}
          {Object.keys(session.activity.modelUsage).length > 0 && (
            <div className="space-y-0.5">
              <div className="text-zinc-500 font-medium">Tokens</div>
              <table className="w-full text-zinc-400">
                <thead>
                  <tr className="text-zinc-600">
                    <th className="text-left font-normal">Model</th>
                    <th className="text-right font-normal">In</th>
                    <th className="text-right font-normal">Out</th>
                    <th className="text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(session.activity.modelUsage).map(([model, usage]) => (
                    <tr key={model}>
                      <td className="font-mono text-zinc-300 truncate max-w-[100px]">{model}</td>
                      <td className="text-right font-mono">{usage.input.toLocaleString()}</td>
                      <td className="text-right font-mono">{usage.output.toLocaleString()}</td>
                      <td className="text-right font-mono">{formatCost(usage.cost)}</td>
                    </tr>
                  ))}
                  {Object.keys(session.activity.modelUsage).length > 1 && (
                    <tr className="border-t border-zinc-800 text-zinc-300">
                      <td className="font-medium">Total</td>
                      <td className="text-right font-mono">{totalInput.toLocaleString()}</td>
                      <td className="text-right font-mono">{totalOutput.toLocaleString()}</td>
                      <td className="text-right font-mono">{formatCost(totalCost)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Session Info */}
          <div className="space-y-0.5">
            <div className="text-zinc-500 font-medium">Session</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-zinc-400">
              <span>ID: <span className="text-zinc-300 font-mono">{session.sessionId.slice(0, 12)}</span></span>
              <span>Status: <span className="text-zinc-300">{session.status}</span></span>
              {session.streamJson && (
                <>
                  <span>PID: <span className="text-zinc-300 font-mono">{session.streamJson.pid ?? '—'}</span></span>
                  <span>Provider: <span className="text-zinc-300 font-mono">{session.streamJson.provider}</span></span>
                  <span>Model: <span className="text-zinc-300 font-mono">{session.streamJson.model ?? '—'}</span></span>
                  <span>Turn: <span className="text-zinc-300">{session.streamJson.turnIndex}</span></span>
                </>
              )}
              {session.jsonl && (
                <>
                  <span>JSONL: <span className={session.jsonl.fileExists ? 'text-green-400' : 'text-red-400'}>{session.jsonl.fileExists ? 'exists' : 'missing'}</span></span>
                  <span>Size: <span className="text-zinc-300">{formatBytes(session.jsonl.fileSizeBytes)}</span></span>
                </>
              )}
              <span>WS: <span className={session.connectedWs ? 'text-green-400' : 'text-red-400'}>{session.connectedWs ? 'connected' : 'disconnected'}</span></span>
              {session.killReason && <span className="text-red-400">Kill: {session.killReason}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export const DevAgentsTab = ({ snapshot }: DevAgentsTabProps) => {
  if (snapshot.sessions.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
        No active sessions
      </div>
    )
  }

  return (
    <div className="p-3 space-y-2">
      <Section title={`Agent Sessions (${snapshot.totalSessions})`}>
        <div className="space-y-2">
          {snapshot.sessions.map((s) => (
            <AgentCard key={s.sessionId} session={s} />
          ))}
        </div>
      </Section>
    </div>
  )
}
