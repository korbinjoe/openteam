import { useTranslation } from 'react-i18next'
import { MessageSquare, TerminalSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip'
import type { ChatViewMode } from '@/hooks/useChatViewMode'

interface ChatViewModeToggleProps {
  mode: ChatViewMode
  onChange: (next: ChatViewMode) => void
  disabled?: boolean
}

const ChatViewModeToggle = ({ mode, onChange, disabled }: ChatViewModeToggleProps) => {
  const { t } = useTranslation('chat')
  const shortcut = t('chatViewMode.shortcut')

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="group"
        aria-label={t('chatViewMode.ariaLabel')}
        className="inline-flex items-center h-7 rounded-md border border-border-subtle bg-bg-secondary overflow-hidden"
      >
        <ToggleButton
          active={mode === 'message'}
          disabled={disabled}
          label={t('chatViewMode.message')}
          tooltip={t('chatViewMode.tooltipMessage', { shortcut })}
          onClick={() => mode === 'message' ? undefined : onChange('message')}
        >
          <MessageSquare size={14} />
        </ToggleButton>
        <span className="w-px h-[18px] bg-border-subtle" aria-hidden="true" />
        <ToggleButton
          active={mode === 'terminal'}
          disabled={disabled}
          label={t('chatViewMode.terminal')}
          tooltip={t('chatViewMode.tooltipTerminal', { shortcut })}
          onClick={() => mode === 'terminal' ? undefined : onChange('terminal')}
        >
          <TerminalSquare size={14} />
        </ToggleButton>
      </div>
    </TooltipProvider>
  )
}

interface ToggleButtonProps {
  active: boolean
  disabled?: boolean
  label: string
  tooltip: string
  onClick: () => void
  children: React.ReactNode
}

const ToggleButton = ({ active, disabled, label, tooltip, onClick, children }: ToggleButtonProps) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        tabIndex={0}
        className={cn(
          'inline-flex items-center justify-center w-[26px] h-[26px] transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          active
            ? 'bg-bg-elevated text-text-emphasis'
            : 'bg-transparent text-text-secondary hover:text-text-primary',
        )}
      >
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent>{tooltip}</TooltipContent>
  </Tooltip>
)

export default ChatViewModeToggle
