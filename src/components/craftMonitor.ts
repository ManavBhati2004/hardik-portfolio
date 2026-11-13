import type { LoopId } from '../data/craft'

/* ─────────────────────────────────────────────────────────────────────────────
   Craftsmanship program monitor — procedural placeholder loops (one per
   discipline), a vectorscope sampled from the monitor frame, and a stereo
   level envelope for the audio meter. Pure canvas 2D, no allocations per frame
   beyond gradients; the caller owns timing and visibility.
   Monitors stay "hardware dark" in both themes, as real reference screens do.
   ───────────────────────────────────────────────────────────────────────────── */

type Draw = (c: CanvasRenderingContext2D, w: number, h: number, t: number) => void

const TAU = Math.PI * 2
const fract = (x: number) => x - Math.floor(x)
const ease = (x: number) => {
  const k = Math.min(1, Math.max(0, x))
  return 1 - Math.pow(1 - k, 3)
}

function lin(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) {
  const g = c.createLinearGradient(x0, y0, x1, y1)
  for (const [o, col] of stops) g.addColorStop(o, col)
  return g
}
function rad(c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) {
  const g = c.createRadialGradient(x, y, 0, x, y, Math.max(1, r))
  for (const [o, col] of stops) g.addColorStop(o, col)
  return g
}

/* 01 — Video editing: four shots, hard cuts on the beat, a slow push-in inside each. */
const cuts: Draw = (c, w, h, t) => {
  const len = 1.15
  const shot = Math.floor(t / len) % 4
  const k = fract(t / len)
  const push = 1 + k * 0.06
  c.save()
  c.translate(w / 2, h / 2)
  c.scale(push, push)
  c.translate(-w / 2, -h / 2)
  if (shot === 0) {
    // dusk horizon, low sun
    c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#0b1020'], [0.55, '#3a1a2a'], [0.72, '#c2452e'], [1, '#120a0c']])
    c.fillRect(0, 0, w, h)
    c.fillStyle = rad(c, w * 0.62, h * 0.66, h * 0.5, [[0, 'rgba(255,190,120,0.95)'], [0.12, 'rgba(255,140,80,0.6)'], [1, 'rgba(255,90,60,0)']])
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#07060a'
    c.beginPath()
    c.moveTo(0, h * 0.74)
    for (let x = 0; x <= w; x += w / 16) c.lineTo(x, h * (0.72 + 0.04 * Math.sin(x * 0.02 + 1.3)))
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.fill()
  } else if (shot === 1) {
    // figure crossing a grid floor
    c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#0d0f14'], [0.6, '#1b1f29'], [1, '#08090c']])
    c.fillRect(0, 0, w, h)
    c.strokeStyle = 'rgba(160,180,220,0.18)'
    c.lineWidth = 1
    for (let i = -8; i <= 8; i++) {
      c.beginPath()
      c.moveTo(w / 2 + i * w * 0.02, h * 0.6)
      c.lineTo(w / 2 + i * w * 0.16, h)
      c.stroke()
    }
    for (let j = 0; j < 6; j++) {
      const y = h * 0.6 + Math.pow(j / 6, 1.8) * h * 0.4
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(w, y)
      c.stroke()
    }
    const fx = w * (0.2 + k * 0.5)
    c.fillStyle = '#e8e4dc'
    c.beginPath()
    c.arc(fx, h * 0.38, h * 0.045, 0, TAU)
    c.fill()
    c.fillRect(fx - h * 0.04, h * 0.43, h * 0.08, h * 0.2)
    c.fillStyle = rad(c, fx, h * 0.62, h * 0.12, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']])
    c.fillRect(0, 0, w, h)
  } else if (shot === 2) {
    // macro: lens / iris
    c.fillStyle = '#060608'
    c.fillRect(0, 0, w, h)
    const r = h * (0.36 + 0.02 * Math.sin(t * 3))
    c.fillStyle = rad(c, w / 2, h / 2, r, [[0, '#050505'], [0.28, '#140a08'], [0.45, '#7a2a1c'], [0.7, '#c8833e'], [0.92, '#2a1510'], [1, 'rgba(0,0,0,0)']])
    c.beginPath()
    c.arc(w / 2, h / 2, r, 0, TAU)
    c.fill()
    c.strokeStyle = 'rgba(255,220,180,0.25)'
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * TAU + t * 0.2
      c.beginPath()
      c.moveTo(w / 2 + Math.cos(a) * r * 0.35, h / 2 + Math.sin(a) * r * 0.35)
      c.lineTo(w / 2 + Math.cos(a) * r * 0.85, h / 2 + Math.sin(a) * r * 0.85)
      c.stroke()
    }
    c.fillStyle = 'rgba(255,255,255,0.7)'
    c.beginPath()
    c.arc(w / 2 - r * 0.25, h / 2 - r * 0.28, r * 0.06, 0, TAU)
    c.fill()
  } else {
    // night city, parallax blocks
    c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#060a14'], [0.7, '#14203a'], [1, '#05070c']])
    c.fillRect(0, 0, w, h)
    for (let layer = 0; layer < 3; layer++) {
      const shade = 10 + layer * 9
      c.fillStyle = `rgb(${shade},${shade + 2},${shade + 8})`
      const off = (k * 40 * (layer + 1)) % (w / 6)
      for (let i = -1; i < 9; i++) {
        const bx = i * (w / 7) - off + layer * 13
        const bh = h * (0.25 + 0.3 * fract(Math.sin((i + 1) * (layer + 3) * 12.9898) * 43758.5)) * (1 - layer * 0.15)
        c.fillRect(bx, h - bh, w / 8, bh)
        if (layer === 2) {
          c.fillStyle = 'rgba(255,200,120,0.55)'
          for (let wy = h - bh + 6; wy < h - 6; wy += 9) if (fract(Math.sin(wy * i) * 999) > 0.6) c.fillRect(bx + 5, wy, 3, 3)
          c.fillStyle = `rgb(${shade},${shade + 2},${shade + 8})`
        }
      }
    }
  }
  c.restore()
  // the cut itself: a one-frame flash
  if (k < 0.035) {
    c.fillStyle = 'rgba(255,255,255,0.12)'
    c.fillRect(0, 0, w, h)
  }
}

/* 02 — Motion graphics: kinetic type, rings and bars on an eased loop. */
const motion: Draw = (c, w, h, t) => {
  c.fillStyle = '#0a0a0d'
  c.fillRect(0, 0, w, h)
  const loop = 3.2
  const k = fract(t / loop)
  const words = ['TYPE', 'SHAPE', 'MOVE']
  const word = words[Math.floor(t / loop) % words.length]
  // rings
  c.lineWidth = Math.max(1.5, h * 0.012)
  for (let i = 0; i < 3; i++) {
    const r = h * (0.18 + i * 0.09)
    const a = t * (0.8 + i * 0.35) * (i % 2 ? -1 : 1)
    c.strokeStyle = i === 1 ? '#d4302f' : 'rgba(234,231,226,0.55)'
    c.beginPath()
    c.arc(w * 0.72, h * 0.5, r, a, a + TAU * (0.25 + 0.5 * ease(k * 1.6)))
    c.stroke()
  }
  // sliding bars
  for (let i = 0; i < 4; i++) {
    const p = ease((k - i * 0.06) * 2.2) - ease((k - 0.7 - i * 0.04) * 4)
    c.fillStyle = i === 0 ? '#d4302f' : `rgba(234,231,226,${0.18 + i * 0.12})`
    c.fillRect(w * 0.08, h * (0.62 + i * 0.055), w * 0.38 * p * (1 - i * 0.18), h * 0.02)
  }
  // masked word
  const inP = ease(k * 3)
  const outP = ease((k - 0.78) * 5)
  c.save()
  c.beginPath()
  c.rect(w * 0.08, h * 0.3, w * 0.55, h * 0.24)
  c.clip()
  c.fillStyle = '#eae7e2'
  c.font = `600 ${Math.round(h * 0.2)}px Inter, system-ui, sans-serif`
  c.textBaseline = 'alphabetic'
  c.fillText(word, w * 0.08, h * 0.5 + h * 0.24 * (1 - inP) - h * 0.24 * outP)
  c.restore()
  c.fillStyle = 'rgba(234,231,226,0.45)'
  c.font = `500 ${Math.round(h * 0.045)}px ui-monospace, Consolas, monospace`
  c.fillText(`KEY ${String(Math.floor(k * 24)).padStart(2, '0')}/24`, w * 0.08, h * 0.24)
}

/* 03 — Colour grading: a log / graded split with a travelling wipe. */
function landscape(c: CanvasRenderingContext2D, w: number, h: number, t: number) {
  c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#2f5d7a'], [0.5, '#e0a36a'], [0.62, '#f2c58a'], [1, '#2a2018']])
  c.fillRect(0, 0, w, h)
  c.fillStyle = rad(c, w * 0.3, h * 0.55, h * 0.35, [[0, 'rgba(255,236,200,0.95)'], [0.2, 'rgba(255,200,140,0.5)'], [1, 'rgba(255,180,120,0)']])
  c.fillRect(0, 0, w, h)
  const hills: [number, string, number][] = [
    [0.62, '#3f4a3a', 0.6],
    [0.7, '#2b3428', 1],
    [0.8, '#151a14', 1.6],
  ]
  for (const [y0, col, sp] of hills) {
    c.fillStyle = col
    c.beginPath()
    c.moveTo(0, h)
    for (let x = 0; x <= w; x += w / 24) c.lineTo(x, h * (y0 + 0.05 * Math.sin(x * 0.012 * sp + sp * 2 + t * 0.05)))
    c.lineTo(w, h)
    c.fill()
  }
}
const grade: Draw = (c, w, h, t) => {
  landscape(c, w, h, t)
  // graded side: contrast + teal / orange split via blend fills
  c.save()
  c.globalCompositeOperation = 'soft-light'
  c.fillStyle = lin(c, 0, 0, 0, h, [[0, 'rgba(0,120,140,0.9)'], [0.55, 'rgba(255,140,60,0.7)'], [1, 'rgba(0,40,60,0.9)']])
  c.fillRect(0, 0, w, h)
  c.restore()
  const split = w * (0.5 + 0.32 * Math.sin(t * 0.9))
  // log side: lifted, flat, desaturated
  c.save()
  c.beginPath()
  c.rect(0, 0, split, h)
  c.clip()
  landscape(c, w, h, t)
  c.globalCompositeOperation = 'saturation'
  c.fillStyle = 'rgba(128,128,128,0.75)'
  c.fillRect(0, 0, split, h)
  c.globalCompositeOperation = 'source-over'
  c.fillStyle = 'rgba(120,120,118,0.35)'
  c.fillRect(0, 0, split, h)
  c.restore()
  c.fillStyle = 'rgba(255,255,255,0.85)'
  c.fillRect(split - 0.75, 0, 1.5, h)
  c.font = `500 ${Math.round(h * 0.042)}px ui-monospace, Consolas, monospace`
  c.fillStyle = 'rgba(255,255,255,0.75)'
  c.fillText('LOG', Math.max(8, split - h * 0.18), h * 0.09)
  c.fillText('GRADE', Math.min(w - h * 0.24, split + 8), h * 0.09)
}

/* 04 — Sound: spectrum, centre waveform and a beat-led envelope. */
export function beat(t: number) {
  const b = fract(t / 0.5)
  return Math.exp(-b * 6)
}
const sound: Draw = (c, w, h, t) => {
  c.fillStyle = '#08090b'
  c.fillRect(0, 0, w, h)
  const n = 48
  const bw = w / n
  const env = beat(t)
  for (let i = 0; i < n; i++) {
    const f = i / n
    const v =
      0.18 +
      0.5 * env * Math.exp(-f * 3) +
      0.22 * (0.5 + 0.5 * Math.sin(t * 7 + i * 0.7)) * (1 - f) +
      0.1 * (0.5 + 0.5 * Math.sin(t * 13 + i * 1.9))
    const bh = Math.min(0.9, v) * h * 0.7
    c.fillStyle = f < 0.25 ? '#d4302f' : `rgba(234,231,226,${0.25 + 0.5 * (1 - f)})`
    c.fillRect(i * bw + 1, h * 0.85 - bh, bw - 2, bh)
  }
  c.strokeStyle = 'rgba(120,230,200,0.85)'
  c.lineWidth = 1.5
  c.beginPath()
  for (let x = 0; x <= w; x += 3) {
    const y = h * 0.3 + Math.sin(x * 0.08 + t * 9) * h * 0.06 * (0.4 + env) * Math.sin(x * 0.011 + t)
    if (x === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.stroke()
}

/* 05 — Real estate: one-point dolly through a lit hallway. */
const space: Draw = (c, w, h, t) => {
  c.fillStyle = lin(c, 0, 0, 0, h, [[0, '#1a1712'], [1, '#0b0a08']])
  c.fillRect(0, 0, w, h)
  const cx = w / 2
  const cy = h * 0.48
  c.fillStyle = rad(c, cx, cy, h * 0.5, [[0, 'rgba(255,226,170,0.95)'], [0.25, 'rgba(240,190,120,0.35)'], [1, 'rgba(0,0,0,0)']])
  c.fillRect(0, 0, w, h)
  const frames = 7
  for (let i = 0; i < frames; i++) {
    const z = fract(i / frames + t * 0.12)
    const s = 0.08 + Math.pow(z, 2.2) * 1.6
    const fw = w * 0.42 * s
    const fh = h * 0.78 * s
    c.strokeStyle = `rgba(240,225,200,${Math.min(0.75, z * 0.9)})`
    c.lineWidth = Math.max(1, s * 5)
    c.strokeRect(cx - fw / 2, cy - fh / 2, fw, fh)
  }
  c.strokeStyle = 'rgba(240,225,200,0.16)'
  c.lineWidth = 1
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
    c.beginPath()
    c.moveTo(cx, cy)
    c.lineTo(x, y)
    c.stroke()
  }
  // window light shafts on the left wall
  c.save()
  c.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 3; i++) {
    c.fillStyle = 'rgba(255,210,150,0.06)'
    c.beginPath()
    const x0 = w * (0.05 + i * 0.07)
    c.moveTo(x0, 0)
    c.lineTo(x0 + w * 0.04, 0)
    c.lineTo(x0 + w * 0.25, h)
    c.lineTo(x0 + w * 0.15, h)
    c.fill()
  }
  c.restore()
}

/* 06 — Documentary: interview framing, bokeh, a lower third. */
const interview: Draw = (c, w, h, t) => {
  c.fillStyle = lin(c, 0, 0, w, h, [[0, '#14161b'], [1, '#2a1f1a']])
  c.fillRect(0, 0, w, h)
  for (let i = 0; i < 9; i++) {
    const x = w * fract(i * 0.37 + 0.1) * 0.55
    const y = h * (0.15 + fract(i * 0.61) * 0.5)
    const r = h * (0.05 + fract(i * 0.29) * 0.07)
    c.fillStyle = rad(c, x + Math.sin(t * 0.4 + i) * 4, y, r, [[0, 'rgba(255,200,140,0.35)'], [0.7, 'rgba(255,170,120,0.18)'], [1, 'rgba(255,170,120,0)']])
    c.beginPath()
    c.arc(x, y, r, 0, TAU)
    c.fill()
  }
  const sx = w * 0.66
  const breath = Math.sin(t * 1.4) * h * 0.004
  c.fillStyle = rad(c, sx - h * 0.1, h * 0.36, h * 0.55, [[0, '#6b4a3a'], [0.4, '#2e2220'], [1, '#0e0c0c']])
  c.beginPath()
  c.ellipse(sx, h * 0.38 + breath, h * 0.11, h * 0.14, 0, 0, TAU)
  c.fill()
  c.beginPath()
  c.moveTo(sx - h * 0.36, h)
  c.quadraticCurveTo(sx - h * 0.3, h * 0.56 + breath, sx, h * 0.55 + breath)
  c.quadraticCurveTo(sx + h * 0.3, h * 0.56 + breath, sx + h * 0.36, h)
  c.fill()
  // lower third
  const p = ease(fract(t / 4) * 4) - ease((fract(t / 4) - 0.85) * 8)
  c.fillStyle = '#d4302f'
  c.fillRect(w * 0.07, h * 0.76, 3, h * 0.11 * p)
  c.save()
  c.beginPath()
  c.rect(w * 0.07 + 8, h * 0.74, w * 0.5, h * 0.16)
  c.clip()
  c.fillStyle = 'rgba(245,242,236,0.95)'
  c.font = `600 ${Math.round(h * 0.055)}px Inter, system-ui, sans-serif`
  c.fillText('In their words', w * 0.07 + 14 - (1 - p) * w * 0.3, h * 0.81)
  c.fillStyle = 'rgba(245,242,236,0.6)'
  c.font = `400 ${Math.round(h * 0.04)}px Inter, system-ui, sans-serif`
  c.fillText('Interview · Day 02', w * 0.07 + 14 - (1 - p) * w * 0.3, h * 0.865)
  c.restore()
}

/* 07 — AI-assisted: drifting light fields over a displaced dot lattice. */
const generative: Draw = (c, w, h, t) => {
  c.fillStyle = '#07070b'
  c.fillRect(0, 0, w, h)
  c.save()
  c.globalCompositeOperation = 'lighter'
  const blobs: [string, number, number][] = [
    ['rgba(212,48,47,0.55)', 0.7, 0.0],
    ['rgba(90,110,255,0.45)', 0.5, 2.1],
    ['rgba(80,220,190,0.35)', 0.9, 4.2],
  ]
  for (const [col, sp, ph] of blobs) {
    const x = w * (0.5 + 0.3 * Math.sin(t * sp * 0.6 + ph))
    const y = h * (0.5 + 0.28 * Math.cos(t * sp * 0.8 + ph * 1.3))
    c.fillStyle = rad(c, x, y, h * 0.55, [[0, col], [1, 'rgba(0,0,0,0)']])
    c.fillRect(0, 0, w, h)
  }
  c.restore()
  c.fillStyle = 'rgba(234,231,226,0.55)'
  const step = Math.max(10, w / 34)
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      const d = Math.sin(x * 0.03 + t * 1.2) + Math.cos(y * 0.04 - t * 0.9)
      const s = 0.6 + 0.9 * (0.5 + 0.25 * d)
      c.fillRect(x + d * 3, y + Math.sin(d + t) * 3, s, s)
    }
  }
}

const LOOPS: Record<LoopId, Draw> = { cuts, motion, grade, sound, space, interview, generative }

export function drawLoop(c: CanvasRenderingContext2D, id: LoopId, w: number, h: number, t: number) {
  c.globalAlpha = 1
  c.globalCompositeOperation = 'source-over'
  LOOPS[id](c, w, h, t)
  // subtle film grain + vignette, shared by all loops
  c.fillStyle = rad(c, w / 2, h / 2, w * 0.7, [[0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.45)']])
  c.fillRect(0, 0, w, h)
}

/* Stereo level envelope (0..1) per loop — drives the audio meter. */
export function levels(id: LoopId, t: number): [number, number] {
  const b = beat(t)
  const wob = (s: number) => 0.5 + 0.5 * Math.sin(t * s)
  let base: number
  switch (id) {
    case 'sound':
      base = 0.45 + 0.5 * b
      break
    case 'cuts':
      base = 0.42 + 0.22 * b + 0.1 * wob(5)
      break
    case 'interview':
      base = 0.3 + 0.3 * wob(9) * wob(2.3)
      break
    case 'grade':
    case 'space':
      base = 0.3 + 0.12 * wob(1.7) + 0.08 * b
      break
    default:
      base = 0.38 + 0.25 * b + 0.08 * wob(6)
  }
  const l = base * (0.92 + 0.08 * wob(17))
  const r = base * (0.9 + 0.1 * wob(13.7))
  return [Math.min(1, l), Math.min(1, r)]
}

/* Vectorscope: samples the monitor into a tiny buffer, plots Cb/Cr with phosphor decay. */
export class Vectorscope {
  private sample: HTMLCanvasElement
  private sctx: CanvasRenderingContext2D
  private sw = 40
  private sh = 22
  constructor() {
    this.sample = document.createElement('canvas')
    this.sample.width = this.sw
    this.sample.height = this.sh
    this.sctx = this.sample.getContext('2d', { willReadFrequently: true })!
  }

  draw(src: HTMLCanvasElement, c: CanvasRenderingContext2D, size: number, fresh = false) {
    const cx = size / 2
    const r = size * 0.44
    // decay previous trace
    c.globalCompositeOperation = 'source-over'
    c.fillStyle = fresh ? 'rgb(8,9,11)' : 'rgba(8,9,11,0.45)'
    c.fillRect(0, 0, size, size)
    // graticule
    c.strokeStyle = 'rgba(234,231,226,0.16)'
    c.lineWidth = 1
    c.beginPath()
    c.arc(cx, cx, r, 0, TAU)
    c.moveTo(cx - r, cx)
    c.lineTo(cx + r, cx)
    c.moveTo(cx, cx - r)
    c.lineTo(cx, cx + r)
    c.stroke()
    c.beginPath()
    c.arc(cx, cx, r * 0.5, 0, TAU)
    c.stroke()
    // skin-tone line (~123°)
    c.strokeStyle = 'rgba(212,48,47,0.5)'
    c.beginPath()
    c.moveTo(cx, cx)
    const a = (-123 * Math.PI) / 180
    c.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r)
    c.stroke()
    // trace
    this.sctx.drawImage(src, 0, 0, this.sw, this.sh)
    const d = this.sctx.getImageData(0, 0, this.sw, this.sh).data
    c.globalCompositeOperation = 'lighter'
    c.fillStyle = 'rgba(190,240,215,0.32)'
    const k = (r / 128) * 1.6
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i]
      const G = d[i + 1]
      const B = d[i + 2]
      const u = -0.169 * R - 0.331 * G + 0.5 * B
      const v = 0.5 * R - 0.419 * G - 0.081 * B
      c.fillRect(cx + u * k - 0.75, cx - v * k - 0.75, 1.5, 1.5)
    }
    c.globalCompositeOperation = 'source-over'
  }
}
