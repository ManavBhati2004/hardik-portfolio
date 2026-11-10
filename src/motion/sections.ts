import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { emitSceneEvent, sceneStore } from '../scene/store'
import { inkHide, inkReveal, type InkCorner } from './inkMask'
import { revealLinesOnScroll } from './split'

gsap.registerPlugin(ScrollTrigger)
// mobile browsers resize the viewport when the address bar shows/hides: don't re-layout pins for that
ScrollTrigger.config({ ignoreMobileResize: true })

/* ─────────────────────────────────────────────────────────────────────────────
   Section choreography. Owns (writes) these store fields, scroll-scrubbed:
   cameraT, section, dim, fogThicken, katanaSink, katanaFinale.
   Section offsets are cached on every ScrollTrigger refresh (pin spacers included),
   then the mapping runs on the GSAP ticker from the Lenis-smoothed scroll — so the
   3D journey, the counter and the HTML all share one clock and reverse cleanly.
   ───────────────────────────────────────────────────────────────────────────── */

export const SECTION_IDS = ['hero', 'craft', 'work', 'gallery', 'contact'] as const

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function setupSections(): () => void {
  let tops: number[] = []
  let maxScroll = 1

  const measure = () => {
    const y = window.scrollY
    tops = SECTION_IDS.map((id) => {
      const el = document.getElementById(id)
      return el ? el.getBoundingClientRect().top + y : 0
    })
    maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    if (import.meta.env.DEV) (window as unknown as { __tops: unknown }).__tops = { tops, maxScroll }
  }
  measure()
  ScrollTrigger.addEventListener('refresh', measure)

  let lastSection = -1
  let scrollHintGone = false

  // re-measure whenever the document height changes (late images, lazy layout, resizes)
  let lastHeight = 0
  let frame = 0
  const tick = () => {
    if (++frame % 30 === 0) {
      const h = document.documentElement.scrollHeight
      if (h !== lastHeight) {
        lastHeight = h
        measure()
      }
    }
    const y = sceneStore.scrollY
    const vh = window.innerHeight
    // cameraT: transition into section i+1 while its top travels from the bottom to the top of the viewport
    let t = 0
    for (let i = 0; i < tops.length - 1; i++) {
      const end = Math.min(tops[i + 1], maxScroll)
      const start = Math.max(0, Math.min(tops[i + 1] - vh, end - 1))
      t = i + clamp01((y - start) / Math.max(1, end - start))
      if (y < end) break
    }
    sceneStore.cameraT = t

    sceneStore.katanaSink = smooth(0.12, 0.85, y / vh)
    sceneStore.katanaFinale = clamp01((t - 3.3) / 0.7)
    sceneStore.fogThicken = Math.max(0, 1 - Math.abs(t - 1))
    sceneStore.dim = smooth(0.3, 1, t) * (1 - smooth(3.2, 3.9, t)) * 0.6 + Math.max(0, 1 - Math.abs(t - 2)) * 0.4

    const section = Math.min(SECTION_IDS.length - 1, Math.round(t))
    if (section !== lastSection) {
      lastSection = section
      sceneStore.section = section
      emitSceneEvent('section')
    }

    if (!scrollHintGone && y > 40) {
      scrollHintGone = true
      gsap.to('.hero-scroll > *', { opacity: 0, duration: 0.6, ease: 'power2.out' })
    } else if (scrollHintGone && y < 10 && sceneStore.introDone) {
      scrollHintGone = false
      gsap.to('.hero-scroll > *', { opacity: 1, duration: 0.8, ease: 'power2.out' })
    }
  }
  gsap.ticker.add(tick)

  return () => {
    gsap.ticker.remove(tick)
    ScrollTrigger.removeEventListener('refresh', measure)
  }
}

/**
 * Generic scroll reveals for a root element:
 * [data-reveal="lines"] masked line-by-line (0.08 s stagger, once at 80%)
 * [data-reveal="ink"]   organic ink-bleed from a corner (data-ink="tl|tr|bl|br")
 * [data-reveal="rise"]  short masked rise for single items
 */
export function setupReveals(root: Element): () => void {
  const ctx = gsap.context(() => {
    const lines = Array.from(root.querySelectorAll('[data-reveal="lines"]'))
    const undoLines = revealLinesOnScroll(lines)

    root.querySelectorAll<HTMLElement>('[data-reveal="ink"]').forEach((el) => {
      const from = (el.dataset.ink as InkCorner) || 'tl'
      if (!sceneStore.reducedMotion) inkHide(el, from)
      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        once: true,
        onEnter: () => {
          inkReveal(el, { from, duration: Number(el.dataset.inkDuration) || 1.6, delay: Number(el.dataset.delay) || 0 })
        },
      })
    })

    root.querySelectorAll<HTMLElement>('[data-reveal="rise"]').forEach((el) => {
      gsap.fromTo(
        el,
        { opacity: 0, y: sceneStore.reducedMotion ? 0 : 24 },
        {
          opacity: 1,
          y: 0,
          duration: 1.1,
          ease: 'expo.out',
          delay: Number(el.dataset.delay) || 0,
          scrollTrigger: { trigger: el, start: 'top 85%', once: true },
        }
      )
    })

    return undoLines
  }, root)
  return () => ctx.revert()
}
