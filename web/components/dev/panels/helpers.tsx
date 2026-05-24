import { useState } from 'react'
import { Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export const phaseColor = (phase: string) => {
  switch (phase) {
    case 'completed': case 'responding': return 'text-green-400'
    case 'thinking': case 'tool_running': case 'reading': return 'text-yellow-400'
    case 'waiting_input': return 'text-orange-400'
    case 'waiting_confirmation': return 'text-orange-300'
    case 'error': return 'text-red-400'
    case 'initializing': case 'deferred-polling': return 'text-blue-400'
    default: return 'text-zinc-400'
  }
}

export const chatStatusColor = (status: string) => {
  switch (status) {
    case 'running': return 'text-green-400'
    case 'idle': return 'text-blue-400'
    case 'stopped': return 'text-zinc-500'
    case 'merged': return 'text-purple-400'
    default: return 'text-zinc-400'
  }
}

export const missionStatusColor = (status: string) => {
  switch (status) {
    case 'success': case 'completed': return 'text-green-400'
    case 'running': return 'text-yellow-400'
    case 'waiting_input': return 'text-orange-400'
    case 'waiting_confirm': return 'text-orange-300'
    case 'failed': case 'error': return 'text-red-400'
    case 'cancelled': case 'interrupted': return 'text-zinc-500'
    default: return 'text-zinc-400'
  }
}

export const dot = (ok: boolean) => ok ? '🟢' : '🔴'

export const acpStateColor = (state: string) => {
  switch (state) {
    case 'active': return 'bg-green-500/20 text-green-400'
    case 'prompting': return 'bg-yellow-500/20 text-yellow-400'
    case 'initialized': return 'bg-blue-500/20 text-blue-400'
    case 'exited': return 'bg-red-500/20 text-red-400'
    case 'created': return 'bg-zinc-500/20 text-zinc-400'
    default: return 'bg-zinc-500/20 text-zinc-400'
  }
}

export const fmtTime = (ts: number | null) => {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export const fmtAgo = (ts: number | null) => {
  if (!ts) return '—'
  const sec = Math.round((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

export const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export const KV = ({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) => (
  <div className="flex items-start justify-between gap-2 py-0.5">
    <span className="text-zinc-500 text-xs shrink-0">{label}</span>
    <span className={cn('text-xs text-right break-all', mono && 'font-mono')}>{value}</span>
  </div>
)

export const Section = ({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-zinc-800">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800/50">
        {title}
        <span className="text-zinc-600">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  )
}

export const CopyableText = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <span className="flex items-center gap-1">
      <span className="text-[10px] font-mono truncate max-w-[200px]">{text}</span>
      <button onClick={handleCopy} className="text-zinc-500 hover:text-zinc-300 shrink-0" title="Copy">
        {copied ? <span className="text-green-400 text-[10px]">copied</span> : <Copy size={10} />}
      </button>
    </span>
  )
}

export const ActionBtn = ({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
  >
    {icon}
    {label}
  </button>
)
