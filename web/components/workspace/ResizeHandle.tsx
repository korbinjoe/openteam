import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'

interface ResizeHandleProps {
  // Side this handle sits on. 'right' = handle on right edge of left panel (drag right grows panel).
  // 'left' = handle on left edge of right panel (drag left grows panel).
  side: 'left' | 'right'
  // Either supply currentWidth (static state-driven width) OR getStartWidth (function read at
  // mousedown — used when the panel renders via percentage / flex and needs a DOM measurement).
  currentWidth?: number
  getStartWidth?: () => number
  onResize: (newWidth: number) => void
  onReset?: () => void
  ariaLabel?: string
}

const ResizeHandle = ({ side, currentWidth, getStartWidth, onResize, onReset, ariaLabel }: ResizeHandleProps) => {
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    startX.current = e.clientX
    startWidth.current = getStartWidth ? getStartWidth() : (currentWidth ?? 0)
    setDragging(true)
  }, [currentWidth, getStartWidth])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - startX.current
      const next = side === 'right' ? startWidth.current + delta : startWidth.current - delta
      onResize(next)
    }
    const handleUp = () => setDragging(false)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [dragging, side, onResize])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel || 'Resize panel'}
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      className={cn(
        'absolute top-0 bottom-0 w-1 z-20 cursor-col-resize group',
        side === 'right' ? '-right-0.5' : '-left-0.5',
      )}
      title={onReset ? 'Drag to resize · double-click to reset' : 'Drag to resize'}
    >
      <div
        className={cn(
          'absolute top-0 bottom-0 left-1/2 -translate-x-1/2 transition-all duration-150',
          dragging
            ? 'w-0.5 bg-accent-brand'
            : 'w-px bg-transparent group-hover:bg-accent-brand/60 group-hover:w-0.5',
        )}
      />
    </div>
  )
}

export default ResizeHandle
