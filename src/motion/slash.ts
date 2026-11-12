import { gsap } from 'gsap'
import { jumpTo, scrollToTarget } from '../hooks/useScrollProgress'
import { emitSceneEvent, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Blade-slash wipe (nav clicks only, ≤ 1.1 s total):
   1. a thin crimson→silver line streaks along the sword's diagonal (≈ −62°)
   2. the screen closes along that diagonal (two dark halves meet)
   3. Lenis jumps to the target underneath
   4. the halves slide apart onto the new section, whose reveals then play
   Repeated clicks while busy are ignored (never queued).
   ───────────────────────────────────────────────────────────────────────────── */

const ANGLE_DEG = 62
let root: HTMLDivElement | null = null
let busy = false

function ensureDom() {
  if (root) return root
  root = document.createElement('div')
  root.className = 'slash'
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML = `
    <div class="slash-panel slash-panel--a"></div>
    <div class="slash-panel slash-panel--b"></div>
    <div class="slash-line"></div>`
  document.body.appendChild(root)
  return root
}

export function isSlashBusy() {
  return busy
}

export function slashTo(id: string) {
  if (busy) return
  // reduced motion → plain smooth scroll, no wipe
  if (sceneStore.reducedMotion) {
    scrollToTarget(id)
    return
  }
  busy = true
  const el = ensureDom()
  const w = window.innerWidth
  const h = window.innerHeight
  const off = h / 2 / Math.tan((ANGLE_DEG * Math.PI) / 180)
  const xTop = w / 2 + off
  const xBot = w / 2 - off
  const a = el.querySelector<HTMLDivElement>('.slash-panel--a')!
  const b = el.querySelector<HTMLDivElement>('.slash-panel--b')!
  const line = el.querySelector<HTMLDivElement>('.slash-line')!

  a.style.clipPath = `polygon(0 0, ${xTop + 1}px 0, ${xBot + 1}px ${h}px, 0 ${h}px)`
  b.style.clipPath = `polygon(${xTop - 1}px 0, ${w}px 0, ${w}px ${h}px, ${xBot - 1}px ${h}px)`
  const len = Math.hypot(h, xTop - xBot) + 80
  const rot = (Math.atan2(h, xBot - xTop) * 180) / Math.PI
  gsap.set(line, { width: len, x: xTop + 40 * Math.cos(((rot + 180) * Math.PI) / 180), y: -40 * Math.sin((rot * Math.PI) / 180), rotation: rot, scaleX: 0, opacity: 1 })

  const shiftA = xTop + 40
  const shiftB = w - xBot + 40
  el.style.visibility = 'visible'

  gsap
    .timeline({
      defaults: { overwrite: true },
      onComplete: () => {
        el.style.visibility = 'hidden'
        busy = false
      },
    })
    .set([a, b], { x: (i) => (i === 0 ? -shiftA : shiftB), y: 0 })
    // 1. the cut
    .to(line, { scaleX: 1, duration: 0.35, ease: 'power4.out' }, 0)
    // 2. the halves close along it
    .to([a, b], { x: 0, duration: 0.3, ease: 'power3.in' }, 0.12)
    .to(line, { opacity: 0, duration: 0.15 }, 0.36)
    // 3. jump underneath
    .add(() => {
      jumpTo(id)
      // the screen is covered: let the 3D layer cut straight to the new framing
      // (two frames: the section mapping on the GSAP ticker has written the new cameraT)
      requestAnimationFrame(() => requestAnimationFrame(() => emitSceneEvent('jump')))
    }, 0.43)
    // 4. halves slide apart along the diagonal
    .to(a, { x: -shiftA, y: -60, duration: 0.6, ease: 'power3.inOut' }, 0.48)
    .to(b, { x: shiftB, y: 60, duration: 0.6, ease: 'power3.inOut' }, 0.48)
}
