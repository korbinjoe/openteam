import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AGENTS_MD_TEMPLATES, SOUL_MD_TEMPLATES } from '@/config/agentMarkdownTemplates'

type Tab = 'IDENTITY.md' | 'AGENTS.md' | 'SOUL.md'

const IDENTITY_MD_EXAMPLE = `name: Full-stack product engineer
description: Handles end-to-end delivery from requirements analysis and technical design to full-stack development.
nickname: Alex
animal: dog
provider: Claude Code
allowedTools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
disallowedTools: []`

const pickBody = (templates: { id: string; body: string }[], id: string, fallbackIndex = 0) =>
  templates.find((t) => t.id === id)?.body ?? templates[fallbackIndex]?.body ?? ''

const EXAMPLE_BODIES: Record<Tab, string> = {
  'IDENTITY.md': IDENTITY_MD_EXAMPLE,
  'AGENTS.md': pickBody(AGENTS_MD_TEMPLATES, 'fullstack-engineer'),
  'SOUL.md': pickBody(SOUL_MD_TEMPLATES, 'soul-architect'),
}

type AgentExamplesPanelProps = {
  tab: Tab
  onApply?: (body: string) => void
}

const AgentExamplesPanel = ({ tab }: AgentExamplesPanelProps) => {
  const { t } = useTranslation('agents')
  const body = EXAMPLE_BODIES[tab]
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden bg-bg-secondary">
      <div className="shrink-0 flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-text-emphasis">
          <BookOpen size={12} className="text-accent-brand shrink-0" />
          {t('examples.title')}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors',
            copied
              ? 'border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400'
              : 'border-border bg-bg-primary text-text-primary hover:bg-bg-hover-muted',
          )}
        >
          {copied ? <Check size={9} /> : <Copy size={9} />}
          {copied ? t('examples.copied') : t('examples.copy')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-text-secondary">
          {body}
        </pre>
      </div>
    </div>
  )
}

export default AgentExamplesPanel
