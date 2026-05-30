import { useTheme, COLOR_THEMES } from '../../contexts/ThemeContext'

const OpenTeamLogo = ({ size = 24, className }: { size?: number, className?: string }) => {
  const { colorTheme } = useTheme()
  const config = COLOR_THEMES.find((t) => t.id === colorTheme)
  const fill = config?.color ?? '#5a8fca'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 352 352"
      fill="none"
      className={className}
      aria-label="OpenTeam Logo"
    >
      <rect width="352" height="352" rx="56" fill={fill} />
      <rect x="75" y="92" width="202" height="48" rx="24" fill="white" />
      <rect x="150" y="92" width="52" height="192" rx="26" fill="white" />
    </svg>
  )
}

export default OpenTeamLogo
