import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const ExternalLink = ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
  <a
    {...props}
    href={href}
    onClick={(e) => {
      if (href) {
        e.preventDefault()
        e.stopPropagation()
        window.open(href, '_blank')
      }
    }}
  >
    {children}
  </a>
)

const mdComponents = { a: ExternalLink }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface HastText { type: 'text'; value: string }
interface HastElement { type: 'element'; tagName: string; properties?: Record<string, unknown>; children: HastNode[] }
type HastNode = HastText | HastElement | { type: string; value?: string; children?: HastNode[] }

const SKIP_TAGS = new Set(['code', 'pre'])

// rehype plugin: wrap keyword matches in rendered text nodes with <mark>
const createHighlightPlugin = (keyword: string) => () => (tree: HastNode) => {
  const re = new RegExp(escapeRegExp(keyword), 'gi')

  const visit = (node: HastElement | { children?: HastNode[] }) => {
    const children = node.children
    if (!children) return
    const next: HastNode[] = []
    for (const child of children) {
      if (child.type === 'text' && typeof (child as HastText).value === 'string') {
        const value = (child as HastText).value
        re.lastIndex = 0
        let last = 0
        let m: RegExpExecArray | null
        let matched = false
        while ((m = re.exec(value)) !== null) {
          matched = true
          if (m.index > last) next.push({ type: 'text', value: value.slice(last, m.index) })
          next.push({
            type: 'element',
            tagName: 'mark',
            properties: { className: ['search-highlight-match'] },
            children: [{ type: 'text', value: m[0] }],
          })
          last = m.index + m[0].length
          if (m[0].length === 0) re.lastIndex++
        }
        if (!matched) { next.push(child); continue }
        if (last < value.length) next.push({ type: 'text', value: value.slice(last) })
      } else {
        if (child.type === 'element' && !SKIP_TAGS.has((child as HastElement).tagName)) {
          visit(child as HastElement)
        } else if (child.type === 'root') {
          visit(child as { children?: HastNode[] })
        }
        next.push(child)
      }
    }
    node.children = next
  }

  visit(tree as { children?: HastNode[] })
}

interface MarkdownPreviewProps {
  content: string
  fontSizePx: number
  highlightKeyword?: string | null
}

const MarkdownPreview = ({ content, fontSizePx, highlightKeyword }: MarkdownPreviewProps) => {
  const { t } = useTranslation('workspace')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [currentIndex, setCurrentIndex] = useState(0)

  const activeKeyword = (searchOpen ? query.trim() : (highlightKeyword || '')).trim()

  const rehypePlugins = useMemo(
    () => (activeKeyword ? [createHighlightPlugin(activeKeyword)] : []),
    [activeKeyword],
  )

  // A new keyword resets navigation to the first match.
  useEffect(() => { setCurrentIndex(0) }, [activeKeyword])

  // After render, count matches, mark the current one and scroll it into view.
  useLayoutEffect(() => {
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>('.search-highlight-match')
    const count = nodes?.length ?? 0
    setMatchCount(prev => (prev === count ? prev : count))
    nodes?.forEach(n => n.classList.remove('search-highlight-active'))
    if (!nodes || count === 0) return
    const idx = ((currentIndex % count) + count) % count
    const active = nodes[idx]
    active.classList.add('search-highlight-active')
    if (typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeKeyword, content, currentIndex])

  const goNext = useCallback(() => {
    setCurrentIndex(i => (matchCount === 0 ? 0 : (i + 1) % matchCount))
  }, [matchCount])

  const goPrev = useCallback(() => {
    setCurrentIndex(i => (matchCount === 0 ? 0 : (i - 1 + matchCount) % matchCount))
  }, [matchCount])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setQuery('')
  }, [])

  // ⌘F / Ctrl+F opens the in-document search, but only while this preview is visible.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || e.shiftKey) return
      const container = containerRef.current
      if (!container || container.offsetParent === null) return
      e.preventDefault()
      e.stopPropagation()
      setSearchOpen(true)
      const selected = window.getSelection()?.toString().trim()
      if (selected) setQuery(selected)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!searchOpen) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [searchOpen])

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) goPrev()
      else goNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeSearch()
    }
  }

  const displayIndex = matchCount > 0 ? (((currentIndex % matchCount) + matchCount) % matchCount) + 1 : 0

  return (
    <div className="relative h-full">
      {searchOpen && (
        <div className="absolute top-2 right-4 z-10 flex items-center gap-1 px-2 py-1 rounded-md bg-bg-secondary border border-border-subtle shadow-lg">
          <Search size={12} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={t('ide.findPlaceholder')}
            className="bg-transparent outline-none text-xs text-text-primary w-40 placeholder:text-text-muted"
          />
          <span className="text-[11px] text-text-muted tabular-nums min-w-[44px] text-center shrink-0">
            {displayIndex} / {matchCount}
          </span>
          <button
            type="button"
            onClick={goPrev}
            title={t('ide.findPrev')}
            disabled={matchCount === 0}
            className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={goNext}
            title={t('ide.findNext')}
            disabled={matchCount === 0}
            className="p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-40"
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            onClick={closeSearch}
            title={t('ide.findClose')}
            className={cn('p-0.5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors')}
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div ref={containerRef} className="h-full overflow-auto bg-bg-primary p-4">
        <div className="md-preview max-w-[760px] mx-auto" style={{ fontSize: `${fontSizePx}px` }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdComponents}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}

export default MarkdownPreview
