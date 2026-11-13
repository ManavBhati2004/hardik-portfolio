/*
 * The smooth ink front on the CPU: the same blob + lobe noise as the ink shader (shaders.ts,
 * ported from "Ink Bleed" by Codemure, MIT License), sampled from the same noise data, traced
 * as a polygon around the click point. It clips the live new page during the toggle, so no
 * GPU read-back is ever needed (a read-back waits for the whole 3D frame and made the spread
 * stutter).
 */
import { NOISE_CELLS, NOISE_SIZE, noiseData } from './noiseTexture'

const A_LOBE = 0.22
const A_BLOB = 0.2
const A_SUM = A_LOBE + A_BLOB

let tex: Uint8Array | null = null

/** Bilinear, repeating sample of channel R in [-1, 1] (as `textureLod(uNoise, p / CELLS)`). */
function gnoise(x: number, y: number): number {
  const t = tex ?? (tex = noiseData())
  const fx = (x / NOISE_CELLS) * NOISE_SIZE - 0.5
  const fy = (y / NOISE_CELLS) * NOISE_SIZE - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const ax = fx - x0
  const ay = fy - y0
  const m = NOISE_SIZE - 1
  const i = (xx: number, yy: number) => t[(((yy & m) * NOISE_SIZE) + (xx & m)) * 4]
  const top = i(x0, y0) + (i(x0 + 1, y0) - i(x0, y0)) * ax
  const bot = i(x0, y0 + 1) + (i(x0 + 1, y0 + 1) - i(x0, y0 + 1)) * ax
  return ((top + (bot - top) * ay) / 255) * 2 - 1
}

function fbm(x: number, y: number, octaves: number, norm: number): number {
  let s = 0
  let a = 0.5
  for (let k = 0; k < octaves; k++) {
    s += a * gnoise(x, y)
    // p = OCT * p + 17.13 with OCT = mat2(0.8, 0.6, -0.6, 0.8) * 2.03 (column-major)
    const nx = (0.8 * x - 0.6 * y) * 2.03 + 17.13
    const ny = (0.6 * x + 0.8 * y) * 2.03 + 17.13
    x = nx
    y = ny
    a *= 0.5
  }
  return s / norm
}

export interface FrontParams {
  cx: number
  cy: number
  radius: number
  cleanup: number
  time: number
  ref: number
  seedX: number
  seedY: number
  seedAngle: number
  drift: number
  /** px inside the smooth front where the clip runs (under the pigment band) */
  level: number
}

/** Points (CSS px) of the clip polygon, as a `polygon(...)` value; '' when nothing is inked yet. */
export function inkFrontPolygon(f: FrontParams, samples = 200, ox = 0, oy = 0): string {
  const t = f.time * f.drift
  const c = Math.cos(f.seedAngle)
  const s = Math.sin(f.seedAngle)
  const pts: string[] = []
  let any = false
  for (let k = 0; k < samples; k++) {
    const ang = (k / samples) * Math.PI * 2
    const ux = Math.cos(ang)
    const uy = Math.sin(ang)
    // dir = uSeedRot * (rel / d)
    const dx = c * ux - s * uy
    const dy = s * ux + c * uy
    const lqx = dx * 0.9 + f.seedY * 0.37 + 0.06 * t
    const lqy = dy * 0.9 + f.seedX * 0.37 + 0.06 * t
    const lobes = gnoise(lqx, lqy) * 0.75 + gnoise(lqx * 2.1 + 9.1, lqy * 2.1 + 9.1) * 0.25
    // the blob depends on the point itself: solve d = R * reach(d) by fixed-point iteration
    let d = f.radius
    let reach = 1
    for (let it = 0; it < 3; it++) {
      const px = (ux * d) / f.ref
      const py = (uy * d) / f.ref
      const qx = px * 2.4 + f.seedX
      const qy = py * 2.4 + f.seedY
      const wx = fbm(qx, qy + 0.31 * t, 3, 0.875)
      const wy = fbm(qx + 5.2 - 0.27 * t, qy + 1.3, 3, 0.875)
      const blob = fbm(qx + 2.3 * wx + 0.12 * t, qy + 2.3 * wy - 0.08 * t, 5, 0.96875)
      reach = Math.min(1 + A_SUM, Math.max(1 - A_SUM, 1 + A_LOBE * 1.6 * lobes + A_BLOB * 1.5 * blob))
      d = f.radius * reach
    }
    const r = Math.max(0, f.radius * reach + f.cleanup + f.level)
    if (r > 0.5) any = true
    pts.push(`${(f.cx + ux * r + ox).toFixed(1)}px ${(f.cy + uy * r + oy).toFixed(1)}px`)
  }
  return any ? `polygon(${pts.join(',')})` : ''
}
