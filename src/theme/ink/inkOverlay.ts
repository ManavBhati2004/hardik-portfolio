/*
 * Ink-bleed theme transition, adapted from "Ink Bleed" by Codemure
 * (https://www.codemure.com), MIT License, Copyright (c) 2026 Codemure.
 *
 * Flow on toggle (as in the reference reel — the ink covers EVERYTHING, text included):
 *  1. old screen = the current 3D frame (grabbed in the frame it was rendered, see
 *     ThemeCapture) + a viewport snapshot of the HTML (pre-captured, see htmlSnapshot)
 *  2. that frozen screen is shown on an overlay above the whole page
 *  3. the theme flips underneath: CSS tokens + the 3D scene switch instantly
 *  4. the ink spreads from the click and makes the frozen screen transparent,
 *     revealing the live page — scene and HTML — in the new theme
 *  5. toggling mid-spread freezes what is on screen and spreads again over it
 * Falls back to a CSS cross-fade without WebGL2 or with reduced motion.
 */
import gsap from 'gsap'
import { createNoiseTexture } from './noiseTexture'
import { FULLSCREEN_VERT, INK_FRAG } from './shaders'
import { applyTheme, getTheme, otherTheme, type Theme } from '../theme'
import { sceneStore } from '../../scene/store'
import { getHtmlSnapshot, setSnapshotPaused, startSnapshotKeeper } from './htmlSnapshot'

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
/** Pigment pooled at the frontier, keyed by the theme being revealed. */
const RIM: Record<Theme, [number, number, number]> = {
  dark: [0.0, 0.0, 0.01],
  light: [1.0, 0.996, 0.985],
}

/* ─── frame capture handshake with the R3F loop (see ThemeCapture.tsx) ─── */
type CaptureCb = (src: HTMLCanvasElement) => void
let pendingCapture: CaptureCb | null = null
export function takePendingCapture(): CaptureCb | null {
  const cb = pendingCapture
  pendingCapture = null
  return cb
}

const reducedMotion = () => sceneStore.reducedMotion

function compile(gl: WebGL2RenderingContext, type: GLenum, src: string) {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    throw new Error(`ink shader: ${gl.getShaderInfoLog(s) ?? ''}`)
  }
  return s
}

class InkRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vao: WebGLVertexArrayObject
  private noise: WebGLTexture
  private from: WebGLTexture
  private loc = new Map<string, WebGLUniformLocation | null>()
  scale = 1

  static create(canvas: HTMLCanvasElement): InkRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // kept so an interrupted spread can be frozen into the next "from" frame
      preserveDrawingBuffer: true,
    })
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
    this.from = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.from)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
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

  uploadFrom(src: TexImageSource) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.from)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src)
  }

  draw(f: {
    center: Point
    radius: number
    cleanup: number
    time: number
    seed: { x: number; y: number; angle: number }
    to: Theme
  }) {
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.from)
    gl.uniform1i(this.u('uFrom'), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.noise)
    gl.uniform1i(this.u('uNoise'), 1)
    gl.uniform1f(this.u('uCanvasScale'), this.scale)
    gl.uniform2f(this.u('uRes'), this.canvas.width, this.canvas.height)
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

export class InkOverlay {
  private renderer: InkRenderer | null
  private grab = document.createElement('canvas')
  private state = { progress: 0, time: 0 }
  private tween: gsap.core.Tween | null = null
  private fade: gsap.core.Tween | null = null
  private frame: { center: Point; maxDist: number; seed: { x: number; y: number; angle: number }; to: Theme } | null = null
  private cssTimer = 0
  private captureTimer = 0
  private preparing = false
  onMorph: ((to: Theme, duration: number, point: Point) => void) | null = null

  constructor(host: HTMLElement) {
    const canvas = document.createElement('canvas')
    canvas.className = 'ink-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    // above the whole page (content, nav, counter): the ink washes over everything
    host.appendChild(canvas)
    startSnapshotKeeper()
    this.renderer = InkRenderer.create(canvas)
    this.renderer?.resize()
    window.addEventListener('resize', () => this.renderer?.resize())
  }

  get busy() {
    return this.frame !== null
  }

  toggle(point?: Point) {
    const to = otherTheme(getTheme())
    const center = point ?? { x: window.innerWidth - 80, y: 40 }
    const sceneCanvas = document.querySelector<HTMLCanvasElement>('.canvas-container canvas:not(.ink-canvas)')

    if (!this.renderer || reducedMotion() || !sceneCanvas || !sceneStore.active) {
      this.crossFade(to, center)
      return
    }

    // Mid-spread: freeze exactly what is on screen (scene + HTML + overlay) as the new "from".
    const interrupting = this.frame !== null
    this.tween?.kill()
    this.fade?.kill()
    setSnapshotPaused(true)
    if (this.preparing) return
    this.preparing = true

    // the HTML snapshot must show the OLD theme: take it before anything flips
    // (instant when the idle keeper has a fresh one; otherwise ~0.1–0.25 s)
    void getHtmlSnapshot().then((html) => {
      this.preparing = false
      pendingCapture = (src) => {
        window.clearTimeout(this.captureTimer)
        this.start(src, html, to, center, interrupting)
      }
      this.armCaptureTimeout(to, center)
    })
  }

  private armCaptureTimeout(to: Theme, center: Point) {
    // the scene must render within a few frames; otherwise fall back
    window.clearTimeout(this.captureTimer)
    this.captureTimer = window.setTimeout(() => {
      if (pendingCapture) {
        pendingCapture = null
        this.crossFade(to, center)
      }
      // (generous: a slow GPU may take a few hundred ms to deliver the next frame)
    }, 700)
  }

  private start(src: HTMLCanvasElement, html: HTMLCanvasElement | null, to: Theme, center: Point, interrupting: boolean) {
    const r = this.renderer!
    r.resize()
    // compose the frozen frame at the overlay's resolution
    const g = this.grab
    g.width = r.canvas.width
    g.height = r.canvas.height
    const ctx = g.getContext('2d')!
    ctx.drawImage(src, 0, 0, g.width, g.height)
    if (html) ctx.drawImage(html, 0, 0, g.width, g.height)
    if (interrupting) ctx.drawImage(r.canvas, 0, 0, g.width, g.height)
    r.uploadFrom(g)

    const maxDist = farthestCorner(center)
    const seed = { x: Math.random() * 64 - 32, y: Math.random() * 64 - 32, angle: Math.random() * Math.PI * 2 }
    this.frame = { center, maxDist, seed, to }
    this.state.progress = 0
    this.state.time = 0
    this.draw()
    gsap.set(r.canvas, { opacity: 1 })
    r.canvas.classList.add('is-active')

    // the switch happens in this same frame, hidden by the overlay
    applyTheme(to)
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
        this.fade = gsap.to(r.canvas, {
          opacity: 0,
          duration: FADE_OUT,
          ease: 'none',
          onComplete: () => {
            this.fade = null
            this.frame = null
            r.canvas.classList.remove('is-active')
            setSnapshotPaused(false)
          },
        })
      },
    })
  }

  private draw() {
    const f = this.frame
    if (!f || !this.renderer) return
    const { progress, time } = this.state
    const linear = Math.min(1, time / DURATION)
    const ramp = Math.max(0, (linear - SPREAD.cleanupFrom) / (1 - SPREAD.cleanupFrom))
    const cleanup = ramp ** SPREAD.cleanupPow * f.maxDist * SPREAD.cleanupReach + Math.max(0, (linear - 0.97) / 0.03) * f.maxDist
    this.renderer.draw({ center: f.center, radius: progress * f.maxDist * SPREAD.growth, cleanup, time, seed: f.seed, to: f.to })
  }

  /** Plain CSS colour transition (no WebGL2, reduced motion, hidden canvas). */
  private crossFade(to: Theme, center: Point) {
    const root = document.documentElement
    root.classList.add('theme-fade')
    root.style.setProperty('--theme-fade', `${CSS_FADE_S}s`)
    applyTheme(to)
    setSnapshotPaused(false)
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
