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
import { inkFrontPolygon } from './inkFront'
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
  private loc = new Map<string, WebGLUniformLocation | null>()
  scale = 1

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
  }

  private u(name: string) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.program, name))
    return this.loc.get(name) ?? null
  }

  resize() {
    this.scale = Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2)
    const w = Math.round(window.innerWidth * this.scale)
    const h = Math.round(window.innerHeight * this.scale)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
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

    // switch inside the transition and return at once: the browser pauses rendering while
    // this callback is pending, so waiting for frames here only delayed the ink (~200 ms).
    // The new page is a live layer, so the 3D scene shows its next frame in the new theme.
    const vt = startVT.call(document, () => {
      applyTheme(to)
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
    // the clip follows the same smooth front as the shader, traced on the CPU (no GPU read-back)
    const poly = inkFrontPolygon(
      {
        cx: f.center.x,
        cy: f.center.y,
        radius: frame.radius,
        cleanup,
        time,
        ref: Math.max(window.innerWidth, window.innerHeight),
        seedX: f.seed.x,
        seedY: f.seed.y,
        seedAngle: f.seed.angle,
        drift: PARAMS.drift,
        level: CLIP_LEVEL,
      },
      200,
      f.ox,
      f.oy
    )
    this.setClip(poly || EMPTY_CLIP)
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
