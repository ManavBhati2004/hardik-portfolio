import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { sceneStore } from '../scene/store'

gsap.registerPlugin(SplitText, ScrollTrigger)

/* ─────────────────────────────────────────────────────────────────────────────
   Masked text reveals. Every reveal is a translate out of an overflow-clipped
   wrapper (y 110% → 0) — never a plain fade.
   ───────────────────────────────────────────────────────────────────────────── */

export const EASE_REVEAL = 'expo.out'
export const EASE_TRANSITION = 'power3.inOut'

/** Split into masked lines. Returns the line elements (already hidden). */
export function splitLines(el: Element): { lines: Element[]; split: SplitText } {
  const split = SplitText.create(el, { type: 'lines', mask: 'lines', linesClass: 'split-line' })
  gsap.set(split.lines, { yPercent: 110 })
  return { lines: split.lines, split }
}

/** Split into masked characters. */
export function splitChars(el: Element): { chars: Element[]; split: SplitText } {
  const split = SplitText.create(el, { type: 'chars', mask: 'chars', charsClass: 'split-char' })
  gsap.set(split.chars, { yPercent: 110 })
  return { chars: split.chars, split }
}

/**
 * Line-by-line masked reveal, triggered once at ~80% viewport.
 * Reduced motion: lines simply appear (opacity), no translate.
 */
export function revealLinesOnScroll(targets: Element[], opts: { start?: string; stagger?: number; delay?: number } = {}) {
  const splits: SplitText[] = []
  targets.forEach((el) => {
    if (sceneStore.reducedMotion) {
      gsap.fromTo(el, { opacity: 0 }, {
        opacity: 1, duration: 0.6,
        scrollTrigger: { trigger: el, start: opts.start ?? 'top 80%', once: true },
      })
      return
    }
    // autoSplit re-splits when fonts load or the width changes (phone rotation, resize),
    // so lines never keep stale breaks. Once revealed, a re-split simply stays visible.
    let revealed = false
    const delay = Number((el as HTMLElement).dataset?.delay) || opts.delay || 0
    const split = SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit(self) {
        if (revealed) return
        gsap.set(self.lines, { yPercent: 110 })
        return gsap.to(self.lines, {
          yPercent: 0,
          duration: 1.1,
          ease: EASE_REVEAL,
          stagger: opts.stagger ?? 0.08,
          delay,
          scrollTrigger: {
            trigger: el,
            start: opts.start ?? 'top 80%',
            once: true,
            onEnter: () => {
              revealed = true
            },
          },
        })
      },
    })
    splits.push(split)
  })
  return () => splits.forEach((s) => s.revert())
}
