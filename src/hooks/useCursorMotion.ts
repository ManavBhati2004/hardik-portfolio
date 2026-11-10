import { useRef, useEffect, useCallback } from 'react'

interface CursorState {
  /** Normalised x: -1 (left) to 1 (right) */
  x: number
  /** Normalised y: -1 (top) to 1 (bottom) */
  y: number
  /** Smoothed / damped x */
  smoothX: number
  /** Smoothed / damped y */
  smoothY: number
}

export function useCursorMotion(damping = 0.08) {
  const state = useRef<CursorState>({ x: 0, y: 0, smoothX: 0, smoothY: 0 })
  const rafId = useRef<number>(0)

  const handleMouseMove = useCallback((e: MouseEvent) => {
    state.current.x = (e.clientX / window.innerWidth) * 2 - 1
    state.current.y = (e.clientY / window.innerHeight) * 2 - 1
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove, { passive: true })

    const animate = () => {
      const s = state.current
      s.smoothX += (s.x - s.smoothX) * damping
      s.smoothY += (s.y - s.smoothY) * damping
      rafId.current = requestAnimationFrame(animate)
    }
    rafId.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(rafId.current)
    }
  }, [damping, handleMouseMove])

  return state
}

