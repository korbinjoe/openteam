import { useEffect, useMemo, useState } from 'react'
import Avatar from 'boring-avatars'
import { cn } from '@/lib/utils'
import type { AvatarVariant } from '@/types/agentConfig'
import { useAvatarStyle } from '@/contexts/AvatarStyleContext'
import { getAvatarUrl } from '@/config/avatarAssets'

export type AgentAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export type AvatarAnimationState = 'idle' | 'thinking' | 'working' | 'blocked' | 'completed'

interface AgentAvatarProps {
  name: string
  agentId?: string
  icon?: string
  avatarId?: string
  avatarVariant?: AvatarVariant
  avatarColors?: string[]
  size?: AgentAvatarSize
  className?: string
  active?: boolean
  animationState?: AvatarAnimationState
  version?: number
  vibrant?: boolean
}

const SIZE_MAP: Record<AgentAvatarSize, { px: number; cls: string; text: string }> = {
  xs: { px: 16, cls: 'h-4 w-4', text: 'text-[8px]' },
  sm: { px: 20, cls: 'h-5 w-5', text: 'text-[9px]' },
  md: { px: 28, cls: 'h-7 w-7', text: 'text-[11px]' },
  lg: { px: 40, cls: 'h-10 w-10', text: 'text-base' },
  xl: { px: 56, cls: 'h-14 w-14', text: 'text-xl' },
}

const DEFAULT_COLORS = ['#F59E0B', '#6366F1', '#10B981', '#F472B6', '#38BDF8']

const ANIMATION_CLASS_MAP: Record<AvatarAnimationState, string> = {
  idle: '',
  thinking: 'animate-avatar-wobble',
  working: 'animate-avatar-pulse',
  blocked: 'animate-avatar-shake',
  completed: 'animate-avatar-bounce',
}

// Muted, restrained palette — replaces the loud marble gradient fallback.
// Hue chosen by name hash, saturation/lightness fixed for consistency.
const MONOGRAM_HUES = [210, 250, 280, 320, 0, 25, 45, 90, 160, 190]

const VIBRANT_PALETTE = [
  '#6366f1', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981',
  '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#64748b',
]

const hashName = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const initialsOf = (name: string): string => {
  const cleaned = name.replace(/[_\-]+/g, ' ').trim()
  if (!cleaned) return '?'
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return cleaned.slice(0, 2).toUpperCase()
}

const AgentAvatar = ({
  name,
  agentId,
  icon: _icon,
  avatarId: _avatarId,
  avatarVariant,
  avatarColors,
  size = 'md',
  className,
  active = false,
  animationState,
  version,
  vibrant = true,
}: AgentAvatarProps) => {
  const sizeConfig = SIZE_MAP[size]
  const colors = useMemo(() => avatarColors ?? DEFAULT_COLORS, [avatarColors])
  const { avatarStyle } = useAvatarStyle()
  const [imgError, setImgError] = useState(false)

  const baseUrl = agentId ? getAvatarUrl(agentId, avatarStyle) : null
  const avatarUrl = baseUrl && version ? `${baseUrl}?v=${version}` : baseUrl
  useEffect(() => setImgError(false), [avatarUrl])
  const showImage = avatarUrl && !imgError
  // Only fall back to boring-avatars when the caller explicitly asks for a
  // decorative variant (e.g. brush style detail page). The default fallback
  // is a quiet monogram so lists/chat don't drown in colorful gradients.
  const showDecorative = !showImage && !!avatarVariant

  const animClass = animationState
    ? ANIMATION_CLASS_MAP[animationState]
    : (active ? 'animate-breathe' : '')

  const monogramKey = agentId || name
  const hash = hashName(monogramKey)
  const hue = MONOGRAM_HUES[hash % MONOGRAM_HUES.length]
  const monogramBg = vibrant
    ? VIBRANT_PALETTE[hash % VIBRANT_PALETTE.length]
    : `hsl(${hue} 30% 92%)`
  const monogramFg = vibrant ? '#fff' : `hsl(${hue} 55% 32%)`

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden',
        sizeConfig.cls,
        animClass,
        className,
      )}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt={name}
          className="w-full h-full rounded-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : showDecorative ? (
        <Avatar
          size={sizeConfig.px}
          name={name}
          variant={avatarVariant}
          colors={colors}
        />
      ) : (
        <span
          className={cn(
            'flex h-full w-full items-center justify-center font-semibold tracking-tight select-none',
            sizeConfig.text,
          )}
          style={{ background: monogramBg, color: monogramFg }}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  )
}

export const isActivePhase = (phase: string): boolean => {
  switch (phase) {
    case 'thinking':
    case 'responding':
    case 'tool_running':
    case 'initializing':
    case 'waiting_confirmation':
      return true
    default:
      return false
  }
}

/**  AgentPhase  AvatarAnimationState */
export const phaseToAnimationState = (phase: string): AvatarAnimationState => {
  switch (phase) {
    case 'thinking':
    case 'initializing':
      return 'thinking'
    case 'tool_running':
    case 'responding':
      return 'working'
    case 'waiting_confirmation':
    case 'error':
      return 'blocked'
    case 'completed':
      return 'completed'
    default:
      return 'idle'
  }
}

export default AgentAvatar
