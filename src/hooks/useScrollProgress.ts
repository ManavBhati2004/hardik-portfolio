import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { sceneStore } from '../scene/store'

gsap.registerPlugin(ScrollTrigger)

// Global Lenis singleton for unified smooth scrolling across components
let globalLenis: Lenis | null = null

export function getLenis(): Lenis | null {
  return globalLenis
}

const resolve = (target: string | HTMLElement) =>
  typeof target === 'string' ? (target.startsWith('#') ? target : `#${target}`) : target

/** Smooth animated scroll to a section element or id. */
export function scrollToTarget(target: string | HTMLElement, offset = 0) {
  const resolved = resolve(target)
  if (globalLenis) {
    globalLenis.scrollTo(resolved, {
      offset,
      duration: 1.4,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    })
  } else {
    const el = typeof resolved === 'string' ? document.querySelector(resolved) : resolved
    el?.scrollIntoView({ behavior: 'smooth' })
  }
}

/** Instant jump (used underneath the blade-slash wipe). */
export function jumpTo(target: string | HTMLElement) {
  const resolved = resolve(target)
  if (globalLenis) {
    globalLenis.scrollTo(resolved, { immediate: true, force: true })
  } else {
    const el = typeof resolved === 'string' ? document.querySelector(resolved) : resolved
    el?.scrollIntoView()
  }
  ScrollTrigger.update()
}

/**
 * Smooth scrolling (Lenis) driven from GSAP's ticker, so Lenis, ScrollTrigger
 * and the 3D scene all share one clock. Scroll values are written to the
 * mutable scene store (read in useFrame) — no React state, no re-renders.
 */
export function useScrollProgress() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.35,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: !sceneStore.reducedMotion,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.5,
    })
    globalLenis = lenis
    // hold the page still until the preloader hands off (it calls lenis.start())
    if (!sceneStore.introStarted) lenis.stop()
    if (import.meta.env.DEV) (window as unknown as { __lenis: Lenis }).__lenis = lenis

    const onScroll = (e: Lenis) => {
      sceneStore.scrollY = e.scroll
      sceneStore.progress = e.progress
      sceneStore.velocity = e.velocity
      sceneStore.heroProgress = Math.min(1, Math.max(0, e.scroll / Math.max(1, window.innerHeight)))
      ScrollTrigger.update()
    }
    lenis.on('scroll', onScroll)

    const tick = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)

    return () => {
      gsap.ticker.remove(tick)
      lenis.destroy()
      globalLenis = null
    }
  }, [])
}

export default useScrollProgress
