import { useRef, useEffect } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { Users } from './icons'

const AVAILABLE_AGENTS = [
  { type: 'fullstack', name: 'Fullstack Engineer', desc: 'Full-stack development, API design, database work', icon: 'F' },
  { type: 'designer', name: 'UI Designer', desc: 'UI/UX design, component styling, visual review', icon: 'D' },
  { type: 'reviewer', name: 'Code Reviewer', desc: 'Code review, security audit, best practices', icon: 'R' },
  { type: 'shield', name: 'Security Auditor', desc: 'Security scanning, vulnerability detection, hardening', icon: 'S' },
  { type: 'devops', name: 'DevOps Engineer', desc: 'CI/CD, Docker, deployment, infrastructure', icon: 'O' },
  { type: 'tester', name: 'Test Engineer', desc: 'Test writing, coverage analysis, QA', icon: 'T' },
]

const AddAgentPicker = () => {
  const { addAgentOpen, addAgentTaskId, closeAddAgent } = useWorkspace()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addAgentOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [addAgentOpen])

  if (!addAgentOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeAddAgent()
  }

  const handleSelect = (_agentType: string) => {
    // TODO: dispatch agent to task via server API
    closeAddAgent()
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[16vh] z-[100]"
      onClick={handleBackdropClick}
    >
      <div className="w-[480px] border border-border rounded-xl bg-bg-secondary shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center gap-2 mb-2.5">
            <Users size={14} className="text-accent-brand" />
            <span className="text-[13px] font-semibold text-text-primary">Add Agent to Task</span>
            <span className="text-[11px] text-text-secondary ml-1">{addAgentTaskId}</span>
          </div>
          <input
            ref={inputRef}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 outline-none text-xs text-text-primary font-sans placeholder:text-text-muted"
            placeholder="What should the agent do? (optional instruction)"
            onKeyDown={(e) => { if (e.key === 'Escape') closeAddAgent() }}
          />
        </div>

        {/* Agent list */}
        <div className="p-2 max-h-[320px] overflow-y-auto">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-2.5 py-1.5">
            Select Agent Type
          </div>
          {AVAILABLE_AGENTS.map((ag) => (
            <div
              key={ag.type}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-bg-hover transition-colors"
              onClick={() => handleSelect(ag.type)}
            >
              <div className="w-7 h-7 rounded-md bg-accent-brand/[0.08] border border-border flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-bold text-accent-brand-light">{ag.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-text-primary font-medium">{ag.name}</div>
                <div className="text-[10px] text-text-muted mt-px">{ag.desc}</div>
              </div>
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-muted">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border flex items-center gap-2">
          <span className="text-[10px] text-text-muted flex-1">Agent will inherit task context and war room.</span>
          <button
            className="px-2.5 py-1 rounded-[5px] border border-border bg-transparent text-text-secondary text-[10px] cursor-pointer"
            onClick={closeAddAgent}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddAgentPicker
