import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useTheme, COLOR_THEMES, type ColorTheme } from '../../contexts/ThemeContext'
import { isElectron } from '../../utils/env'
import UpdateSettings from './UpdateSettings'
import PreflightStatus from './PreflightStatus'

const Section = ({ title }: { title: string }) => (
  <div className="my-5 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
    <span>{title}</span>
    <div className="h-px flex-1 bg-border-subtle" />
  </div>
)

const ColorThemePicker = () => {
  const { colorTheme, setColorTheme } = useTheme()
  const { t, i18n } = useTranslation('settings')
  const isZh = i18n.language === 'zh'

  const handleSelect = (id: ColorTheme) => {
    setColorTheme(id)
  }

  return (
    <div>
      <div className="text-[13px] text-text-primary">{t('settings:brandTheme')}</div>
      <div className="mt-0.5 mb-3 text-xs text-text-secondary">{t('settings:brandThemeDesc')}</div>
      <div className="grid grid-cols-3 gap-2">
        {COLOR_THEMES.map((ct) => {
          const active = colorTheme === ct.id
          const bgStyle = ct.colorEnd
            ? { background: `linear-gradient(135deg, ${ct.color}, ${ct.colorEnd})` }
            : { background: ct.color }

          return (
            <button
              key={ct.id}
              onClick={() => handleSelect(ct.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelect(ct.id) }}
              tabIndex={0}
              aria-label={isZh ? ct.label : ct.labelEn}
              className={cn(
                'group relative flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all cursor-pointer',
                active
                  ? 'border-accent-brand bg-bg-hover'
                  : 'border-border-subtle bg-bg-secondary hover:border-border hover:bg-bg-hover-muted',
              )}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/10"
                style={bgStyle}
              />
              <span className="flex flex-col min-w-0">
                <span className={cn(
                  'text-xs font-medium truncate',
                  active ? 'text-text-emphasis' : 'text-text-primary',
                )}>
                  {isZh ? ct.label : ct.labelEn}
                </span>
              </span>
              {active && (
                <Check size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent-brand" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'pt'] as const

const GeneralSettings = () => {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const { theme, toggleTheme } = useTheme()
  const [preventSleep, setPreventSleep] = useState(false)

  useEffect(() => {
    if (!isElectron) return
    window.openteamBridge?.getPreventSleep().then(setPreventSleep).catch(() => {})
  }, [])

  const handlePreventSleepChange = (checked: boolean) => {
    setPreventSleep(checked)
    window.openteamBridge?.setPreventSleep(checked).catch(() => {})
  }

  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng)
  }

  return (
    <div className="mx-auto max-w-[560px] px-6 pb-10 pt-5">
      <Section title={t('settings:appearance')} />
      <div className="flex flex-col gap-3 mb-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-text-primary">{t('settings:lightMode')}</div>
            <div className="mt-0.5 text-xs text-text-secondary">{t('settings:lightModeDesc', { defaultValue: t('settings:switchToLight') })}</div>
          </div>
          <Switch
            checked={theme === 'light'}
            onCheckedChange={toggleTheme}
            aria-label={t('settings:toggleLightMode')}
          />
        </div>
        <div className="h-px bg-border-subtle" />
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] text-text-primary">{t('settings:language')}</div>
            <div className="mt-0.5 text-xs text-text-secondary">
              {t('settings:languageCurrent', { lang: t(`common:language.${i18n.language}`, { defaultValue: i18n.language }) })}
            </div>
          </div>
          <select
            value={i18n.language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            aria-label={t('settings:language')}
            className="rounded-md border border-border-subtle bg-bg-secondary px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent-brand"
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`common:language.${lng}`, { defaultValue: lng })}
              </option>
            ))}
          </select>
        </div>
        <div className="h-px bg-border-subtle" />
        <ColorThemePicker />
      </div>

      {isElectron && (
        <>
          <Section title={t('settings:system', { defaultValue: 'System' })} />
          <div className="flex flex-col gap-3 mb-1">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] text-text-primary">{t('settings:preventSleep')}</div>
                <div className="mt-0.5 text-xs text-text-secondary">{t('settings:preventSleepDesc')}</div>
              </div>
              <Switch
                checked={preventSleep}
                onCheckedChange={handlePreventSleepChange}
                aria-label={t('settings:preventSleepToggle')}
              />
            </div>
          </div>
        </>
      )}

      <Section title={t('settings:featureToggles', { defaultValue: 'Status' })} />
      <PreflightStatus />

      <Section title={t('settings:saveSettings', { defaultValue: 'Updates' })} />
      <UpdateSettings />

    </div>
  )
}

export default GeneralSettings
