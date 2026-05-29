import { useEffect, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const rehypePlugins = useMemo(
    () => (highlightKeyword ? [createHighlightPlugin(highlightKeyword)] : []),
    [highlightKeyword],
  )

  useEffect(() => {
    if (!highlightKeyword) return
    const first = containerRef.current?.querySelector('.search-highlight-match')
    if (first instanceof HTMLElement && typeof first.scrollIntoView === 'function') {
      first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [highlightKeyword, content])

  return (
    <div ref={containerRef} className="h-full overflow-auto bg-bg-primary p-4">
      <div className="md-preview max-w-[760px] mx-auto" style={{ fontSize: `${fontSizePx}px` }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={mdComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  )
}

export default MarkdownPreview
