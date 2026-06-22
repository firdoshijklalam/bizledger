'use client'

import { useState, useRef, useCallback } from 'react'

interface UseLongPressOptions {
  onLongPress: () => void
  onClick?: () => void
  delay?: number
}

/**
 * Long-Press Multi-Selection Hook (PRD Part 7 §4).
 * Long press activates multi-select mode; single tap toggles selection.
 */
export function useLongPress({ onLongPress, onClick, delay = 500 }: UseLongPressOptions) {
  const [isLongPress, setIsLongPress] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = useCallback(() => {
    timer.current = setTimeout(() => {
      setIsLongPress(true)
      onLongPress()
    }, delay)
  }, [onLongPress, delay])

  const clear = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const handleTouchStart = useCallback(() => {
    start()
  }, [start])

  const handleTouchEnd = useCallback(() => {
    clear()
    if (!isLongPress && onClick) {
      onClick()
    }
    setIsLongPress(false)
  }, [clear, isLongPress, onClick])

  const handleMouseDown = useCallback(() => {
    start()
  }, [start])

  const handleMouseUp = useCallback(() => {
    clear()
    if (!isLongPress && onClick) {
      onClick()
    }
    setIsLongPress(false)
  }, [clear, isLongPress, onClick])

  const handleMouseLeave = useCallback(() => {
    clear()
  }, [clear])

  return {
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseLeave,
    },
  }
}
