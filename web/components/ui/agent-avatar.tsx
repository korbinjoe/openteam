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
  xs: { px: 16, cls: 'h-4 w-4', text: 'text-[9px]' },
  sm: { px: 20, cls: 'h-5 w-5', text: 'text-[11px]' },
  md: { px: 28, cls: 'h-7 w-7', text: 'text-[13px]' },
  lg: { px: 40, cls: 'h-10 w-10', text: 'text-lg' },
  xl: { px: 56, cls: 'h-14 w-14', text: 'text-2xl' },
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

const AGENT_COLOR_MAP: Record<string, string> = {
  'lead':                         '#6B8DB5', // 天青 Sky blue
  'fullstack-engineer':   '#C87941', // 琥珀 Amber
  'code-reviewer':                '#5BA0A8', // 碧落 Cerulean
  'ui-designer':                  '#C76B8A', // 海棠 Crabapple
  'devops-engineer':              '#7BA056', // 翠柳 Willow green
  'architect':                    '#5878B0', // 群青 Ultramarine
  'sensei':                       '#9B6BC0', // 紫藤 Wisteria
  'image-creator':                '#D4A03C', // 缃叶 Golden leaf
  'product-strategist':           '#6A9BA0', // 秋水 Autumn water
  'growth-marketer':              '#D47B5A', // 丹霞 Danxia coral
}

const VIBRANT_PALETTE = [
  '#8B6BAE', // 藤萝 Vine purple
  '#5C9E72', // 松花 Pine green
  '#B87850', // 赭黄 Sienna
  '#6898B8', // 湖蓝 Lake blue
  '#C0728A', // 苋红 Amaranth
  '#8FA84E', // 柳黄 Willow gold
  '#7A8EB5', // 雾蓝 Mist blue
  '#BA9540', // 姜黄 Turmeric
]

const hashName = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const initialsOf = (name: string): string => {
  const cleaned = name.replace(/[_\-]+/g, ' ').trim()
  if (!cleaned) return '?'
  return cleaned[0].toUpperCase()
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
    ? (agentId && AGENT_COLOR_MAP[agentId]) || VIBRANT_PALETTE[hash % VIBRANT_PALETTE.length]
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
            'flex h-full w-full items-center justify-center font-semibold select-none',
            sizeConfig.text,
          )}
          style={{ background: monogramBg, color: monogramFg, fontFamily: '"Nunito", "SF Pro Rounded", ui-rounded, system-ui, sans-serif' }}
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
