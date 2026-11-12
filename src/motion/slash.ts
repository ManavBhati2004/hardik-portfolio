import { gsap } from 'gsap'
import { jumpTo, scrollToTarget } from '../hooks/useScrollProgress'
import { emitSceneEvent, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Sliding paper doors (nav clicks only, about 1.2 s total):
   1. two fusuma — paper panels in wooden frames — slide shut from the sides
   2. Lenis jumps to the target behind them
   3. the doors slide open onto the new section, whose reveals then play
   Repeated clicks while busy are ignored (never queued).
   ───────────────────────────────────────────────────────────────────────────── */

let root: HTMLDivElement | null = null
let busy = false

function ensureDom() {
  if (root) return root
  root = document.createElement('div')
  root.className = 'slash'
  root.setAttribute('aria-hidden', 'true')
  root.innerHTML =
    '<div class="slash-panel fusuma fusuma--a washi"></div><div class="slash-panel fusuma fusuma--b washi"></div>'
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
  const a = el.querySelector<HTMLDivElement>('.fusuma--a')!
  const b = el.querySelector<HTMLDivElement>('.fusuma--b')!
  el.style.visibility = 'visible'

  gsap
    .timeline({
      defaults: { overwrite: true },
      onComplete: () => {
        el.style.visibility = 'hidden'
        busy = false
      },
    })
    .set(a, { xPercent: -102 })
    .set(b, { xPercent: 102 })
    // 1. the doors slide shut (a heavy start, a soft meeting)
    .to([a, b], { xPercent: 0, duration: 0.5, ease: 'power2.inOut' }, 0)
    // 2. jump behind them
    .add(() => {
      jumpTo(id)
      // the screen is covered: let the 3D layer cut straight to the new framing
      // (two frames: the section mapping on the GSAP ticker has written the new cameraT)
      requestAnimationFrame(() => requestAnimationFrame(() => emitSceneEvent('jump')))
    }, 0.52)
    // 3. a breath, then they slide open
    .to(a, { xPercent: -102, duration: 0.7, ease: 'power3.inOut' }, 0.62)
    .to(b, { xPercent: 102, duration: 0.7, ease: 'power3.inOut' }, 0.62)
}
