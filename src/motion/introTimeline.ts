import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { sceneStore } from '../scene/store'
import { inkHide, inkReveal } from './inkMask'

gsap.registerPlugin(SplitText)

/* ─────────────────────────────────────────────────────────────────────────────
   Hero intro — one master timeline (times relative to the end of the fog parting):
   0.0 moon at full presence
   0.2 katana rises out of the water (2.4 s, tip first)
   0.6 blossom branch eases in from beyond the top-left corner
   1.0 giant 侍 ink-brush reveal
   1.3 HARDIK GEHLOT per-character mask reveal + tracking settle
   1.7 subtitle tracking settle
   1.9 crimson rule draws left → right
   2.0 description line mask reveal
   2.2 button border draws around the rectangle, then label + arrow
   2.3 nav drops in
   2.5 vertical 暁の刃 top → bottom, then its line
   2.8 counter
   ───────────────────────────────────────────────────────────────────────────── */

const q = <T extends Element = HTMLElement>(name: string) => Array.from(document.querySelectorAll<T>(`[data-intro="${name}"]`))
const one = <T extends Element = HTMLElement>(name: string) => document.querySelector<T>(`[data-intro="${name}"]`)

let started = false
const introSplits: SplitText[] = []

export async function startIntro() {
  if (started) return
  started = true
  // split only once the display face is in, so line/char boxes are final
  try {
    await document.fonts.ready
  } catch {
    /* ignore */
  }

  const reveal = (els: Element | Element[] | null) => els && gsap.set(els, { visibility: 'visible' })

  if (sceneStore.reducedMotion) {
    document.querySelectorAll('[data-intro]').forEach((el) => gsap.set(el, { visibility: 'visible', opacity: 0 }))
    gsap
      .timeline({ onComplete: () => void (sceneStore.introDone = true) })
      .to(sceneStore, { katanaRise: 1, branchIn: 1, duration: 0.6, ease: 'none' }, 0)
      .to('[data-intro]', { opacity: 1, duration: 0.6, ease: 'power1.out' }, 0)
      .add(() => document.documentElement.classList.add('intro-done'))
    return
  }

  const tl = gsap.timeline({
    defaults: { ease: 'expo.out' },
    onComplete: () => {
      sceneStore.introDone = true
      document.documentElement.classList.add('intro-done')
      // the split wrappers were only for the entrance: restore plain text so it reflows on resize
      introSplits.forEach((s) => s.revert())
      const t = one('title')
      if (t) gsap.set(t, { clearProps: 'letterSpacing' })
    },
  })

  /* 3D */
  tl.to(sceneStore, { katanaRise: 1, duration: 2.4, ease: 'none' }, 0.2) // Katana applies expo.out itself
  tl.to(sceneStore, { branchIn: 1, duration: 1.8, ease: 'power3.out' }, 0.6)

  /* giant 侍: ink-brush sweep */
  const giant = one('kanji-giant')
  if (giant) {
    inkHide(giant, 'tl')
    tl.add(() => {
      reveal(giant)
      inkReveal(giant, { from: 'tl', duration: 1.4, ease: 'power2.inOut' })
    }, 1.0)
  }

  /* title: per-character masks + letter-spacing settle */
  const title = one('title')
  if (title) {
    const split = SplitText.create(title, { type: 'chars', mask: 'chars' })
    introSplits.push(split)
    gsap.set(split.chars, { yPercent: 110 })
    gsap.set(title, { letterSpacing: '0.2em' })
    tl.add(() => reveal(title), 1.3)
    tl.to(split.chars, { yPercent: 0, duration: 1.2, stagger: 0.035 }, 1.3)
    tl.to(title, { letterSpacing: '0.12em', duration: 1.6, ease: 'expo.out' }, 1.3)
  }

  /* subtitle: very wide → final tracking */
  const sub = one('subtitle')
  if (sub) {
    gsap.set(sub, { letterSpacing: '1.1em', opacity: 0 })
    tl.add(() => reveal(sub), 1.7)
    tl.to(sub, { letterSpacing: '0.6em', opacity: 1, duration: 1.4, ease: 'expo.out' }, 1.7)
  }

  /* crimson rule */
  const rule = one('rule')
  if (rule) {
    gsap.set(rule, { scaleX: 0, transformOrigin: 'left center' })
    tl.add(() => reveal(rule), 1.9)
    tl.to(rule, { scaleX: 1, duration: 0.9, ease: 'power3.inOut' }, 1.9)
  }

  /* description: masked line */
  const desc = one('desc')
  if (desc) {
    const split = SplitText.create(desc, { type: 'lines', mask: 'lines' })
    introSplits.push(split)
    gsap.set(split.lines, { yPercent: 110 })
    tl.add(() => reveal(desc), 2.0)
    tl.to(split.lines, { yPercent: 0, duration: 1.1, stagger: 0.08 }, 2.0)
  }

  /* button: border draws around the rectangle, then label + arrow */
  const cta = one('cta')
  if (cta) {
    const rect = cta.querySelector('rect')
    const label = cta.querySelectorAll('.btn-line-label, .arrow-cycle')
    if (rect) gsap.set(rect, { strokeDasharray: 1, strokeDashoffset: 1 })
    gsap.set(label, { opacity: 0, x: -6 })
    tl.add(() => reveal(cta), 2.2)
    if (rect) tl.to(rect, { strokeDashoffset: 0, duration: 1.0, ease: 'power2.inOut' }, 2.2)
    tl.to(label, { opacity: 1, x: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out' }, 2.85)
    if (rect) tl.set(rect, { clearProps: 'strokeDasharray,strokeDashoffset' })
  }

  /* nav: logo, links (0.06 s stagger), pill */
  const navEls = [...q('nav-logo'), ...q('nav-link'), ...q('nav-cta')]
  gsap.set(navEls, { y: -12, opacity: 0 })
  tl.add(() => reveal(navEls), 2.3)
  tl.to(navEls, { y: 0, opacity: 1, duration: 1.0, stagger: 0.06, ease: 'power3.out' }, 2.3)

  /* vertical kanji: one character at a time, top → bottom, then its line */
  const vk = one('vkanji')
  const vline = one('vline')
  if (vk) {
    const chars = Array.from(vk.children)
    gsap.set(chars, { opacity: 0, y: -10, filter: 'blur(4px)' })
    tl.add(() => reveal(vk), 2.5)
    tl.to(chars, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.9, stagger: 0.16, ease: 'power3.out' }, 2.5)
  }
  if (vline) {
    gsap.set(vline, { scaleY: 0, transformOrigin: 'top center' })
    tl.add(() => reveal(vline), 3.0)
    tl.to(vline, { scaleY: 1, duration: 1.0, ease: 'power3.inOut' }, 3.0)
  }

  /* scroll indicator + counter */
  const tail = q('hud')
  gsap.set(tail, { opacity: 0 })
  tl.add(() => reveal(tail), 2.8)
  tl.to(tail, { opacity: 1, duration: 1.2, ease: 'power2.out', stagger: 0.1 }, 2.8)
}
