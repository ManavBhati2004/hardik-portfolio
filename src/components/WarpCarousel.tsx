/* ─────────────────────────────────────────────────────────────────────────────
   Warp Carousel — port of "Warp Carousel" by Louis Studios (21st.dev), adapted
   for the Legacy section:
   - cards are the PROJECTS, faces painted from the poster or rasterised SVG art
   - transparent stage (premultiplied alpha) so the fixed 3D scene shows through
   - glow colour sampled from each artwork; softer, darker glow by day
   - the front card opens the project overlay
   Ring geometry, spin curve, autoplay, drag/spring, lens warp, Canvas2D fallback,
   reduced-motion fade, offscreen pause and context-loss handling are as authored.
   ───────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project } from '../data/projects'
import { onSceneEvent, sceneStore } from '../scene/store'

export interface WarpCarouselProps {
  projects: Project[]
  /** Called when the front card is opened (click / Enter). `origin` sits over the front card's rect. */
  onOpen?: (project: Project, origin: HTMLElement) => void
  /** Hold autoplay (e.g. while the overlay is open). */
  paused?: boolean
  autoplay?: boolean
  interval?: number
  step?: number
  warp?: number
  ariaLabel?: string
  className?: string
  style?: React.CSSProperties
}

/* ------------------------------------------------------------------ */
/* Geometry: measured from the reference and fitted frame by frame.    */
/* Stage units: the stage is 720 units wide; a card is 256 by 320.     */
/* ------------------------------------------------------------------ */

const CW = 256
const CH = 320
const CR = 10
const FOCAL = 734.103
const G = {
  qA: 0.46401,
  XLA: 165.774,
  zA: 35.354,
  psiA: 1.44638,
  a1: 1.31454,
  a2: 1.10948,
  qB: 0.74999,
  XB: 204.525,
  ZB: 355.405,
  bB: 0.69311,
  bE: 0.04614,
  vC: 203.134,
  aC: 229.26,
  kB: 0.01087,
  bP: 0.99129,
  qPR: 1.01828,
  bPL: 1.0092,
  qPL: 1.07139,
}

type Pose = [number, number, number]

/** Pose of a card at ring offset q (0 front, +1 right, -1 left): centre x, depth behind the front plane, yaw. */
function poseAt(q0: number): Pose {
  let q = q0
  if (Math.abs(q) < 1) q -= G.kB * Math.sin(Math.PI * q) ** 2
  const s = q < 0 ? -1 : 1
  const a = Math.abs(q)
  const half = CW / 2
  if (a <= G.qA) {
    const t = a / G.qA
    const xl = -half + (G.XLA + half) * Math.pow(t, G.a1)
    const zl = G.zA * t ** 4
    const psi = G.psiA * Math.pow(t, G.a2)
    return [s * (xl + half * Math.cos(psi)), zl + half * Math.sin(psi), s * psi]
  }
  const dXL = ((G.XLA + half) * G.a1) / G.qA
  const dZL = (G.zA * 4) / G.qA
  const dps = (G.psiA * G.a2) / G.qA
  let Hx: number
  let Hz: number
  if (a <= G.qB) {
    const L = G.qB - G.qA
    const t = (a - G.qA) / L
    const hx = G.XLA + CW * Math.cos(G.psiA)
    const hz = G.zA + CW * Math.sin(G.psiA)
    const dhx = dXL - CW * Math.sin(G.psiA) * dps
    const dhz = dZL + CW * Math.cos(G.psiA) * dps
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1
    const h10 = t ** 3 - 2 * t ** 2 + t
    const h01 = -2 * t ** 3 + 3 * t ** 2
    const h11 = t ** 3 - t ** 2
    Hx = h00 * hx + h10 * L * dhx * G.bB + h01 * G.XB + h11 * L * G.vC * G.bE
    Hz = h00 * hz + h10 * L * dhz * G.bB + h01 * G.ZB
  } else {
    const d = a - G.qB
    Hx = G.XB + G.vC * d + G.aC * d * d
    Hz = G.ZB
  }
  const qP = s < 0 ? G.qPL : G.qPR
  const bP = s < 0 ? G.bPL : G.bP
  const LP = qP - G.qA
  const tp = Math.min(1, (a - G.qA) / LP)
  const psi =
    (2 * tp ** 3 - 3 * tp ** 2 + 1) * G.psiA + (tp ** 3 - 2 * tp ** 2 + tp) * LP * dps * bP + (-2 * tp ** 3 + 3 * tp ** 2) * Math.PI
  return [s * (Hx - half * Math.cos(psi)), Hz - half * Math.sin(psi), s * psi]
}

/* Spin curve: ring progress over one autoplay step, in reference frames (30 fps). */
const TK = [0, 3, 6, 8, 10, 11, 12, 13, 14, 16, 18, 21, 25, 30, 36, 45, 55, 70, 88, 110]
const TB = [
  0, 0.02175, 0.12069, 0.22549, 0.35493, 0.43254, 0.51436, 0.5952, 0.6751, 0.83199, 0.9709, 1.12669, 1.27958, 1.40975, 1.53561, 1.68385,
  1.79183, 1.89191, 1.95233, 2,
]
const DRIFT = 0.06511
const REST_PHASE = 81.828
const STEP_FRAMES = 110

const SLOPES = (() => {
  const n = TK.length
  const h = TK.slice(1).map((x, i) => x - TK[i])
  const dl = h.map((hi, i) => (TB[i + 1] - TB[i]) / hi)
  const d = new Array<number>(n).fill(0)
  for (let k = 1; k < n - 1; k++) {
    if (dl[k - 1] * dl[k] <= 0) d[k] = 0
    else {
      const w1 = 2 * h[k] + h[k - 1]
      const w2 = h[k] + 2 * h[k - 1]
      d[k] = (w1 + w2) / (w1 / dl[k - 1] + w2 / dl[k])
    }
  }
  const v = (dl[0] + dl[n - 2]) / 2
  d[0] = v
  d[n - 1] = v
  return d
})()

function spin(frames: number): number {
  if (frames <= 0) return 0
  if (frames >= STEP_FRAMES) return 1
  let i = 0
  while (i < TK.length - 2 && frames > TK[i + 1]) i++
  const h = TK[i + 1] - TK[i]
  const t = (frames - TK[i]) / h
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1
  const h10 = t ** 3 - 2 * t ** 2 + t
  const h01 = -2 * t ** 3 + 3 * t ** 2
  const h11 = t ** 3 - t ** 2
  return (h00 * TB[i] + h10 * h * SLOPES[i] + h01 * TB[i + 1] + h11 * h * SLOPES[i + 1]) / 2
}

function spinN(frames: number, n: number): number {
  if (n <= STEP_FRAMES + 0.5) return spin((frames * STEP_FRAMES) / Math.max(1, n))
  const knee = 80
  if (frames <= knee) return spin(frames)
  return spin(knee + ((frames - knee) * (STEP_FRAMES - knee)) / (n - knee))
}

const LEAD = (STEP_FRAMES - REST_PHASE) / 30

/* ------------------------------------------------------------------ */
/* Card faces                                                          */
/* ------------------------------------------------------------------ */

type RGB = [number, number, number]
const DEFAULT_GLOW: RGB = [212, 48, 47] // --crimson-glow

interface ArtEntry {
  img: HTMLImageElement | null
  glow: RGB
  promise: Promise<void>
}
/** Loaded artwork per project id (shared across mounts, so a remount paints instantly). */
const ART = new Map<string, ArtEntry>()

function artSource(p: Project): string {
  if (p.poster) return p.poster
  let svg = renderToStaticMarkup(<>{p.renderArtwork()}</>)
  if (!/xmlns=/.test(svg.slice(0, 200))) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  // an explicit size, so the image decodes at a useful resolution everywhere
  svg = svg.replace('<svg', '<svg width="1024" height="576"')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Average of the brightest pixels, lifted so it reads as light. */
function sampleGlow(img: HTMLImageElement): RGB {
  try {
    const cv = document.createElement('canvas')
    cv.width = 32
    cv.height = 18
    const cx = cv.getContext('2d', { willReadFrequently: true })
    if (!cx) return DEFAULT_GLOW
    cx.drawImage(img, 0, 0, 32, 18)
    const d = cx.getImageData(0, 0, 32, 18).data
    const px: { l: number; c: RGB }[] = []
    for (let i = 0; i < d.length; i += 4) {
      const c: RGB = [d[i], d[i + 1], d[i + 2]]
      const mx = Math.max(...c)
      const mn = Math.min(...c)
      // brightness weighted by saturation, so a tinted light beats a grey highlight
      px.push({ l: mx * (0.55 + (0.45 * (mx - mn)) / Math.max(1, mx)), c })
    }
    px.sort((a, b) => b.l - a.l)
    const top = px.slice(0, Math.max(4, Math.round(px.length * 0.12)))
    const avg: RGB = [0, 0, 0]
    for (const p of top) for (let k = 0; k < 3; k++) avg[k] += p.c[k] / top.length
    const m = Math.max(...avg)
    if (m < 8) return DEFAULT_GLOW
    const gain = 225 / m
    return [avg[0] * gain, avg[1] * gain, avg[2] * gain].map((v) => Math.min(255, Math.round(v))) as RGB
  } catch {
    return DEFAULT_GLOW
  }
}

function loadArt(p: Project): ArtEntry {
  const hit = ART.get(p.id)
  if (hit) return hit
  const entry: ArtEntry = { img: null, glow: DEFAULT_GLOW, promise: Promise.resolve() }
  entry.promise = new Promise<void>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      entry.img = img
      entry.glow = sampleGlow(img)
      resolve()
    }
    img.onerror = () => resolve()
    try {
      img.src = artSource(p)
    } catch {
      resolve()
    }
  })
  ART.set(p.id, entry)
  return entry
}

interface Fonts {
  display: string
  body: string
}
function readFonts(): Fonts {
  const cs = getComputedStyle(document.documentElement)
  return {
    display: cs.getPropertyValue('--font-display').trim() || 'Georgia, serif',
    body: cs.getPropertyValue('--font-body').trim() || 'system-ui, sans-serif',
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width <= maxW || !line) line = next
    else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = `${kept[maxLines - 1]}…`
    return kept
  }
  return lines
}

function setSpacing(ctx: CanvasRenderingContext2D, v: string) {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = v
}

function paintCard(cv: HTMLCanvasElement, p: Project, index: number, img: HTMLImageElement | null, fonts: Fonts) {
  const w = cv.width
  const h = cv.height
  const ctx = cv.getContext('2d')
  if (!ctx) return
  const k = w / CW
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  setSpacing(ctx, '0px')
  ctx.fillStyle = '#0b0b0d'
  ctx.fillRect(0, 0, w, h)

  // artwork, cover-fit
  if (img && img.naturalWidth > 0) {
    const iw = img.naturalWidth
    const ih = img.naturalHeight
    const s = Math.max(w / iw, h / ih)
    const dw = iw * s
    const dh = ih * s
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
  }

  // top veil for the index, bottom gradient for the copy
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.3)
  top.addColorStop(0, 'rgba(5, 5, 7, 0.55)')
  top.addColorStop(1, 'rgba(5, 5, 7, 0)')
  ctx.fillStyle = top
  ctx.fillRect(0, 0, w, h * 0.3)
  const bot = ctx.createLinearGradient(0, h * 0.4, 0, h)
  bot.addColorStop(0, 'rgba(5, 5, 7, 0)')
  bot.addColorStop(0.55, 'rgba(5, 5, 7, 0.72)')
  bot.addColorStop(1, 'rgba(5, 5, 7, 0.94)')
  ctx.fillStyle = bot
  ctx.fillRect(0, h * 0.4, w, h * 0.6)

  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.textBaseline = 'alphabetic'

  // index
  ctx.font = `300 34px ${fonts.display}`
  ctx.fillStyle = 'rgba(234, 231, 226, 0.62)'
  ctx.fillText(String(index + 1).padStart(2, '0'), 18, 46)

  // crimson hairline + category · year
  const cat = `${p.category}${p.year ? ` · ${p.year}` : ''}`.toUpperCase()
  ctx.font = `500 7.4px ${fonts.body}`
  setSpacing(ctx, '1.6px')
  ctx.fillStyle = 'rgba(201, 169, 166, 0.92)'
  ctx.fillText(cat, 18, 298)
  setSpacing(ctx, '0px')

  // title (up to two lines, bottom-aligned above the category)
  ctx.font = `400 25px ${fonts.display}`
  ctx.fillStyle = '#eae7e2'
  const lines = wrapLines(ctx, p.title, CW - 36, 2)
  const lh = 26
  const base = 280
  lines.forEach((ln, i) => ctx.fillText(ln, 18, base - (lines.length - 1 - i) * lh))
  const ruleY = base - (lines.length - 1) * lh - 28
  ctx.fillStyle = 'rgba(212, 48, 47, 0.9)'
  ctx.fillRect(18, ruleY, 22, 1.2)
}

/**
 * The glow a card casts above and below the ring, as one whole soft ellipse: [centre u, half width, strength].
 * Moment-matched to the card's light spread through a fixed window over the stage centre.
 */
function glowShape(pose: Pose): [number, number, number] {
  const [px, pz, ps] = pose
  const c = Math.cos(ps)
  const sn = Math.sin(ps)
  if (c <= 0.02) return [0, 1, 0]
  const A = px
  const B = FOCAL + pz
  const tNear = B - 0.5 * CW * Math.abs(sn)
  let m = 0
  let mx = 0
  let mxx = 0
  for (let u = -360; u <= 360; u += 3) {
    const h = Math.exp(-((Math.abs(u - 9) / 138) ** 4))
    if (h < 0.003) continue
    const k = u / 1.8 / FOCAL
    const den = sn * k - c
    if (Math.abs(den) < 1e-4) continue
    const s = (A - B * k) / den
    const t = B + s * sn
    if (t < 4) continue
    if ((u / 1.8 / FOCAL) * t * sn - t * c >= 0) continue
    const dsdk = (B * c - A * sn) / (den * den)
    const soft = Math.min(Math.abs(dsdk / FOCAL) * 2.2, 40) + 0.5
    const cov = Math.max(0, Math.min(1, (CW * 0.5 - Math.abs(s)) / soft + 0.5))
    if (cov <= 0) continue
    const near = Math.min(1, FOCAL / t)
    const rel = Math.exp(-((Math.max(t - tNear, 0) / 36) ** 1.5))
    const w = cov * near * near * rel * c * h
    m += w
    mx += w * u
    mxx += w * u * u
  }
  if (m < 0.5) return [0, 1, 0]
  const mu = mx / m
  const sd = Math.sqrt(Math.max(1, mxx / m - mu * mu))
  const r = Math.max(6, sd / 0.581)
  return [mu, r, (m * 3) / (1.813 * r)]
}

/* ------------------------------------------------------------------ */
/* WebGL renderer (transparent, premultiplied output)                  */
/* ------------------------------------------------------------------ */

const VERT = `#version 300 es
in vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
uniform vec2 uRes;
uniform float uUnit;
uniform vec4 uPose[8];
uniform vec3 uGlowCol[8];
uniform vec3 uGlowShape[8];
uniform float uDay;
uniform float uWarp;
uniform float uMix;
out vec4 outColor;

const float F = ${FOCAL.toFixed(2)};
const float CW = ${CW.toFixed(1)};
const float CH = ${CH.toFixed(1)};
const float CR = ${CR.toFixed(1)};

float lensH(float a){
  if (a <= 232.0) return a;
  float k[9] = float[9](232.0, 238.0, 245.0, 253.0, 262.0, 275.0, 295.0, 325.0, 360.0);
  float d[9] = float[9](1.1759, 1.0671, 1.0156, 1.0965, 0.6487, 0.2700, -0.1991, -0.4782, -0.0318);
  float s = 232.0;
  for (int i = 0; i < 8; i++){
    if (a <= k[i]) break;
    float x = min(a, k[i+1]);
    float t = (x - k[i]) / (k[i+1] - k[i]);
    s += (x - k[i]) * mix(1.0, mix(d[i], d[i+1], t * 0.5), uWarp);
  }
  if (a > 360.0) s += (a - 360.0) * mix(1.0, d[8], uWarp);
  return s;
}
float lensS(float a){
  float t = clamp((a - 262.0) / 93.0, 0.0, 2.0);
  return 1.0 + uWarp * (0.42 * pow(t, 1.5) + 0.045 * smoothstep(320.0, 360.0, a));
}

float sdRound(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec4 shadeCard(vec4 pose, vec2 ps, float fx, float fy, out float depth){
  depth = 1e9;
  if (pose.w < 0.0) return vec4(0.0);
  float k = ps.x / F;
  float c = cos(pose.z), sn = sin(pose.z);
  float den = sn * k - c;
  if (abs(den) < 1e-5) return vec4(0.0);
  float A = pose.x, B = F + pose.y;
  float s = (A - B * k) / den;
  float t = B + s * sn;
  if (t < 4.0) return vec4(0.0);
  float y = t * ps.y / F;
  float dsdk = (B * c - A * sn) / (den * den);
  float fs = min(abs(dsdk / F) * fx, 48.0);
  float fyc = min(t / F * fy, 48.0);
  vec2 p = vec2(s, y);
  float d = sdRound(p, vec2(CW, CH) * 0.5, CR);
  vec2 q = abs(p) - vec2(CW, CH) * 0.5 + CR;
  vec2 n = q.x > q.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  if (q.x > 0.0 && q.y > 0.0) n = normalize(q);
  float fp = length(vec2(fs * n.x, fyc * n.y)) + 1e-4;
  if (d > fp) return vec4(0.0);
  float cov = clamp(0.5 - d / fp, 0.0, 1.0);
  if (cov <= 0.0) return vec4(0.0);
  vec2 uv = vec2(s / CW + 0.5, 0.5 - y / CH);
  // the faces are printed on both sides: a card seen from behind reads the right way round
  if (c < 0.0) uv.x = 1.0 - uv.x;
  vec4 tex = textureGrad(uTex, vec3(uv, pose.w), vec2(fs / CW, 0.0), vec2(0.0, fyc / CH));
  depth = t;
  return vec4(tex.rgb, 1.0) * cov;
}

vec4 scene(vec2 ps, float fx, float fy, int base){
  vec4 col[4];
  float dep[4];
  for (int i = 0; i < 4; i++) col[i] = shadeCard(uPose[base + i], ps, fx, fy, dep[i]);
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++)
      if (j < 3 - i && dep[j] > dep[j+1]) {
        float td = dep[j]; dep[j] = dep[j+1]; dep[j+1] = td;
        vec4 tc = col[j]; col[j] = col[j+1]; col[j+1] = tc;
      }
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 4; i++) acc += (1.0 - acc.a) * col[i];
  return acc;
}

vec4 glowAt(vec2 pu, float halfH, int base){
  vec4 sum = vec4(0.0);
  float gH = min(halfH, 288.0);
  float dy = min(abs((gH - 11.0) - pu.y), abs(pu.y + (gH - 12.0)));
  if (dy > 40.0) return sum;
  for (int i = 0; i < 4; i++){
    vec3 sh = uGlowShape[base + i];
    if (sh.z <= 0.0) continue;
    float E = exp(-pow(abs(pu.x - sh.x) / sh.y, 4.0));
    if (E < 0.002) continue;
    float v = exp(-pow(dy / (18.5 * (0.45 + 0.55 * sqrt(E))), 3.0));
    float w = sh.z * E * v;
    sum += vec4(uGlowCol[base + i] * w, w);
  }
  return sum;
}

// the glow bands as premultiplied light over the transparent stage: by night a bright additive
// band in the card's colour, by day a softer, darker band that reads on the pale scene
vec4 stage(vec2 pu, float halfH, int base){
  vec4 g = glowAt(pu, halfH, base);
  if (g.a <= 0.0) return vec4(0.0);
  float I = clamp(g.a, 0.0, 1.0);
  vec3 col = g.rgb / g.a;
  vec3 night = mix(col, vec3(1.0), 0.06 * I * I);
  vec3 day = col * 0.42;
  vec3 c = mix(night, day, uDay);
  float a = pow(I, mix(1.1, 1.2, uDay)) * mix(0.62, 0.5, uDay);
  return vec4(c * a, a);
}

vec4 render(vec2 pu, float halfH, int base){
  float au = min(abs(pu.x), 360.0);
  float px = 1.0 / uUnit;
  vec4 bg = stage(pu, halfH, base);
  if (au < 236.0 || uWarp <= 0.0) {
    vec4 c = scene(pu, px, px, base);
    return c + (1.0 - c.a) * bg;
  }
  float e = 0.064 * uWarp * smoothstep(275.0, 360.0, au);
  float S0 = lensS(au);
  float sg = pu.x < 0.0 ? -1.0 : 1.0;
  float blur = 1.0 + 30.0 * pow(smoothstep(240.0, 340.0, au), 1.5) * uWarp;
  float fyb = 1.0 + 15.0 * smoothstep(280.0, 352.0, au) * uWarp;
  float gain = 1.0 + 0.17 * smoothstep(285.0, 350.0, au) * uWarp;
  vec3 acc;
  float alpha = 0.0;
  for (int ch = 0; ch < 3; ch++){
    float off = uWarp * (ch == 0 ? -20.92 : (ch == 1 ? 0.0 : 11.91));
    float h = lensH(au) + off * smoothstep(289.8, 344.9, au);
    float h0 = lensH(au - 0.5) + off * smoothstep(289.8, 344.9, au - 0.5);
    float h1 = lensH(au + 0.5) + off * smoothstep(289.8, 344.9, au + 0.5);
    float fx = px * max(abs(h1 - h0), 0.02) * blur;
    float S = S0 * (ch == 0 ? 1.0 + e : (ch == 1 ? 1.0 : 1.0 - e));
    vec4 c = scene(vec2(sg * h, pu.y / S), fx, px / S * fyb, base);
    c.rgb = min(c.rgb * gain, vec3(c.a));
    vec4 o = c + (1.0 - c.a) * bg;
    acc[ch] = o[ch];
    alpha = max(alpha, o.a);
  }
  return vec4(min(acc, vec3(alpha)), alpha);
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 pu = (fc - 0.5 * uRes) / uUnit;
  float halfH = 0.5 * uRes.y / uUnit;
  vec4 col = render(pu, halfH, 0);
  if (uMix > 0.0) col = mix(col, render(pu, halfH, 4), uMix);
  outColor = col;
}`

interface GLState {
  gl: WebGL2RenderingContext
  prog: WebGLProgram
  tex: WebGLTexture
  loc: Record<string, WebGLUniformLocation | null>
  aniso: EXT_texture_filter_anisotropic | null
  w: number
  h: number
  layers: number
}

/**
 * Compiles and links without waiting on the driver: the status is only queried once
 * KHR_parallel_shader_compile reports completion (polled across frames), so the compile never
 * blocks the main thread. Without the extension the check still waits a frame first.
 * Resolves 'none' when WebGL2 is unavailable (the 2D fallback can then take the canvas).
 */
function createGLAsync(canvas: HTMLCanvasElement, cancelled: () => boolean): Promise<GLState | 'none' | null> {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false })
  if (!gl) return Promise.resolve('none')
  const par = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
  const vs = gl.createShader(gl.VERTEX_SHADER)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)
  const prog = gl.createProgram()
  if (!vs || !fs || !prog) return Promise.resolve(null)
  gl.shaderSource(vs, VERT)
  gl.shaderSource(fs, FRAG)
  gl.compileShader(vs)
  gl.compileShader(fs)
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.bindAttribLocation(prog, 0, 'aPos')
  gl.linkProgram(prog)

  const finish = (): GLState | null => {
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getShaderInfoLog(vs) || '', gl.getShaderInfoLog(fs) || '', gl.getProgramInfoLog(prog) || '')
      gl.deleteProgram(prog)
      return null
    }
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    const tex = gl.createTexture()
    if (!tex) return null
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const loc: Record<string, WebGLUniformLocation | null> = {}
    for (const n of ['uTex', 'uRes', 'uUnit', 'uPose', 'uGlowCol', 'uGlowShape', 'uDay', 'uWarp', 'uMix']) loc[n] = gl.getUniformLocation(prog, n)
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic')
    return { gl, prog, tex, loc, aniso, w: 0, h: 0, layers: 0 }
  }

  return new Promise((resolve) => {
    const poll = () => {
      if (cancelled() || gl.isContextLost()) return resolve(null)
      if (par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) {
        requestAnimationFrame(poll)
        return
      }
      resolve(finish())
    }
    requestAnimationFrame(poll)
  })
}

function uploadCards(st: GLState, canvases: HTMLCanvasElement[]) {
  const { gl, tex } = st
  const w = canvases[0].width
  const h = canvases[0].height
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, canvases.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  canvases.forEach((cv, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, w, h, 1, gl.RGBA, gl.UNSIGNED_BYTE, cv))
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  if (st.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, st.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8)
  st.w = w
  st.h = h
  st.layers = canvases.length
}

/** Re-upload one card face (after its artwork loads). */
function uploadLayer(st: GLState, i: number, cv: HTMLCanvasElement) {
  const { gl, tex } = st
  if (cv.width !== st.w || cv.height !== st.h || i >= st.layers) return
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, cv.width, cv.height, 1, gl.RGBA, gl.UNSIGNED_BYTE, cv)
  gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
}

/* ------------------------------------------------------------------ */
/* Canvas 2D fallback: per-strip affine approximation, no lens blur.   */
/* ------------------------------------------------------------------ */

function drawFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  unit: number,
  poses: { pose: Pose; layer: number }[],
  canvases: HTMLCanvasElement[],
  glows: RGB[],
  day: number,
  clear: boolean
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  if (clear) ctx.clearRect(0, 0, w, h)
  const gH = Math.min(h / 2 / unit, 288)
  const dim = 1 - 0.58 * day
  for (const p of poses) {
    if (p.layer < 0) continue
    const [mu, r, amp] = glowShape(p.pose)
    const a = Math.min(1, amp) * 0.6 * (1 - 0.2 * day)
    if (a < 0.01) continue
    const rx = r * 1.35 * unit
    const col = glows[p.layer] || DEFAULT_GLOW
    const rgb = `${Math.round(col[0] * dim)}, ${Math.round(col[1] * dim)}, ${Math.round(col[2] * dim)}`
    for (const yy of [h / 2 - (gH - 11) * unit, h / 2 + (gH - 12) * unit]) {
      ctx.save()
      ctx.translate(w / 2 + mu * unit, yy)
      ctx.scale(1, (20 * unit) / rx)
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
      rg.addColorStop(0, `rgba(${rgb}, ${a})`)
      rg.addColorStop(0.55, `rgba(${rgb}, ${a * 0.55})`)
      rg.addColorStop(1, `rgba(${rgb}, 0)`)
      ctx.fillStyle = rg
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
      ctx.restore()
    }
  }
  const proj = (X: number, Zb: number, Y: number) => {
    const D = FOCAL + Zb
    return [w / 2 + ((X * FOCAL) / D) * unit, h / 2 - ((Y * FOCAL) / D) * unit]
  }
  const items = poses
    .filter((p) => p.layer >= 0)
    .map((p) => ({ ...p, depth: p.pose[1] }))
    .sort((a, b) => b.depth - a.depth)
  const strips = 32
  const eps = 1.5 / Math.max(unit, 0.25)
  const half = CW / 2
  const edgeY = (sv: number) => {
    const dx = Math.abs(sv) - (half - CR)
    if (dx <= 0) return CH / 2
    return CH / 2 - CR + Math.sqrt(Math.max(0, CR * CR - Math.min(dx, CR) ** 2))
  }
  for (const it of items) {
    const [cx, zb, psi] = it.pose
    const cv = canvases[it.layer]
    if (!cv) continue
    const tpu = cv.width / CW
    // a card seen from behind is mapped mirrored, so its face still reads the right way round
    const flip = Math.cos(psi) < 0 ? -1 : 1
    const cs = Math.cos(psi) * flip
    const sn = Math.sin(psi) * flip
    const at = (sv: number, y: number) => proj(cx + sv * cs, zb + sv * sn, y)
    for (let i = 0; i < strips; i++) {
      const s0 = -half + (CW * i) / strips - (i > 0 ? eps : 0)
      const s1 = -half + (CW * (i + 1)) / strips + (i < strips - 1 ? eps : 0)
      if (FOCAL + zb + s0 * sn < 10 || FOCAL + zb + s1 * sn < 10) continue
      const n = Math.abs(s0) > half - CR - 1 || Math.abs(s1) > half - CR - 1 ? 6 : 1
      ctx.save()
      ctx.beginPath()
      for (let k = 0; k <= n; k++) {
        const sv = Math.max(-half, Math.min(half, s0 + ((s1 - s0) * k) / n))
        const pt = at(sv, edgeY(sv))
        if (k === 0) ctx.moveTo(pt[0], pt[1])
        else ctx.lineTo(pt[0], pt[1])
      }
      for (let k = n; k >= 0; k--) {
        const sv = Math.max(-half, Math.min(half, s0 + ((s1 - s0) * k) / n))
        const pt = at(sv, -edgeY(sv))
        ctx.lineTo(pt[0], pt[1])
      }
      ctx.closePath()
      ctx.clip()
      const sm = (s0 + s1) / 2
      const tl = at(s0, CH / 2)
      const tr = at(s1, CH / 2)
      const mt = at(sm, CH / 2)
      const mb = at(sm, -CH / 2)
      const sx0 = (s0 + half) * tpu
      const sw = (s1 - s0) * tpu
      const ov = 1.025
      const a = (tr[0] - tl[0]) / sw
      const b = (tr[1] - tl[1]) / sw
      const c = ((mb[0] - mt[0]) / cv.height) * ov
      const d = ((mb[1] - mt[1]) / cv.height) * ov
      const smx = (sm + half) * tpu
      const ox = (mt[0] + mb[0]) / 2 - a * smx - c * (cv.height / 2)
      const oy = (mt[1] + mb[1]) / 2 - b * smx - d * (cv.height / 2)
      ctx.setTransform(a, b, c, d, ox, oy)
      const x0 = Math.max(0, sx0 - 1)
      const x1 = Math.min(cv.width, sx0 + sw + 1)
      ctx.drawImage(cv, x0, 0, x1 - x0, cv.height, x0, 0, x1 - x0, cv.height)
      ctx.restore()
    }
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(sceneStore.reducedMotion)
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return reduced
}

const mod = (a: number, n: number) => ((a % n) + n) % n

interface Live {
  P: number
  from: number
  to: number
  t0: number
  n: number
  v: number
  mode: 'rest' | 'spin' | 'drag' | 'spring' | 'fade'
  nextAuto: number
  autoPending: boolean
  fadeFrom: number
  fadeT0: number
  dragX: number
  dragP: number
  downX: number
  moved: boolean
  lastT: number
  visible: boolean
  hiddenAt: number
}

/** Unit size in CSS px for a box (the 720-unit stage fills the width; short boxes shrink to fit the height). */
/** Portrait boxes (phones) use a tighter 540-unit span, so the front card fills more of the width and the flare runs off the edges. */
const stageUnit = (w: number, h: number) => Math.min(w / (w < h ? 540 : 720), h / 440)
const unitFor = (r: DOMRect) => stageUnit(r.width, r.height)

export function WarpCarousel({
  projects,
  onOpen,
  paused = false,
  autoplay = true,
  interval = 3.6667,
  step = 2,
  warp = 1,
  ariaLabel = 'Selected work',
  className,
  style,
}: WarpCarouselProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const proxyRef = React.useRef<HTMLDivElement>(null)
  const reduced = usePrefersReducedMotion()
  const list = React.useMemo(() => {
    const out: { project: Project; index: number }[] = []
    if (!projects.length) return out
    while (out.length < 4) out.push(...projects.map((project, index) => ({ project, index })))
    return out
  }, [projects])
  const realCount = projects.length
  const N = list.length
  const stepN = Math.max(1, Math.round(step))
  const gap = Math.max(0.5, interval)

  const [current, setCurrent] = React.useState(0)
  const [hold, setHold] = React.useState(false)

  const live = React.useRef<Live>({
    P: current,
    from: current,
    to: current,
    t0: 0,
    n: STEP_FRAMES,
    v: 0,
    mode: 'rest',
    nextAuto: Infinity,
    autoPending: false,
    fadeFrom: current,
    fadeT0: 0,
    dragX: 0,
    dragP: 0,
    downX: 0,
    moved: false,
    lastT: 0,
    visible: true,
    hiddenAt: 0,
  })
  const held = paused || hold
  const props = React.useRef({ autoplay, gap, stepN, reduced, realCount, held })
  // synced before any effect (and the render loop) reads it
  React.useLayoutEffect(() => {
    props.current = { autoplay, gap, stepN, reduced, realCount, held }
  })
  const handles = React.useRef<{ kick: () => void; draw: () => void }>({ kick: () => {}, draw: () => {} })

  const lastIndex = React.useRef(current)
  const request = React.useCallback((next: number) => setCurrent(next), [])

  // a change of the index starts a spin (or a cross-fade when motion is reduced)
  React.useEffect(() => {
    const L = live.current
    const prev = lastIndex.current
    lastIndex.current = current
    if (prev === current) return
    const delta = current - prev
    const now = performance.now() / 1000
    const fromAuto = L.autoPending
    L.autoPending = false
    if (props.current.reduced) {
      L.fadeFrom = L.P
      L.P = Math.round(L.P) + delta
      L.mode = 'fade'
      L.fadeT0 = now
    } else if (L.mode !== 'spring') {
      const base = Math.round(L.P - DRIFT) + delta
      L.from = L.P
      L.to = base + DRIFT
      L.t0 = now
      L.n = fromAuto ? props.current.gap * 30 : STEP_FRAMES
      L.mode = 'spin'
    }
    if (!fromAuto) L.nextAuto = now + props.current.gap
    handles.current.kick()
  }, [current])

  React.useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas || !N) return
    // the renderer starts only once the 3D scene is ready and the section is near the viewport, so
    // its shader compile and card painting never compete with the page load
    let gls: GLState | null = null
    let ctx2d: CanvasRenderingContext2D | null = null
    let started = false
    let cardCanvases: HTMLCanvasElement[] = []
    let texW = 0
    let raf = 0
    let disposed = false
    let fonts = readFonts()
    const arts: ArtEntry[] = []
    const glowCols = (): RGB[] => arts.map((a) => a.glow)

    const paintOne = (i: number, cv: HTMLCanvasElement) => paintCard(cv, list[i].project, list[i].index, arts[i]?.img ?? null, fonts)
    const paintAll = (w: number) => {
      cardCanvases = list.map((_, i) => {
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = Math.round((w * CH) / CW)
        paintOne(i, cv)
        return cv
      })
      texW = w
      if (gls) uploadCards(gls, cardCanvases)
    }

    let W = 0
    let H = 0
    let unit = 1
    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = Math.max(2, Math.round(r.width * dpr))
      H = Math.max(2, Math.round(r.height * dpr))
      if (canvas.width !== W) canvas.width = W
      if (canvas.height !== H) canvas.height = H
      unit = stageUnit(W, H)
      const want = Math.min(1024, Math.max(256, Math.round(CW * unit * 1.25)))
      if (started && want !== texW) paintAll(want)
    }

    const poseSet = (P: number) => {
      const ids = Array.from({ length: N }, (_, c) => ({ c, q: mod(c - P + N / 2, N) - N / 2 }))
        .sort((a, b) => Math.abs(a.q) - Math.abs(b.q))
        .slice(0, 4)
      return ids.map(({ c, q }) => (Math.abs(q) > 2.05 ? { pose: [0, 0, 0] as Pose, layer: -1 } : { pose: poseAt(q), layer: c }))
    }

    const L = live.current
    const progressAt = (now: number) => {
      if (L.mode === 'spin') {
        const f = (now - L.t0) * 30
        L.P = L.from + (L.to - L.from) * spinN(f, L.n)
        if (f >= L.n) L.mode = 'rest'
      } else if (L.mode === 'spring') {
        const dt = Math.min(0.034, Math.max(0, now - L.lastT))
        L.lastT = now
        const sub = 4
        for (let i = 0; i < sub; i++) {
          const acc = -60 * (L.P - L.to) - 13 * L.v
          L.v += (acc * dt) / sub
          L.P += (L.v * dt) / sub
        }
        if (Math.abs(L.P - L.to) < 4e-4 && Math.abs(L.v) < 3e-3) {
          L.P = L.to
          L.v = 0
          L.mode = 'rest'
        }
      } else if (L.mode === 'fade') {
        const m = Math.min(1, (now - L.fadeT0) / 0.45)
        if (m >= 1) L.mode = 'rest'
        return { P: L.P, Pb: L.fadeFrom, mix: 1 - m * m * (3 - 2 * m) }
      }
      return { P: L.P, Pb: 0, mix: 0 }
    }

    const poseArr = new Float32Array(32)
    const glowArr = new Float32Array(24)
    const shapeArr = new Float32Array(24)
    const fill = (set: { pose: Pose; layer: number }[], off: number) => {
      set.forEach((s, i) => {
        const j = off + i
        poseArr[j * 4] = s.pose[0]
        poseArr[j * 4 + 1] = s.pose[1]
        poseArr[j * 4 + 2] = s.pose[2]
        poseArr[j * 4 + 3] = s.layer
        const gc = s.layer >= 0 ? (arts[s.layer]?.glow ?? DEFAULT_GLOW) : DEFAULT_GLOW
        glowArr[j * 3] = gc[0] / 255
        glowArr[j * 3 + 1] = gc[1] / 255
        glowArr[j * 3 + 2] = gc[2] / 255
        const gs = s.layer >= 0 ? glowShape(s.pose) : [0, 1, 0]
        shapeArr[j * 3] = gs[0]
        shapeArr[j * 3 + 1] = gs[1]
        shapeArr[j * 3 + 2] = gs[2]
      })
    }

    const draw = (now: number) => {
      if (disposed) return
      const { P, Pb, mix } = progressAt(now)
      const setA = poseSet(P)
      const day = Math.max(0, Math.min(1, sceneStore.day))
      if (gls) {
        if (lost) return
        const { gl, prog, loc } = gls
        gl.viewport(0, 0, W, H)
        gl.useProgram(prog)
        fill(setA, 0)
        if (mix > 0) fill(poseSet(Pb), 4)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, gls.tex)
        gl.uniform1i(loc.uTex, 0)
        gl.uniform2f(loc.uRes, W, H)
        gl.uniform1f(loc.uUnit, unit)
        gl.uniform4fv(loc.uPose, poseArr)
        gl.uniform3fv(loc.uGlowCol, glowArr)
        gl.uniform3fv(loc.uGlowShape, shapeArr)
        gl.uniform1f(loc.uDay, day)
        gl.uniform1f(loc.uWarp, Math.max(0, Math.min(1, warp)))
        gl.uniform1f(loc.uMix, mix)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      } else if (ctx2d) {
        const glows = glowCols()
        if (mix > 0) {
          // previous set fades out over the new one
          drawFallback(ctx2d, W, H, unit, setA, cardCanvases, glows, day, true)
          ctx2d.globalAlpha = mix
          drawFallback(ctx2d, W, H, unit, poseSet(Pb), cardCanvases, glows, day, false)
          ctx2d.globalAlpha = 1
        } else drawFallback(ctx2d, W, H, unit, setA, cardCanvases, glows, day, true)
      }
    }

    const loop = () => {
      raf = 0
      if (disposed || !L.visible) return
      const now = performance.now() / 1000
      const p = props.current
      if (p.held) L.nextAuto = Math.max(L.nextAuto, now + p.gap * 0.6)
      else if (p.autoplay && L.mode !== 'drag' && L.mode !== 'spring' && now >= L.nextAuto) {
        L.nextAuto = Math.max(L.nextAuto + p.gap, now + p.gap * 0.5)
        L.autoPending = true
        request(lastIndex.current + p.stepN)
      }
      draw(now)
      const busy = L.mode !== 'rest' || (p.autoplay && !p.held)
      if (busy) raf = requestAnimationFrame(loop)
    }
    const kick = () => {
      if (!raf && !disposed && L.visible) raf = requestAnimationFrame(loop)
    }
    handles.current = { kick, draw: () => draw(performance.now() / 1000) }

    // the reference opens mid-rest, a moment before its first spin
    const t0 = performance.now() / 1000
    if (props.current.autoplay && !props.current.reduced) {
      L.from = lastIndex.current - props.current.stepN + DRIFT
      L.to = lastIndex.current + DRIFT
      L.t0 = t0 - REST_PHASE / 30
      L.n = STEP_FRAMES
      L.mode = 'spin'
      L.P = L.from + (L.to - L.from) * spin(REST_PHASE)
      L.nextAuto = t0 + LEAD
    } else {
      L.nextAuto = t0 + props.current.gap
    }

    let lost = false
    resize()
    const ro = new ResizeObserver(() => {
      resize()
      draw(performance.now() / 1000)
    })
    ro.observe(wrap)

    const setVisible = (vis: boolean) => {
      const now = performance.now() / 1000
      if (vis === L.visible) return
      if (!vis) L.hiddenAt = now
      else {
        const dt = now - L.hiddenAt
        L.t0 += dt
        L.fadeT0 += dt
        L.nextAuto += dt
        L.lastT = now
      }
      L.visible = vis
      if (vis) kick()
    }
    let inView = true
    const io = new IntersectionObserver((ents) => {
      inView = ents.some((e) => e.isIntersecting)
      setVisible(inView && document.visibilityState === 'visible')
    })
    io.observe(wrap)
    const onVis = () => setVisible(inView && document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)

    const onLost = (e: Event) => {
      e.preventDefault()
      lost = true
    }
    const onRestored = () => {
      if (!lost) return
      lost = false
      gls = null
      void createGLAsync(canvas, () => disposed).then((st) => {
        if (disposed || lost || !st || st === 'none') return
        gls = st
        texW = 0
        resize()
        draw(performance.now() / 1000)
        kick()
      })
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    const repaint = () => {
      if (disposed) return
      fonts = readFonts()
      texW = 0
      resize()
      draw(performance.now() / 1000)
    }
    const docFonts = document.fonts
    docFonts?.addEventListener?.('loadingdone', repaint)
    docFonts?.ready.then(repaint).catch(() => undefined)

    const start = () => {
      if (started || disposed) return
      started = true
      arts.push(...list.map((c) => loadArt(c.project)))
      // artwork arrives async: repaint that face and re-upload its layer
      arts.forEach((a, i) => {
        a.promise.then(() => {
          if (disposed || !a.img) return
          const cv = cardCanvases[i]
          if (!cv) return
          paintOne(i, cv)
          if (gls && !lost) uploadLayer(gls, i, cv)
          draw(performance.now() / 1000)
        })
      })
      void createGLAsync(canvas, () => disposed).then((st) => {
        if (disposed) {
          if (st && st !== 'none') st.gl.deleteProgram(st.prog)
          return
        }
        if (st === 'none') ctx2d = canvas.getContext('2d')
        else gls = st
        texW = 0
        resize()
        draw(performance.now() / 1000)
        kick()
      })
    }
    let near = false
    let sceneReady = sceneStore.ready
    const maybeStart = () => {
      if (near && sceneReady) start()
    }
    const nearIO = new IntersectionObserver(
      (ents) => {
        near = ents.some((e) => e.isIntersecting)
        maybeStart()
      },
      { rootMargin: '100% 0px' }
    )
    nearIO.observe(wrap)
    const offReady = onSceneEvent('ready', () => {
      sceneReady = true
      maybeStart()
    })
    // if the 3D scene never reports ready (no WebGL there), start anyway after a while
    const readyFallback = window.setTimeout(() => {
      sceneReady = true
      maybeStart()
    }, 20000)

    // theme: uniform only, no rebuild
    const offTheme = onSceneEvent('theme', () => draw(performance.now() / 1000))

    draw(t0)
    kick()
    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      nearIO.disconnect()
      offReady()
      window.clearTimeout(readyFallback)
      offTheme()
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      docFonts?.removeEventListener?.('loadingdone', repaint)
      if (gls) {
        gls.gl.deleteTexture(gls.tex)
        gls.gl.deleteProgram(gls.prog)
      }
    }
    // the live state lives in refs; only a new card list or warp rebuilds the renderer
  }, [list, warp, N, request])

  React.useEffect(() => {
    handles.current.kick()
  }, [autoplay, reduced, held])

  /* ---------------- opening ---------------- */
  const openFront = React.useCallback(
    (idx: number) => {
      const wrap = wrapRef.current
      const proxy = proxyRef.current
      if (!wrap || !proxy || !onOpen || !N) return
      const u = unitFor(wrap.getBoundingClientRect())
      proxy.style.width = `${CW * u}px`
      proxy.style.height = `${CH * u}px`
      onOpen(list[mod(idx, N)].project, proxy)
    },
    [list, N, onOpen]
  )

  /* ---------------- interaction ---------------- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button > 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const L = live.current
    e.currentTarget.setPointerCapture?.(e.pointerId)
    L.mode = 'drag'
    L.dragX = e.clientX
    L.downX = e.clientX
    L.dragP = L.P
    L.v = 0
    L.moved = false
    L.lastT = performance.now() / 1000
    handles.current.kick()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const L = live.current
    if (L.mode !== 'drag') return
    const r = wrapRef.current!.getBoundingClientRect()
    const now = performance.now() / 1000
    const P = L.dragP - (e.clientX - L.dragX) / (unitFor(r) * 300)
    const dt = Math.max(1 / 240, now - L.lastT)
    L.v = 0.6 * L.v + 0.4 * ((P - L.P) / dt)
    L.P = P
    L.lastT = now
    if (Math.abs(e.clientX - L.downX) > 5) L.moved = true
    handles.current.draw()
  }
  const settle = (L: Live, now: number) => {
    if (now - L.lastT > 0.08) L.v = 0
    const target = Math.round(L.P + L.v * 0.16)
    const from = Math.round(L.dragP - DRIFT)
    L.to = target
    L.mode = 'spring'
    L.lastT = now
    const next = lastIndex.current + (target - from)
    if (next !== lastIndex.current) {
      lastIndex.current = next
      setCurrent(next)
    }
    handles.current.kick()
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const L = live.current
    if (L.mode !== 'drag') return
    const now = performance.now() / 1000
    L.nextAuto = now + gap
    if (!L.moved) {
      L.mode = 'rest'
      const r = wrapRef.current!.getBoundingClientRect()
      const un = unitFor(r)
      const u = (e.clientX - r.left - r.width / 2) / un
      const v = (e.clientY - r.top - r.height / 2) / un
      if (u > 168) request(lastIndex.current + 1)
      else if (u < -168) request(lastIndex.current - 1)
      else if (Math.abs(u) <= CW / 2 && Math.abs(v) <= CH / 2) openFront(lastIndex.current)
      handles.current.kick()
      return
    }
    settle(L, now)
  }
  // a cancelled pointer (the page took over the gesture, e.g. a vertical scroll) only springs back
  const onPointerCancel = () => {
    const L = live.current
    if (L.mode !== 'drag') return
    settle(L, performance.now() / 1000)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openFront(lastIndex.current)
      return
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    request(lastIndex.current + (e.key === 'ArrowRight' ? 1 : -1))
  }

  /** Spin the ring to show a project (nearest way round). */
  const goTo = (pi: number) => {
    const cur = lastIndex.current
    let d = mod(pi - mod(cur, realCount), realCount)
    if (d > realCount / 2) d -= realCount
    if (d !== 0) request(cur + d)
  }

  const front = N ? list[mod(current, N)].project : null
  return (
    <div
      ref={wrapRef}
      className={className}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHold(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHold(false)
      }}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 420,
        aspectRatio: '5 / 4',
        overflow: 'hidden',
        background: 'transparent',
        touchAction: 'pan-y',
        userSelect: 'none',
        cursor: 'grab',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {/* stand-in for the front card's rect, so the overlay can zoom from it */}
      <div
        ref={proxyRef}
        aria-hidden="true"
        style={{ position: 'absolute', left: '50%', top: '50%', translate: '-50% -50%', pointerEvents: 'none' }}
      />
      <div aria-live="polite" className="sr-only">
        {front ? `${front.title} — ${front.category}` : ''}
      </div>
      <ul className="sr-only" aria-label="Projects">
        {projects.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              onFocus={() => goTo(i)}
              onClick={() => {
                goTo(i)
                openFront(i)
              }}
            >
              {`Open ${p.title} — ${p.category}${p.year ? `, ${p.year}` : ''}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default WarpCarousel
