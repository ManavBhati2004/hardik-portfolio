/*
 * Ink-bleed theme transition, adapted from "Ink Bleed" by Codemure
 * (https://www.codemure.com), MIT License, Copyright (c) 2026 Codemure.
 *
 * Flow on toggle (the ink covers EVERYTHING, text included):
 *  1. document.startViewTransition: the browser freezes the old screen itself
 *     (pixel-exact, 3D canvas and text included) and keeps the new page live
 *  2. the theme flips inside the transition callback: CSS tokens + the 3D scene
 *  3. each frame the ink shader writes its front to a tiny target; the read-back is
 *     traced into a contour and set as the clip-path of the live new page, so the new
 *     theme shows exactly inside the ink
 *  4. the overlay canvas (its own transition layer, above both) draws the pigment at
 *     the front: rim, tendrils, fibres, haze, speckles
 * Falls back to a CSS cross-fade without WebGL2 / View Transitions or with reduced motion.
 */
import gsap from 'gsap'
import { createNoiseTexture } from './noiseTexture'
import { FULLSCREEN_VERT, INK_FRAG } from './shaders'
import { applyTheme, getTheme, otherTheme, type Theme } from '../theme'
import { sceneStore } from '../../scene/store'

export interface Point {
  x: number
  y: number
}

/* Same feel as the reference */
const EASE = 'power3.out'
const DURATION = 1.4
const FADE_OUT = 0.15
const CSS_FADE_S = 0.45
const SPREAD = { growth: 0.7, cleanupFrom: 0.45, cleanupReach: 0.4, cleanupPow: 2 }
const PARAMS = { tendril: 1, noiseScale: 1, softness: 1.4, drift: 1 }
/** Pigment at the frontier, keyed by the theme being revealed. */
const RIM: Record<Theme, [number, number, number]> = {
  dark: [0.0, 0.0, 0.01],
  light: [0.953, 0.941, 0.918],
}
/** Field target width in samples (the clip contour is traced on this grid). */
const FIELD_W = 288
/** The clip follows the smooth front this many CSS px inside it (under the pigment band). */
const CLIP_LEVEL = -5

type Seed = { x: number; y: number; angle: number }
interface Frame {
  center: Point
  radius: number
  cleanup: number
  time: number
  seed: Seed
  to: Theme
}

const reducedMotion = () => sceneStore.reducedMotion

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error('ink shader: ' + (gl.getShaderInfoLog(s) ?? ''))
  }
  return s
}

class InkRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private noise: WebGLTexture
  private fieldTex: WebGLTexture
  private fieldFbo: WebGLFramebuffer
  private loc = new Map<string, WebGLUniformLocation | null>()
  private pixels = new Uint8Array(0)
  scale = 1
  fieldW = FIELD_W
  fieldH = 1
  /** decoded front distance (CSS px), fieldW × fieldH, rows top-down */
  field = new Float32Array(0)

  static create(canvas: HTMLCanvasElement): InkRenderer | null {
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!gl) return null
    try {
      return new InkRenderer(canvas, gl)
    } catch (err) {
      console.error(err)
      return null
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas
    this.gl = gl
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VERT))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, INK_FRAG))
    gl.linkProgram(p)
    this.program = p
    this.vao = gl.createVertexArray()!
    this.noise = createNoiseTexture(gl)
    this.fieldTex = gl.createTexture()!
    this.fieldFbo = gl.createFramebuffer()!
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.program, name))
    return this.loc.get(name) ?? null
  }

  resize() {
    const gl = this.gl
    this.scale = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2)
    const w = Math.round(window.innerWidth * this.scale)
    const h = Math.round(window.innerHeight * this.scale)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    const fh = Math.max(8, Math.round((FIELD_W * window.innerHeight) / Math.max(1, window.innerWidth)))
    if (fh !== this.fieldH || this.field.length !== FIELD_W * fh) {
      this.fieldH = fh
      this.field = new Float32Array(FIELD_W * fh)
      this.pixels = new Uint8Array(FIELD_W * fh * 4)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.fieldTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, FIELD_W, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fieldTex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
  }

  clear() {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  private bind(f: Frame) {
    const gl = this.gl
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.noise)
    gl.uniform1i(this.u('uNoise'), 1)
    gl.uniform2f(this.u('uCenter'), f.center.x, f.center.y)
    gl.uniform1f(this.u('uRadius'), f.radius)
    gl.uniform1f(this.u('uCleanup'), f.cleanup)
    gl.uniform1f(this.u('uTime'), f.time)
    gl.uniform1f(this.u('uRef'), Math.max(window.innerWidth, window.innerHeight))
    gl.uniform2f(this.u('uSeed'), f.seed.x, f.seed.y)
    const c = Math.cos(f.seed.angle)
    const s = Math.sin(f.seed.angle)
    gl.uniformMatrix2fv(this.u('uSeedRot'), false, [c, s, -s, c])
    gl.uniform1f(this.u('uTendril'), PARAMS.tendril)
    gl.uniform1f(this.u('uNoiseScale'), PARAMS.noiseScale)
    gl.uniform1f(this.u('uSoftness'), PARAMS.softness)
    gl.uniform1f(this.u('uDrift'), PARAMS.drift)
    gl.uniform3fv(this.u('uRimColor'), RIM[f.to])
  }

  /** Render the front distance at low resolution and read it back into `field`. */
  drawField(f: Frame) {
    const gl = this.gl
    const w = this.fieldW
    const h = this.fieldH
    this.bind(f)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFbo)
    gl.viewport(0, 0, w, h)
    gl.uniform2f(this.u('uRes'), w, h)
    gl.uniform2f(this.u('uCssPerPx'), window.innerWidth / w, window.innerHeight / h)
    gl.uniform1f(this.u('uFlipY'), 0)
    gl.uniform1f(this.u('uField'), 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const px = this.pixels
    const out = this.field
    for (let i = 0, n = w * h; i < n; i++) out[i] = ((px[i * 4] * 256 + px[i * 4 + 1]) / 65535 - 0.5) * 512
  }

  drawPigment(f: Frame) {
    const gl = this.gl
    this.bind(f)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height)
    gl.uniform2f(this.u('uCssPerPx'), 1 / this.scale, 1 / this.scale)
    gl.uniform1f(this.u('uFlipY'), 1)
    gl.uniform1f(this.u('uField'), 0)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}

/* ─── contour of the field (marching squares, traced into closed loops) ─── */
// edges of a cell: 0 top, 1 right, 2 bottom, 3 left; corner bits: tl 1, tr 2, br 4, bl 8
const CASES: number[][] = [
  [], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2],
  [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [3, 1], [0, 1], [3, 0], [],
]

class Contour {
  private cols = 0
  private rows = 0
  private v = new Float32Array(0)
  private xs = new Float32Array(0)
  private ys = new Float32Array(0)
  private ex = new Float32Array(0)
  private ey = new Float32Array(0)
  private link = new Int32Array(0) // per edge: up to 2 neighbouring edges
  private used: number[] = []

  /** Path data ("M…Z M…Z") of the region where field < level, in CSS px offset by (ox, oy). */
  build(field: Float32Array, fw: number, fh: number, level: number, ox: number, oy: number): string {
    // pad one ring of "outside" nodes well beyond the viewport so every loop closes off-screen
    const cols = fw + 2
    const rows = fh + 2
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols
      this.rows = rows
      this.v = new Float32Array(cols * rows)
      this.xs = new Float32Array(cols)
      this.ys = new Float32Array(rows)
      const edges = cols * rows * 2
      this.ex = new Float32Array(edges)
      this.ey = new Float32Array(edges)
      this.link = new Int32Array(edges * 2).fill(-1)
      this.used = []
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cw = vw / fw
    const ch = vh / fh
    const { v, xs, ys, ex, ey, link } = this
    for (let i = 0; i < cols; i++) xs[i] = i === 0 ? -2.5 * cw : i === cols - 1 ? vw + 2.5 * cw : (i - 0.5) * cw
    for (let j = 0; j < rows; j++) ys[j] = j === 0 ? -2.5 * ch : j === rows - 1 ? vh + 2.5 * ch : (j - 0.5) * ch
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const pad = i === 0 || j === 0 || i === cols - 1 || j === rows - 1
        v[j * cols + i] = pad ? 1 : field[(j - 1) * fw + (i - 1)] - level
      }
    }
    for (const e of this.used) link[e * 2] = link[e * 2 + 1] = -1
    const used: number[] = []
    this.used = used
    const V = cols * rows
    const edgeId = (i: number, j: number, side: number) =>
      side === 0 ? j * cols + i : side === 2 ? (j + 1) * cols + i : side === 3 ? V + j * cols + i : V + j * cols + i + 1
    const point = (e: number, a: number, b: number, horizontal: boolean) => {
      const t = v[a] / (v[a] - v[b])
      const ai = a % cols
      const aj = (a / cols) | 0
      if (horizontal) {
        ex[e] = xs[ai] + (xs[ai + 1] - xs[ai]) * t
        ey[e] = ys[aj]
      } else {
        ex[e] = xs[ai]
        ey[e] = ys[aj] + (ys[aj + 1] - ys[aj]) * t
      }
    }
    const connect = (a: number, b: number) => {
      if (link[a * 2] === -1 && link[a * 2 + 1] === -1) used.push(a)
      if (link[b * 2] === -1 && link[b * 2 + 1] === -1) used.push(b)
      link[a * 2 + (link[a * 2] === -1 ? 0 : 1)] = b
      link[b * 2 + (link[b * 2] === -1 ? 0 : 1)] = a
    }
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const tl = j * cols + i
        const tr = tl + 1
        const bl = tl + cols
        const br = bl + 1
        const c = (v[tl] < 0 ? 1 : 0) | (v[tr] < 0 ? 2 : 0) | (v[br] < 0 ? 4 : 0) | (v[bl] < 0 ? 8 : 0)
        if (c === 0 || c === 15) continue
        const segs = CASES[c]
        for (let k = 0; k < segs.length; k += 2) {
          const a = edgeId(i, j, segs[k])
          const b = edgeId(i, j, segs[k + 1])
          for (let n = 0; n < 2; n++) {
            const side = segs[k + n]
            const e = n === 0 ? a : b
            if (side === 0) point(e, tl, tr, true)
            else if (side === 2) point(e, bl, br, true)
            else if (side === 3) point(e, tl, bl, false)
            else point(e, tr, br, false)
          }
          connect(a, b)
        }
      }
    }
    // trace loops (each edge point has exactly two neighbours: the padding closes every loop)
    const parts: string[] = []
    for (const start of used) {
      if (link[start * 2] === -1) continue
      let prev = -1
      let cur = start
      let n = 0
      const pts: string[] = []
      while (cur !== -1 && n < 20000) {
        pts.push((n === 0 ? 'M' : 'L') + (ex[cur] + ox).toFixed(1) + ' ' + (ey[cur] + oy).toFixed(1))
        const a = link[cur * 2]
        const b = link[cur * 2 + 1]
        link[cur * 2] = link[cur * 2 + 1] = -1 // visited
        const next = a !== -1 && a !== prev ? a : b !== -1 && b !== prev ? b : -1
        prev = cur
        cur = next
        n++
        if (cur === start) break
      }
      if (n > 2) parts.push(pts.join('') + 'Z')
    }
    return parts.join('')
  }
}

function farthestCorner(p: Point) {
  const w = window.innerWidth
  const h = window.innerHeight
  return Math.max(Math.hypot(p.x, p.y), Math.hypot(w - p.x, p.y), Math.hypot(p.x, h - p.y), Math.hypot(w - p.x, h - p.y)) + 4
}

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void>; skipTransition: () => void }
type StartVT = (cb: () => void | Promise<void>) => ViewTransitionLike

const EMPTY_CLIP = 'path("M0 0Z")'

export class InkOverlay {
  private renderer: InkRenderer | null
  private contour = new Contour()
  private state = { progress: 0, time: 0 }
  private tween: gsap.core.Tween | null = null
  private frame: { center: Point; maxDist: number; seed: Seed; to: Theme; ox: number; oy: number } | null = null
  private clipRule: CSSStyleRule | null = null
  private cssTimer = 0
  private running = false
  onMorph: ((to: Theme, duration: number, point: Point) => void) | null = null

  constructor(host: HTMLElement) {
    const canvas = document.createElement('canvas')
    canvas.className = 'ink-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    // above the whole page (content, nav, counter): the ink washes over everything
    host.appendChild(canvas)
    this.renderer = InkRenderer.create(canvas)
    this.renderer?.resize()
    window.addEventListener('resize', () => this.renderer?.resize())
  }

  get busy() {
    return this.running
  }

  /** The one rule that clips the live new page during the transition. */
  private setClip(value: string) {
    if (!this.clipRule) {
      const style = document.createElement('style')
      document.head.appendChild(style)
      try {
        const i = style.sheet!.insertRule('html.ink-vt::view-transition-new(root){clip-path:' + EMPTY_CLIP + '}')
        this.clipRule = style.sheet!.cssRules[i] as CSSStyleRule
      } catch {
        return
      }
    }
    this.clipRule.style.setProperty('clip-path', value)
  }

  toggle(point?: Point) {
    if (this.running) return // one spread at a time
    const to = otherTheme(getTheme())
    const center = point ?? { x: window.innerWidth - 80, y: 40 }
    const startVT = (document as unknown as { startViewTransition?: StartVT }).startViewTransition
    const r = this.renderer

    if (!r || !startVT || reducedMotion() || document.hidden) {
      this.crossFade(to, center)
      return
    }

    this.running = true
    r.resize()
    r.clear()
    gsap.killTweensOf(r.canvas)
    gsap.set(r.canvas, { opacity: 1 })
    r.canvas.classList.add('is-active')
    const root = document.documentElement
    root.classList.add('ink-vt')
    this.setClip(EMPTY_CLIP)

    const vt = startVT.call(document, async () => {
      applyTheme(to)
      // let the 3D scene render in the new theme before the reveal starts
      await new Promise<void>((res) => {
        let done = false
        const fin = () => {
          if (!done) {
            done = true
            res()
          }
        }
        requestAnimationFrame(() => requestAnimationFrame(fin))
        window.setTimeout(fin, 180)
      })
    })

    // if the browser ends the transition early (resize, throttled tab), finish the ink at once
    const ended = () => {
      root.classList.remove('ink-vt')
      this.tween?.progress(1)
    }
    vt.finished.then(ended, ended)
    vt.ready.then(
      () => this.spread(vt, to, center),
      () => {
        // the transition could not start: make sure the theme is applied, without the ink
        if (getTheme() !== to) applyTheme(to)
        this.finish()
      }
    )
  }

  private spread(vt: ViewTransitionLike, to: Theme, center: Point) {
    const r = this.renderer!
    // where the layout viewport sits inside the transition's snapshot root (mobile URL bars)
    let ox = 0
    let oy = 0
    try {
      const m = getComputedStyle(document.documentElement, '::view-transition-group(ink-layer)').transform
      const nums = m.match(/-?[\d.]+(?:e-?\d+)?/g)?.map(Number)
      if (nums && nums.length >= 6) {
        ox = nums[nums.length === 16 ? 12 : 4] || 0
        oy = nums[nums.length === 16 ? 13 : 5] || 0
      }
    } catch {
      /* offsets stay 0 */
    }
    const seed = { x: Math.random() * 64 - 32, y: Math.random() * 64 - 32, angle: Math.random() * Math.PI * 2 }
    this.frame = { center, maxDist: farthestCorner(center), seed, to, ox, oy }
    this.state.progress = 0
    this.state.time = 0
    this.onMorph?.(to, DURATION, center)

    this.tween = gsap.to(this.state, {
      progress: 1,
      duration: DURATION,
      ease: EASE,
      onUpdate: () => {
        this.state.time = this.tween?.time() ?? 0
        this.draw()
      },
      onComplete: () => {
        this.tween = null
        this.frame = null
        // the whole page is the new theme now: end the transition, fade the last pigment
        this.setClip('none')
        vt.skipTransition()
        gsap.to(r.canvas, { opacity: 0, duration: FADE_OUT, ease: 'none', onComplete: () => this.finish() })
      },
    })
  }

  private finish() {
    const r = this.renderer
    if (r) {
      r.canvas.classList.remove('is-active')
      r.clear()
    }
    this.frame = null
    this.running = false
  }

  private draw() {
    const f = this.frame
    const r = this.renderer
    if (!f || !r) return
    const { progress, time } = this.state
    const linear = Math.min(1, time / DURATION)
    const ramp = Math.max(0, (linear - SPREAD.cleanupFrom) / (1 - SPREAD.cleanupFrom))
    const cleanup = ramp ** SPREAD.cleanupPow * f.maxDist * SPREAD.cleanupReach + Math.max(0, (linear - 0.97) / 0.03) * f.maxDist
    const frame: Frame = { center: f.center, radius: progress * f.maxDist * SPREAD.growth, cleanup, time, seed: f.seed, to: f.to }
    r.drawField(frame)
    const d = this.contour.build(r.field, r.fieldW, r.fieldH, CLIP_LEVEL, f.ox, f.oy)
    this.setClip(d ? 'path(evenodd, "' + d + '")' : EMPTY_CLIP)
    r.drawPigment(frame)
  }

  /** Plain CSS colour transition (no WebGL2 / View Transitions, reduced motion, hidden tab). */
  private crossFade(to: Theme, center: Point) {
    const root = document.documentElement
    root.classList.add('theme-fade')
    root.style.setProperty('--theme-fade', CSS_FADE_S + 's')
    applyTheme(to)
    this.onMorph?.(to, CSS_FADE_S * 1.6, center)
    window.clearTimeout(this.cssTimer)
    this.cssTimer = window.setTimeout(() => root.classList.remove('theme-fade'), CSS_FADE_S * 1000 + 50)
  }
}

let overlay: InkOverlay | null = null
export function getInkOverlay(): InkOverlay | null {
  if (!overlay) {
    overlay = new InkOverlay(document.body)
  }
  return overlay
}
