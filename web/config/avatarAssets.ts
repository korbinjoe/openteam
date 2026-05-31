import type { AvatarStyleMode } from '@/types/agentConfig'

/** Agent ID →  builtin agent  */
const AVATAR_FILE_MAP: Record<string, Partial<Record<AvatarStyleMode, string>>> = {
  'architect': {
    'brush': 'architect-eagle.png',
  },
  'code-reviewer': {
    'brush': 'code-reviewer-hawk.png',
  },
  'devops-engineer': {
    'brush': 'devops-bear.png',
  },
  'fullstack-engineer': {
    'brush': 'fullstack-wolf.png',
  },
  'image-creator': {
    'brush': 'image-creator-chameleon.png',
  },
  'lead': {
    'brush': 'lead-owl.png',
  },
  'sensei': {
    'brush': 'sensei-octopus.png',
  },
  'ui-designer': {
    'brush': 'ui-designer-fox.png',
  },
}

/**
 *  Agent  URL
 *
 * - builtin agent  `AVATAR_FILE_MAP` →  `/avatars/<style>/<file>`
 * -  agent  →  `/api/avatars/custom/<agentId>/<style>`
 *    `<img>` onError
 * - `style === 'default'`  fallback  boring-avatars
 */
export const getAvatarUrl = (
  agentId: string,
  style: AvatarStyleMode,
): string | null => {
  if (style === 'default') return null
  const file = AVATAR_FILE_MAP[agentId]?.[style]
  if (file) return `/avatars/${style}/${file}`
  return `/api/avatars/custom/${agentId}/${style}`
}

export const AVATAR_STYLES: Array<{
  value: AvatarStyleMode
  labelKey: string
}> = [
  { value: 'default', labelKey: 'agents:avatarStyle.default' },
  { value: 'brush', labelKey: 'agents:avatarStyle.brush' },
]

export const AVATAR_STYLES_FOR_GENERATION: AvatarStyleMode[] = [
  'default',
  'brush',
]
