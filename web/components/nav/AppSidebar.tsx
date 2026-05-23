import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Settings, Sun, Moon, CalendarClock, Bell, History, MessagesSquare, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isElectron, isMacElectron } from '../../utils/env'
import { useTheme } from '../../contexts/ThemeContext'
import WorkspaceIcon from '../icons/WorkspaceIcon'
import OpenTeamLogo from '../icons/OpenTeamLogo'
import { useNotification } from '../../contexts/NotificationContext'
import MessageCenter from './MessageCenter'

const UsersThree = ({ size = 24 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5" cy="9.5" r="2" />
    <path d="M1 19c0-2.5 1.8-4 4-4" />
    <circle cx="19" cy="9.5" r="2" />
    <path d="M23 19c0-2.5-1.8-4-4-4" />
    <circle cx="12" cy="8" r="3" />
    <path d="M7 20a5 5 0 0 1 10 0" />
  </svg>
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface NavItemConfig {
  icon: React.ComponentType<any>
  labelKey: string
  path: string
  match: (pathname: string) => boolean
}

interface NavItem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>
  label: string
  path: string
  match: (pathname: string) => boolean
}

const PRIMARY_NAV_CONFIG: NavItemConfig[] = [
  {
    icon: MessagesSquare,
    labelKey: 'common:nav.dashboard',
    path: '/',
    match: (p) => p === '/' || /^\/workspace\/[^/]+\/chat\//.test(p),
  },
  {
    icon: History,
    labelKey: 'common:nav.chatHistory',
    path: '/chats',
    match: (p) => p === '/chats',
  },
  {
    icon: UsersThree,
    labelKey: 'common:nav.myTeam',
    path: '/agents',
    match: (p) => p.startsWith('/agents'),
  },
]

const OVERFLOW_NAV_CONFIG: NavItemConfig[] = [
  {
    icon: WorkspaceIcon,
    labelKey: 'common:nav.workspaces',
    path: '/workspaces',
    match: (p) => p.startsWith('/workspace') && !/\/chat\//.test(p),
  },
  {
    icon: Sparkles,
    labelKey: 'common:nav.skills',
    path: '/skills',
    match: (p) => p.startsWith('/skills'),
  },
  {
    icon: CalendarClock,
    labelKey: 'common:nav.cronJobs',
    path: '/cron-jobs',
    match: (p) => p.startsWith('/cron-jobs'),
  },
]

const BOTTOM_ITEMS_CONFIG: NavItemConfig[] = [
  {
    icon: Settings,
    labelKey: 'common:nav.settings',
    path: '/settings',
    match: (p) => p.startsWith('/settings'),
  },
]

const AppSidebar = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const { t } = useTranslation()
  const { unreadCount, lastNewNotification } = useNotification()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [isRinging, setIsRinging] = useState(false)
  const bellRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!lastNewNotification) return
    setIsRinging(true)
    const timer = setTimeout(() => setIsRinging(false), 3000)
    return () => clearTimeout(timer)
  }, [lastNewNotification])

  useEffect(() => {
    if (!popoverOpen) return
    const handler = (e: MouseEvent) => {
      if (
        !popoverRef.current?.contains(e.target as Node) &&
        !bellRef.current?.contains(e.target as Node)
      ) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen])

  const handleBellClick = useCallback(() => {
    if (bellRef.current) {
      const rect = bellRef.current.getBoundingClientRect()
      const panelHeight = 420
      const top = Math.min(rect.top, window.innerHeight - panelHeight - 8)
      setPopoverStyle({ position: 'fixed', left: rect.right + 8, top })
    }
    setPopoverOpen((v) => !v)
  }, [])

  const windowUser = (window as unknown as { user?: { userId?: string; name?: string } }).user
  const userName = windowUser?.name || ''

  const primaryItems: NavItem[] = PRIMARY_NAV_CONFIG.map((item) => ({
    ...item,
    label: t(item.labelKey),
  }))

  const overflowItems: NavItem[] = OVERFLOW_NAV_CONFIG.map((item) => ({
    ...item,
    label: t(item.labelKey),
  }))

  const bottomItems: NavItem[] = BOTTOM_ITEMS_CONFIG.map((item) => ({
    ...item,
    label: t(item.labelKey),
  }))

  const isOverflowActive = overflowItems.some((item) => item.match(location.pathname))

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [moreStyle, setMoreStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!moreOpen) return
    const handler = (e: MouseEvent) => {
      if (
        !moreRef.current?.contains(e.target as Node) &&
        !moreBtnRef.current?.contains(e.target as Node)
      ) {
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [moreOpen])

  const handleMoreClick = useCallback(() => {
    if (moreBtnRef.current) {
      const rect = moreBtnRef.current.getBoundingClientRect()
      setMoreStyle({ position: 'fixed', left: rect.right + 8, top: rect.top })
    }
    setMoreOpen((v) => !v)
  }, [])

  return (
    <div
      className={cn(
        'w-[52px] shrink-0 bg-bg-secondary border-r border-white/[0.04] flex flex-col items-center py-3 gap-0.5',
        isElectron && '-webkit-app-region-drag',
      )}
    >
      {/* Logo */}
      {isMacElectron && <div className="h-5 shrink-0" />}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={() => navigate('/')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate('/') }}
            aria-label={t('common:nav.backToHome')}
            tabIndex={0}
            className="h-10 w-10 flex items-center justify-center mb-2 shrink-0 rounded-lg transition-all hover:scale-105 hover:shadow-[0_0_12px_rgba(90,143,202,0.3)] cursor-pointer -webkit-app-region-no-drag"
          >
            <OpenTeamLogo size={28} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>{t('common:nav.home')}</TooltipContent>
      </Tooltip>
      <div className="w-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-2" />

      {/* Primary nav — 3 items */}
      {primaryItems.map((item) => (
        <SidebarButton
          key={item.path}
          item={item}
          active={item.match(location.pathname)}
          onClick={() => navigate(item.path)}
        />
      ))}

      <div className="w-6 h-px bg-gradient-to-r from-transparent via-white/6 to-transparent my-1" />

      {/* More overflow */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            ref={moreBtnRef}
            onClick={handleMoreClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleMoreClick() }}
            aria-label={t('common:nav.more', { defaultValue: 'More' })}
            tabIndex={0}
            className={cn(
              'relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer border-none -webkit-app-region-no-drag',
              isOverflowActive || moreOpen
                ? 'bg-accent-brand/15 text-accent-brand-light'
                : 'bg-transparent text-text-muted hover:text-text-primary hover:bg-white/[0.05]',
            )}
          >
            <MoreHorizontal size={17} strokeWidth={isOverflowActive ? 2 : 1.5} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>{t('common:nav.more', { defaultValue: 'More' })}</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      <div className="w-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-1.5 mt-1.5" />

      {/* Theme toggle */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={toggleTheme}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleTheme() }}
            aria-label={theme === 'dark' ? t('common:theme.toggleLight') : t('common:theme.toggleDark')}
            tabIndex={0}
            className="w-9 h-9 flex items-center justify-center rounded-md transition-colors cursor-pointer border-none -webkit-app-region-no-drag bg-transparent text-text-muted hover:bg-white/[0.05] hover:text-text-primary"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          {theme === 'dark' ? t('common:theme.lightMode') : t('common:theme.darkMode')}
        </TooltipContent>
      </Tooltip>

      {/* Notification bell */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            ref={bellRef}
            onClick={handleBellClick}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleBellClick() }}
            aria-label={t('common:nav.notifications', { defaultValue: 'Notifications' })}
            tabIndex={0}
            className={cn(
              'relative w-9 h-9 flex items-center justify-center rounded-md transition-colors cursor-pointer border-none -webkit-app-region-no-drag bg-transparent text-text-muted hover:bg-white/[0.05] hover:text-text-primary',
              popoverOpen && 'bg-bg-hover text-text-primary',
            )}
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <>
                {isRinging && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-400 animate-ping opacity-75" />
                )}
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-xs text-white flex items-center justify-center font-medium leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              </>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          {t('common:nav.notifications', { defaultValue: 'Notifications' })}
        </TooltipContent>
      </Tooltip>

      {/* Bottom nav */}
      {bottomItems.map((item) => (
        <SidebarButton
          key={item.path}
          item={item}
          active={item.match(location.pathname)}
          onClick={() => navigate(item.path)}
        />
      ))}

      {/* User name */}
      {userName && (
        <>
          <div className="w-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mt-1.5 mb-1.5" />
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <div
                aria-label={userName}
                className="w-9 h-9 flex items-center justify-center rounded-md -webkit-app-region-no-drag mb-1 text-xs text-text-secondary"
              >
                {userName.charAt(0).toUpperCase()}
              </div>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={6}>
              {userName}
            </TooltipContent>
          </Tooltip>
        </>
      )}

      {/* More overflow popover */}
      {moreOpen && (
        <div ref={moreRef} style={moreStyle} className="z-50">
          <div className="w-44 border border-border rounded-lg bg-bg-elevated shadow-lg py-1 animate-in fade-in slide-in-from-left-1 duration-150">
            {overflowItems.map((item) => {
              const Icon = item.icon
              const isActive = item.match(location.pathname)
              return (
                <button
                  key={item.path}
                  onClick={() => { navigate(item.path); setMoreOpen(false) }}
                  className={cn(
                    'flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors border-none cursor-pointer',
                    isActive
                      ? 'bg-accent-brand/10 text-accent-brand-light'
                      : 'bg-transparent text-text-secondary hover:bg-white/[0.04] hover:text-text-primary',
                  )}
                >
                  <Icon size={14} strokeWidth={isActive ? 2 : 1.5} />
                  <span className="text-xs font-medium">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Notification popover */}
      {popoverOpen && (
        <div ref={popoverRef} style={popoverStyle} className="z-50">
          <MessageCenter onClose={() => setPopoverOpen(false)} />
        </div>
      )}
    </div>
  )
}

const SidebarButton = ({ item, active, onClick }: {
  item: NavItem
  active: boolean
  onClick: () => void
}) => {
  const Icon = item.icon
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
          aria-label={item.label}
          tabIndex={0}
          className={cn(
            'relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer border-none -webkit-app-region-no-drag',
            active
              ? 'bg-accent-brand/15 text-accent-brand-light shadow-[0_0_8px_rgba(90,143,202,0.15)]'
              : 'bg-transparent text-text-muted hover:text-text-primary hover:bg-white/[0.05]',
          )}
        >
          {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2.5px] h-4 rounded-r-full bg-gradient-to-b from-accent-brand-light to-accent-brand" />
          )}
          <Icon size={17} strokeWidth={active ? 2 : 1.5} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{item.label}</TooltipContent>
    </Tooltip>
  )
}

export default AppSidebar
