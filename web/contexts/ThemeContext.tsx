import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

export type ColorTheme =
  | 'jiqing' | 'yanzhi' | 'xiangye' | 'qingci' | 'zhusha'
  | 'ouhe' | 'shiqing' | 'qiuxiang' | 'yanxia' | 'yaqing'
  | 'diancui' | 'tanxiang' | 'qingtong'

export interface ColorThemeConfig {
  id: ColorTheme
  label: string
  labelEn: string
  color: string
  colorEnd?: string
}

export const COLOR_THEMES: ColorThemeConfig[] = [
  { id: 'jiqing',    label: 'Clear Sky',       labelEn: 'Clear Sky',       color: '#5a8fca' },
  { id: 'yanzhi',    label: 'Rouge',           labelEn: 'Rouge',           color: '#c45a6c' },
  { id: 'xiangye',   label: 'Silk Gold',       labelEn: 'Silk Gold',       color: '#e8be4c' },
  { id: 'qingci',    label: 'Celadon',         labelEn: 'Celadon',         color: '#74c0a8' },
  { id: 'zhusha',    label: 'Cinnabar',        labelEn: 'Cinnabar',        color: '#e2583e' },
  { id: 'ouhe',      label: 'Lotus Purple',    labelEn: 'Lotus Purple',    color: '#b294ce' },
  { id: 'shiqing',   label: 'Azurite',         labelEn: 'Azurite',         color: '#4494b2' },
  { id: 'qiuxiang',  label: 'Autumn Incense',  labelEn: 'Autumn Incense',  color: '#baa63e' },
  { id: 'yanxia',    label: 'Sunset Mist',     labelEn: 'Sunset Mist',     color: '#de7e9e' },
  { id: 'yaqing',    label: 'Raven Teal',      labelEn: 'Raven Teal',      color: '#6c8e94' },
  { id: 'diancui',   label: 'Kingfisher',      labelEn: 'Kingfisher',      color: '#20b6ac' },
  { id: 'tanxiang',  label: 'Sandalwood',      labelEn: 'Sandalwood',      color: '#c6a276' },
  { id: 'qingtong',  label: 'Bronze Green',    labelEn: 'Bronze Green',    color: '#8ea86c' },
]

const buildFaviconSvg = (ct: ColorThemeConfig): string => {
  const fill = ct.colorEnd
    ? `url(#g)`
    : ct.color
  const gradientDef = ct.colorEnd
    ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${ct.color}"/><stop offset="100%" stop-color="${ct.colorEnd}"/></linearGradient></defs>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 352 352">${gradientDef}<rect width="352" height="352" rx="56" fill="${fill}"/><rect x="75" y="92" width="202" height="44" rx="22" fill="white"/><rect x="154" y="92" width="44" height="192" rx="22" fill="white"/></svg>`
}

const updateFavicon = (ct: ColorThemeConfig) => {
  const svg = buildFaviconSvg(ct)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  const oldHref = link.href
  link.type = 'image/svg+xml'
  link.href = url
  if (oldHref.startsWith('blob:')) URL.revokeObjectURL(oldHref)
}

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
  colorTheme: ColorTheme
  setColorTheme: (ct: ColorTheme) => void
}

const THEME_KEY = 'openteam:theme'
const COLOR_THEME_KEY = 'openteam:color-theme'

const getInitialTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  return 'dark'
}

const getInitialColorTheme = (): ColorTheme => {
  try {
    const stored = localStorage.getItem(COLOR_THEME_KEY)
    if (stored && COLOR_THEMES.some((t) => t.id === stored)) return stored as ColorTheme
  } catch { /* ignore */ }
  return 'diancui'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(getInitialColorTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.classList.add('light')
    } else {
      root.classList.remove('light')
    }
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* ignore */ }
  }, [theme])

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-color-theme', colorTheme)
    try { localStorage.setItem(COLOR_THEME_KEY, colorTheme) } catch { /* ignore */ }
    const config = COLOR_THEMES.find((t) => t.id === colorTheme)
    if (config) updateFavicon(config)
  }, [colorTheme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const setColorTheme = useCallback((ct: ColorTheme) => setColorThemeState(ct), [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colorTheme, setColorTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
