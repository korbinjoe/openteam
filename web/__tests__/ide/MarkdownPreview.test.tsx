// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import MarkdownPreview from '@/components/ide/MarkdownPreview'

afterEach(cleanup)

describe('MarkdownPreview search highlight', () => {
  it('wraps keyword matches in <mark> within rendered text', () => {
    const { container } = render(
      <MarkdownPreview content="Hello World, hello again" fontSizePx={14} highlightKeyword="hello" />,
    )
    const marks = container.querySelectorAll('mark.search-highlight-match')
    expect(marks.length).toBe(2)
    expect(Array.from(marks).map(m => m.textContent)).toEqual(['Hello', 'hello'])
  })

  it('does not highlight inside code spans/blocks', () => {
    const { container } = render(
      <MarkdownPreview content={'text foo\n\n`foo` and\n\n```\nfoo\n```'} fontSizePx={14} highlightKeyword="foo" />,
    )
    const marks = container.querySelectorAll('mark.search-highlight-match')
    expect(marks.length).toBe(1)
    expect(marks[0].textContent).toBe('foo')
  })

  it('renders no marks when keyword is absent', () => {
    const { container } = render(
      <MarkdownPreview content="nothing to see" fontSizePx={14} />,
    )
    expect(container.querySelectorAll('mark.search-highlight-match').length).toBe(0)
  })
})
