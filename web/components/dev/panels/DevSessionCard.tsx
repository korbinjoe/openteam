import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, RefreshCw, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DevSnapshot, DevSessionSnapshot, DevJsonlMessage, DevRawJsonlContent } from '@/hooks/useDevPanel'
import { DevJsonlViewer } from '../DevJsonlViewer'
import { KV, Section, CopyableText, chatStatusColor, missionStatusColor, phaseColor, dot, fmtTime, fmtAgo, fmtSize } from './helpers'
import { ACPStateTag, ACPPromptLive, ACPUpdateList } from './ACPInspector'

export const DevOverview = ({ snapshot }: { snapshot: DevSnapshot }) => {
  const { t } = useTranslation('chat')
  return (
    <Section title="Overview">
      <KV label="chatId" value={snapshot.chatId} mono />
      <KV label="chat.status" value={
        <span className={chatStatusColor(snapshot.chat?.status ?? '')}>{snapshot.chat?.status ?? 'unknown'}</span>
      } />
      <KV label="chat.missionStatus" value={
        <span className={missionStatusColor(snapshot.chat?.missionStatus ?? '')}>{snapshot.chat?.missionStatus ?? '—'}</span>
      } />
      <KV label="Sessions" value={snapshot.totalSessions} />
      <KV label={t('dev.snapshotTime')} value={fmtTime(snapshot.timestamp)} />
    </Section>
  )
}

const DevRawJsonlPanel = ({ jsonlMeta, rawContent, showRaw, onToggle, onRefresh }: {
  jsonlMeta: { filePath: string; fileExists: boolean; fileSizeBytes: number }
  rawContent?: DevRawJsonlContent
  showRaw: boolean
  onToggle: () => void
  onRefresh: () => void
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopyPath = () => {
    navigator.clipboard.writeText(jsonlMeta.filePath).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between">
        <button
          onClick={onToggle}
          className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 flex items-center gap-1"
        >
          <FileText size={10} />
          RAW FILE
          <span className="text-zinc-600 normal-case">({fmtSize(jsonlMeta.fileSizeBytes)})</span>
          <span className="text-zinc-600">{showRaw ? '▼' : '▶'}</span>
        </button>
        {!jsonlMeta.fileExists && (
          <span className="text-[9px] text-red-400">NOT FOUND</span>
        )}
      </div>
      {showRaw && (
        <div className="mt-1 border border-zinc-700 rounded bg-zinc-900/50">
          <div className="flex items-center justify-between px-2 py-1 border-b border-zinc-800">
            <span className="text-[9px] text-zinc-500 font-mono truncate max-w-[260px]" title={jsonlMeta.filePath}>
              {jsonlMeta.filePath}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={handleCopyPath} className="text-zinc-600 hover:text-zinc-300 p-0.5" title="CopyPath">
                {copied ? <span className="text-green-400 text-[9px]">copied</span> : <Copy size={10} />}
              </button>
              <button onClick={onRefresh} className="text-zinc-600 hover:text-zinc-300 p-0.5" title="Refresh">
                <RefreshCw size={10} />
              </button>
            </div>
          </div>
          {!rawContent ? (
            <div className="text-xs text-zinc-600 italic py-3 text-center">Loading...</div>
          ) : !rawContent.fileExists ? (
            <div className="text-xs text-red-400/70 italic py-3 text-center">Filedoes not exist</div>
          ) : (
            <pre className="text-[9px] font-mono text-zinc-400 p-2 overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all leading-relaxed">
              {rawContent.content}
            </pre>
          )}
          {rawContent && rawContent.sizeBytes > 2 * 1024 * 1024 && (
            <div className="text-[9px] text-orange-400 px-2 py-1 border-t border-zinc-800">
              File exceeds 2MB, showing tail only
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const DevSessionCard = ({ session, messages, rawContent, onRequestRaw, showAllProtocol, onToggleShowAllProtocol }: {
  session: DevSessionSnapshot
  messages: DevJsonlMessage[]
  rawContent?: DevRawJsonlContent
  onRequestRaw: (sessionId: string) => void
  showAllProtocol: boolean
  onToggleShowAllProtocol: (value: boolean) => void
}) => {
  const isHistorical = session.status === 'historical'
  const [expanded, setExpanded] = useState(!isHistorical)
  const [showJsonl, setShowJsonl] = useState(messages.length > 0 && !isHistorical)
  const [showRaw, setShowRaw] = useState(false)

  const handleToggleRaw = () => {
    if (!showRaw && !rawContent) {
      onRequestRaw(session.sessionId)
    }
    setShowRaw(!showRaw)
  }

  return (
    <div className={cn('border rounded mb-2', isHistorical ? 'border-zinc-800/60 opacity-80' : 'border-zinc-800')}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-zinc-800/50"
      >
        <span>{isHistorical ? '⚫' : dot(session.streamJson?.alive ?? false)}</span>
        <span className={cn('font-medium', isHistorical ? 'text-zinc-400' : 'text-zinc-200')}>{session.agentName}</span>
        {session.origin === 'local' && (
          <span className="text-[10px] bg-zinc-700 text-zinc-300 px-1 rounded font-mono" title="Process running in local daemon">🏠 local</span>
        )}
        <span className="text-zinc-600">{session.agentId}</span>
        {isHistorical && (
          <span className="text-[10px] bg-zinc-700/50 text-zinc-500 px-1.5 rounded-full">historical</span>
        )}
        {messages.length > 0 && (
          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 rounded-full font-mono">{messages.length}</span>
        )}
        <span className="ml-auto text-zinc-600">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          {!isHistorical && session.acp && (<>
            <div className="text-[10px] font-medium text-purple-400 uppercase tracking-wider mt-1">ACP</div>
            <KV label="adapterState" value={<ACPStateTag state={session.acp.adapterState} />} />
            <KV label="provider" value={session.acp.provider} />
            <KV label="capabilities" value={
              <span className="text-[10px]">
                {[
                  session.acp.capabilities.supportsSessionLoad && 'loadSession',
                  session.acp.capabilities.supportsImages && 'images',
                  session.acp.capabilities.supportsThinking && 'thinking',
                ].filter(Boolean).join(', ')}
                {' '}[{session.acp.capabilities.modes.join(', ')}]
              </span>
            } />
            <KV label="prompt" value={
              session.acp.promptInFlight
                ? <ACPPromptLive startedAt={session.acp.promptStartedAt} />
                : <span className="text-zinc-500">idle</span>
            } />
            {session.acp.lastPromptDurationMs !== null && (
              <KV label="lastPromptMs" value={`${session.acp.lastPromptDurationMs.toLocaleString()}ms`} mono />
            )}
            <KV label="updateCount" value={session.acp.updateCount} mono />
            <KV label="lastUpdate" value={
              session.acp.lastUpdateType
                ? <span><span className="text-purple-300">{session.acp.lastUpdateType}</span> <span className="text-zinc-600">{fmtAgo(session.acp.lastUpdateAt)}</span></span>
                : '—'
            } />
            {session.acp.recentUpdates.length > 0 && (
              <ACPUpdateList
                updates={session.acp.recentUpdates}
                totalUpdateCount={session.acp.updateCount}
                showAllProtocol={showAllProtocol}
                onToggleShowAll={onToggleShowAllProtocol}
              />
            )}
          </>)}

          <div className="flex items-center justify-between mt-1">
            <button
              onClick={() => setShowJsonl(!showJsonl)}
              className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider hover:text-zinc-300 flex items-center gap-1"
            >
              <FileText size={10} />
              MESSAGES ({messages.length})
              <span className="text-zinc-600">{showJsonl ? '▼' : '▶'}</span>
            </button>
            {messages.length > 0 && session.streamJson?.alive && (
              <span className="text-[9px] text-green-500 animate-pulse">LIVE</span>
            )}
          </div>
          {showJsonl && (
            <DevJsonlViewer messages={messages} />
          )}

          {session.jsonl && (
            <DevRawJsonlPanel
              jsonlMeta={session.jsonl}
              rawContent={rawContent}
              showRaw={showRaw}
              onToggle={handleToggleRaw}
              onRefresh={() => onRequestRaw(session.sessionId)}
            />
          )}

          {!isHistorical && session.streamJson && (<>
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mt-2">STREAM-JSON</div>
            <KV label="alive" value={<span className={session.streamJson.alive ? 'text-green-400' : 'text-red-400'}>{String(session.streamJson.alive)}</span>} />
            <KV label="pid" value={session.streamJson.pid ?? '—'} mono />
            <KV label="provider" value={session.streamJson.provider} />
            <KV label="model" value={session.streamJson.model ?? '—'} />
            <KV label="turnIndex" value={session.streamJson.turnIndex} mono />
            <KV label="cliSessionId" value={session.streamJson.cliSessionId ? <CopyableText text={session.streamJson.cliSessionId} /> : '—'} />
            <KV label="spawnedAt" value={fmtTime(session.streamJson.spawnedAt)} />
          </>)}

          {!isHistorical && (<>
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mt-2">Activity</div>
            <KV label="phase" value={<span className={phaseColor(session.activity.phase)}>{session.activity.phase}</span>} />
            <KV label="currentTool" value={session.activity.currentTool ?? '—'} />
            <KV label="tools" value={`${session.activity.toolCompleted} / ${session.activity.toolCount}`} />
            <KV label="updatedAt" value={fmtAgo(session.activity.updatedAt)} />
            {Object.keys(session.activity.modelUsage).length > 0 && (
              <div className="mt-1">
                {Object.entries(session.activity.modelUsage).map(([model, usage]) => (
                  <KV key={model} label={model.split('/').pop() ?? model} value={
                    <span className="text-[10px]">in:{usage.input} out:{usage.output} ${usage.cost.toFixed(4)}</span>
                  } />
                ))}
              </div>
            )}
          </>)}

          {isHistorical && session.cliSessionId && (
            <KV label="cliSessionId" value={<CopyableText text={session.cliSessionId} />} />
          )}

          {!isHistorical && (<>
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mt-2">Connection</div>
            <KV label="WS connected" value={<span>{dot(session.connectedWs)} {String(session.connectedWs)}</span>} />
            <KV label="connectionId" value={session.connectionId ? session.connectionId.slice(0, 8) + '…' : '—'} mono />
            <KV label="cliSessionId" value={session.cliSessionId ? session.cliSessionId.slice(0, 8) + '…' : '—'} mono />
            {session.disconnectedAt && <KV label="disconnectedAt" value={fmtAgo(session.disconnectedAt)} />}
            {session.killReason && <KV label="killReason" value={<span className="text-red-400">{session.killReason}</span>} />}
          </>)}
        </div>
      )}
    </div>
  )
}
