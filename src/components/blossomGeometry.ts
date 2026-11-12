import * as THREE from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
   Procedural cherry-blossom pieces (no extra downloads):
   - flowerGeometry(): five cupped, notched petals around a small centre, with a
     vertex-colour gradient (deeper blush at the heart, near-white at the rim)
   - petalGeometry(): a single loose, slightly curled petal for falling petals
   Unit size: a flower is ~1 unit across; instances scale it down.
   ───────────────────────────────────────────────────────────────────────────── */

const HEART = new THREE.Color(0.9, 0.42, 0.52)
const RIM = new THREE.Color(1.0, 0.95, 0.96)

function petalPoint(u: number, v: number, out: THREE.Vector3) {
  // u: 0 base → 1 tip; v: -1 → 1 across. Rounded petal with a shallow notch at the tip.
  const width = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.92 + 0.08)), 0.75) * (0.62 - 0.1 * u)
  const notch = 0.08 * Math.exp(-Math.pow(v / 0.28, 2)) * smooth(0.75, 1, u)
  const len = u * 0.5 - notch
  const x = v * width * 0.5
  const cup = u * u * 0.22 + Math.pow(Math.abs(v), 2) * 0.05 * u // cupped toward the viewer
  return out.set(x, len, cup)
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function buildPetals(count: number, U: number, V: number, spread: number, tilt: number) {
  const pos: number[] = []
  const col: number[] = []
  const idx: number[] = []
  const p = new THREE.Vector3()
  const c = new THREE.Color()
  const rot = new THREE.Matrix4()
  const tiltM = new THREE.Matrix4()
  for (let k = 0; k < count; k++) {
    const base = pos.length / 3
    const ang = (k / count) * Math.PI * 2 * spread
    rot.makeRotationZ(ang)
    tiltM.makeRotationX(tilt * (0.85 + 0.3 * ((k * 37) % 5) / 5))
    for (let i = 0; i <= U; i++) {
      for (let j = 0; j <= V; j++) {
        const u = i / U
        const v = (j / V) * 2 - 1
        petalPoint(u, v, p)
        p.y += 0.04
        p.applyMatrix4(tiltM).applyMatrix4(rot)
        pos.push(p.x, p.y, p.z)
        c.copy(HEART).lerp(RIM, smooth(0.0, 0.7, u) * (0.85 + 0.15 * (1 - Math.abs(v))))
        col.push(c.r, c.g, c.b)
      }
    }
    for (let i = 0; i < U; i++) {
      for (let j = 0; j < V; j++) {
        const a = base + i * (V + 1) + j
        const b = a + V + 1
        idx.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }
  return { pos, col, idx }
}

/** Five-petal blossom facing +Z, ~1 unit across, with a pale-yellow stamen heart. */
export function flowerGeometry(): THREE.BufferGeometry {
  const { pos, col, idx } = buildPetals(5, 6, 4, 1, -0.55)
  // stamen heart: a tiny raised disc
  const base = pos.length / 3
  const n = 8
  pos.push(0, 0, 0.09)
  col.push(0.98, 0.86, 0.55)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pos.push(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.06)
    col.push(0.95, 0.7, 0.5)
  }
  for (let i = 0; i < n; i++) idx.push(base, base + 1 + i, base + 1 + ((i + 1) % n))
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** A single loose petal (for the falling petals), ~0.5 units long, slightly curled. */
export function petalGeometry(): THREE.BufferGeometry {
  const { pos, col, idx } = buildPetals(1, 6, 4, 0, 0.0)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.center()
  g.computeVertexNormals()
  return g
}
