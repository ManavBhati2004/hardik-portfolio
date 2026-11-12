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
    // fog swells while the camera travels low over the water, then thins at the shrine so the torii reads
    sceneStore.fogThicken = Math.max(0, 1 - Math.abs(t - 0.5) * 2.2) * 0.8
    sceneStore.dim = smooth(0.3, 1, t) * (1 - smooth(3.2, 3.9, t)) * 0.45 + Math.max(0, 1 - Math.abs(t - 2)) * 0.45

    const section = Math.min(SECTION_IDS.length - 1, Math.round(t))
    if (section !== lastSection) {
      lastSection = section
      sceneStore.section = section
      emitSceneEvent('section')
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
 * [data-reveal="brush"] a brush stroke drawn left to right
 * [data-reveal="stamp"] a seal pressed onto the paper
 * [data-reveal="unroll"] a scroll unrolling downward: [data-unroll-body] opens, [data-unroll-rod] travels with its edge
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

    root.querySelectorAll<HTMLElement>('[data-reveal="brush"]').forEach((el) => {
      gsap.fromTo(
        el,
        { clipPath: sceneStore.reducedMotion ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)', opacity: sceneStore.reducedMotion ? 0 : 1 },
        {
          clipPath: 'inset(0 0% 0 0)',
          opacity: 1,
          duration: 1.3,
          ease: 'power2.inOut',
          delay: Number(el.dataset.delay) || 0,
          scrollTrigger: { trigger: el, start: 'top 97%', once: true },
        }
      )
    })

    root.querySelectorAll<HTMLElement>('[data-reveal="stamp"]').forEach((el) => {
      gsap.fromTo(
        el,
        { opacity: 0, scale: sceneStore.reducedMotion ? 1 : 1.7, rotation: sceneStore.reducedMotion ? -4 : -16 },
        {
          opacity: 1,
          scale: 1,
          rotation: -4,
          duration: 0.5,
          ease: 'power4.in',
          delay: Number(el.dataset.delay) || 0,
          scrollTrigger: { trigger: el, start: 'top 97%', once: true },
        }
      )
    })

    root.querySelectorAll<HTMLElement>('[data-reveal="unroll"]').forEach((el) => {
      const undoUnroll = unrollOnScroll(el, Number(el.dataset.delay) || 0)
      void undoUnroll
    })

    return undoLines
  }, root)
  return () => ctx.revert()
}

/**
 * A hanging scroll unrolling: the body opens downward (clip), the bottom rod rides its
 * lower edge, then the whole scroll settles with a small sway from its hanging point.
 * Must run inside a gsap.context (it is reverted with it).
 */
export function unrollOnScroll(el: HTMLElement, delay = 0, onOpen?: () => void) {
  const body = el.querySelector<HTMLElement>('[data-unroll-body]') ?? el
  const rod = el.querySelector<HTMLElement>('[data-unroll-rod]')
  const reduced = sceneStore.reducedMotion
  if (reduced) {
    gsap.set(el, { opacity: 0 })
  } else {
    gsap.set(body, { clipPath: 'inset(0 -40px 100% -40px)' })
    if (rod) gsap.set(rod, { y: () => -body.offsetHeight })
  }
  return ScrollTrigger.create({
    trigger: el,
    start: 'top 86%',
    once: true,
    onEnter: () => {
      if (reduced) {
        gsap.to(el, { opacity: 1, duration: 0.6, delay })
        onOpen?.()
        return
      }
      const tl = gsap.timeline({ delay })
      tl.to(body, { clipPath: 'inset(0 -40px 0% -40px)', duration: 1.5, ease: 'power3.inOut' }, 0)
      if (rod) tl.fromTo(rod, { y: -body.offsetHeight }, { y: 0, duration: 1.5, ease: 'power3.inOut' }, 0)
      tl.fromTo(el, { rotation: 0 }, { keyframes: [{ rotation: 0.7, duration: 0.5 }, { rotation: -0.35, duration: 0.7 }, { rotation: 0, duration: 0.8 }], ease: 'sine.inOut', transformOrigin: '50% 0%' }, 1.1)
      tl.add(() => onOpen?.(), 1.0)
    },
  })
}
