import { gsap } from 'gsap'
import { sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Ink-bleed reveal.

   A mask image (generated once per corner on a small canvas) is opaque on one
   side of a diagonal and transparent on the other, with an fbm-noise displaced,
   feathered front — soft, uneven, organic edges like ink soaking into paper.
   The mask is 3× the element; sliding mask-position sweeps that front across
   the element from one corner. Works on any HTML (images, video, text, SVG).
   ───────────────────────────────────────────────────────────────────────────── */

export type InkCorner = 'tl' | 'tr' | 'bl' | 'br'

const SIZE = 384
const cache: Partial<Record<InkCorner, string>> = {}

function hash(x: number, y: number, s: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453
  return h - Math.floor(h)
}
function vnoise(x: number, y: number, s: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
function fbm(x: number, y: number, s: number) {
  let v = 0, amp = 0.5, f = 1
  for (let i = 0; i < 5; i++) {
    v += amp * vnoise(x * f, y * f, s + i * 13.1)
    f *= 2.07
    amp *= 0.5
  }
  return v
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function buildMask(corner: InkCorner): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(SIZE, SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let u = x / (SIZE - 1)
      let v = y / (SIZE - 1)
      if (corner === 'tr' || corner === 'br') u = 1 - u
      if (corner === 'bl' || corner === 'br') v = 1 - v
      // distance along the diagonal from the origin corner
      const d = (u + v) * 0.5
      // ink front displacement: large slow lobes + fine fibres
      const n = (fbm(u * 5, v * 5, 1.7) - 0.5) * 0.16 + (fbm(u * 22, v * 22, 9.3) - 0.5) * 0.04
      const a = 1 - smooth(0.47, 0.53, d + n)
      const i = (y * SIZE + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0
      img.data[i + 3] = Math.round(a * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

export function inkMaskUrl(corner: InkCorner): string {
  return (cache[corner] ??= buildMask(corner))
}

/* mask-position start (hidden) → end (shown) per corner */
const POS: Record<InkCorner, [string, string]> = {
  tl: ['100% 100%', '0% 0%'],
  tr: ['0% 100%', '100% 0%'],
  bl: ['100% 0%', '0% 100%'],
  br: ['0% 0%', '100% 100%'],
}

export interface InkOptions {
  from?: InkCorner
  duration?: number
  delay?: number
  ease?: string
}

/** Prepare an element so it is hidden behind the ink mask. */
export function inkHide(el: HTMLElement | SVGElement, from: InkCorner = 'tl') {
  const url = `url(${inkMaskUrl(from)})`
  const s = el.style as CSSStyleDeclaration & { webkitMaskImage: string; webkitMaskPosition: string }
  el.classList.add('ink')
  s.webkitMaskImage = url
  s.maskImage = url
  s.webkitMaskPosition = POS[from][0]
  s.maskPosition = POS[from][0]
}

function clearMask(el: HTMLElement | SVGElement) {
  const s = el.style as CSSStyleDeclaration & { webkitMaskImage: string; webkitMaskPosition: string }
  el.classList.remove('ink')
  s.webkitMaskImage = ''
  s.maskImage = ''
  s.webkitMaskPosition = ''
  s.maskPosition = ''
}

/** Animate the ink front across the element. Returns the tween. */
export function inkReveal(el: HTMLElement | SVGElement, opts: InkOptions = {}): gsap.core.Tween {
  const from = opts.from ?? 'tl'
  if (sceneStore.reducedMotion) {
    clearMask(el)
    return gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: opts.delay ?? 0 })
  }
  inkHide(el, from)
  const state = { p: 0 }
  const [a, b] = POS[from]
  const [ax, ay] = a.split(' ').map(parseFloat)
  const [bx, by] = b.split(' ').map(parseFloat)
  const s = el.style as CSSStyleDeclaration & { webkitMaskPosition: string }
  return gsap.to(state, {
    p: 1,
    duration: opts.duration ?? 1.6,
    delay: opts.delay ?? 0,
    ease: opts.ease ?? 'power2.inOut',
    onUpdate: () => {
      const pos = `${ax + (bx - ax) * state.p}% ${ay + (by - ay) * state.p}%`
      s.webkitMaskPosition = pos
      s.maskPosition = pos
    },
    onComplete: () => clearMask(el),
  })
}
