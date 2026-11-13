import { useRef, useMemo, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { onSceneEvent, sceneStore } from '../scene/store'
import { pointAtNdc, isMobileViewport, heroCamera, pctToNdc } from '../scene/placement'
import { CAMERA_FOV, CAMERA_PATH, HERO_LAYOUT, KATANA_DISTANCE, WATER_Y } from '../scene/config'
import type { CursorRef } from './Scene3D'
import { makeDissolve, makeSayaParticles, patchKatanaMaterial, type DissolveUniforms, type SayaParticles } from './katanaFx'

/* ─── Props ─── */
export interface KatanaProps {
  cursorRef: CursorRef
}

/** The two katanas, exported from the user's .blend files (scripts/blender/export_katanas.py):
    black lacquer by night, white lacquer by day. Each has a "Sword" and a "Saya" node. */
const KATANA_URLS = { dark: '/models/katana_dark.opt.glb', light: '/models/katana_light.opt.glb' } as const
type KatanaKind = keyof typeof KATANA_URLS
/** Uniform model scale — fixed, never animated. */
const SWORD_SCALE = 3.3
/** Model-space blade extent (+Y from the tsuba) and handle length (−Y). */
const BLADE_Y = 0.699
const HANDLE_Y = 0.309
const BLADE_LEN = BLADE_Y * SWORD_SCALE
/** Rotation (rad) around the blade axis per viewport of scroll. */
const TURN_PER_VIEWPORT = Math.PI * 1.15
/** Spring stiffness for the scroll → rotation follow (higher = tighter). */
const SPIN_LAMBDA = 3.2
/** Resting spin so the blade face catches the key light. */
const REST_SPIN = 2.75
const TAU = Math.PI * 2

const DOWN = new THREE.Vector3(0, -1, 0)

/* ─── Restrained crimson gradient toward the tip (moon + water bounce) ─── */
/** 1 by night (crimson toward the tip), 0 by day (polished steel). Shared by every blade material. */
const bladeTintAmount = { value: 1 }

/* ─── One katana model: its authored materials, tuned for the scene's lighting ─── */
interface KatanaParts {
  root: THREE.Object3D
  saya: THREE.Object3D | null
  /** sits at the centre of the blade's arc; turning it slides the saya along the blade */
  pivot: THREE.Group
  arcRadius: number
  arcSign: number
  arcAxis: 'x' | 'z'
  bladeMats: THREE.MeshPhysicalMaterial[]
  /** dissolve of the whole katana, pommel → tip (the day/night transformation) */
  morph: DissolveUniforms
  /** dissolve of the saya, mouth → end, after the draw */
  sayaDis: DissolveUniforms
  particles: SayaParticles | null
}

/** Gap (world units) between the blade tip and the water when the katana hovers. */
const HOVER_GAP = 0.55
/** How far the sword rises out of its saya during the draw (world units). */
const DRAW_RISE = 0.12
/** Seconds for the draw + the saya burning away. */
const DRAW_TIME = 2.6
/** Seconds for the day/night transformation (one revolution). */
const MORPH_TIME = 1.4
/** Saya extent along its own +X (model units): mouth → end. */
const SAYA_X0 = 0.03
const SAYA_X1 = 0.8

function useKatanaModel(kind: KatanaKind): KatanaParts {
  const { scene } = useGLTF(KATANA_URLS[kind])
  const gl = useThree((s) => s.gl)
  return useMemo(() => {
    const root = scene.clone(true)
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    const morph = makeDissolve(new THREE.Vector3(0, 1, 0), 0.07)
    const sayaDis = makeDissolve(new THREE.Vector3(1, 0, 0), 0.06)
    const sayaNode = root.getObjectByName('Saya')
    const inSaya = (o: THREE.Object3D) => {
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === sayaNode) return true
      return false
    }
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      // the pommel chain is modelled as a straight line along the handle: with the handle up it
      // would stand stiffly upward, so it is left out
      if (/chain/i.test(mesh.name)) {
        mesh.visible = false
        return
      }
      mesh.castShadow = true
      mesh.receiveShadow = true
      const src = mesh.material as THREE.MeshPhysicalMaterial
      const mat = (src.isMeshPhysicalMaterial ? src.clone() : new THREE.MeshPhysicalMaterial().copy(src)) as THREE.MeshPhysicalMaterial
      for (const tex of [mat.map, mat.normalMap, mat.metalnessMap, mat.roughnessMap]) {
        if (tex) tex.anisotropy = maxAniso
      }
      const isBlade = /blade/i.test(mesh.name) || /steel/i.test(src.name)
      if (isBlade) {
        // polished steel: brushed streak along the blade, crimson toward the tip by night
        mat.envMapIntensity = 4.4
        mat.anisotropy = 0.35
        mat.anisotropyRotation = Math.PI / 2
      } else if (mat.metalness > 0.5) {
        mat.envMapIntensity = 2.6 // gold fittings, chain
      } else {
        // lacquer and silk: a clear lacquer coat on the hard parts, soft silk on the wraps
        // the white katana: less flat fill and a touch under pure white, so its form shades
        // and it stays the cleanest bright object against the pale day sky
        mat.envMapIntensity = kind === 'light' ? 0.7 : 1.4
        if (kind === 'light') mat.color.multiplyScalar(0.84)
        if (mat.roughness < 0.3) {
          mat.clearcoat = 0.6
          mat.clearcoatRoughness = 0.08
        }
      }
      patchKatanaMaterial(mat, {
        dissolve: inSaya(mesh) ? sayaDis : morph,
        blade: isBlade ? { tipY: BLADE_Y, amount: bladeTintAmount } : undefined,
      })
      mesh.material = mat
    })
    // The saya leaves along the blade's own curve: it turns about the centre of the blade's
    // arc, so the curved blade never passes through the saya wall.
    const saya = root.getObjectByName('Saya') ?? null
    const pivot = new THREE.Group()
    let arcRadius = 1e6
    let arcSign = 1
    let arcAxis: 'x' | 'z' = 'z'
    if (saya) {
      root.updateMatrixWorld(true)
      const arc = fitBladeArc(root)
      arcRadius = arc.radius
      arcSign = arc.sign
      arcAxis = arc.axis
      pivot.position.copy(arc.center)
      root.add(pivot)
      pivot.updateMatrixWorld(true)
      pivot.attach(saya)
    }
    // ash shed by the saya's burning edge (lives in the saya's own space)
    let particles: SayaParticles | null = null
    if (saya) {
      root.updateMatrixWorld(true)
      particles = makeSayaParticles(saya)
      saya.add(particles.points)
    }
    const bladeMats: THREE.MeshPhysicalMaterial[] = []
    root.traverse((c) => {
      const m = (c as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
      if ((c as THREE.Mesh).isMesh && m && m.envMapIntensity > 4) bladeMats.push(m)
    })
    return { root, saya, pivot, arcRadius, arcSign, arcAxis, bladeMats, morph, sayaDis, particles }
  }, [scene, gl, kind])
}

/** Circle through the blade's centreline, in the model's root frame (blade along +Y).
 *  Returns the arc centre, radius, the axis the saya turns about, and the turn direction
 *  that carries a point at the guard toward the tip. */
function fitBladeArc(root: THREE.Object3D) {
  const BINS = 24
  const lo = { x: new Float32Array(BINS).fill(Infinity), z: new Float32Array(BINS).fill(Infinity) }
  const hi = { x: new Float32Array(BINS).fill(-Infinity), z: new Float32Array(BINS).fill(-Infinity) }
  const v = new THREE.Vector3()
  root.traverse((c) => {
    const mesh = c as THREE.Mesh
    if (!mesh.isMesh || !/blade/i.test(mesh.name)) return
    const pos = mesh.geometry.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      const b = Math.floor(((v.y - 0.04) / (BLADE_Y - 0.06)) * BINS)
      if (b < 0 || b >= BINS) continue
      lo.x[b] = Math.min(lo.x[b], v.x); hi.x[b] = Math.max(hi.x[b], v.x)
      lo.z[b] = Math.min(lo.z[b], v.z); hi.z[b] = Math.max(hi.z[b], v.z)
    }
  })
  const pts = (k: 'x' | 'z') => {
    const out: [number, number][] = []
    for (let b = 0; b < BINS; b++) {
      if (lo[k][b] === Infinity) continue
      out.push([(lo[k][b] + hi[k][b]) / 2, 0.04 + ((b + 0.5) / BINS) * (BLADE_Y - 0.06)])
    }
    return out
  }
  const spread = (p: [number, number][]) => (p.length ? Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0])) : 0)
  const px = pts('x')
  const pz = pts('z')
  // the blade curves in the plane where its centreline wanders most
  const lateral: 'x' | 'z' = spread(px) >= spread(pz) ? 'x' : 'z'
  const p = lateral === 'x' ? px : pz
  const straight = { center: new THREE.Vector3(), radius: 1e6, sign: 1, axis: (lateral === 'x' ? 'z' : 'x') as 'x' | 'z' }
  if (p.length < 5) return straight
  // algebraic circle fit: a² + y² + D·a + E·y + F = 0
  let Saa = 0, Say = 0, Syy = 0, Sa = 0, Sy = 0, Sra = 0, Sry = 0, Sr = 0
  for (const [a, y] of p) {
    const r = a * a + y * y
    Saa += a * a; Say += a * y; Syy += y * y; Sa += a; Sy += y
    Sra += r * a; Sry += r * y; Sr += r
  }
  const n = p.length
  const M = new THREE.Matrix3().set(Saa, Say, Sa, Say, Syy, Sy, Sa, Sy, n)
  if (Math.abs(M.determinant()) < 1e-12) return straight
  const sol = new THREE.Vector3(-Sra, -Sry, -Sr).applyMatrix3(M.invert())
  const ca = -sol.x / 2
  const cy = -sol.y / 2
  const radius = Math.sqrt(Math.max(0, ca * ca + cy * cy - sol.z))
  if (!isFinite(radius) || radius < 0.5 || radius > 200) return straight
  const center = lateral === 'x' ? new THREE.Vector3(ca, cy, 0) : new THREE.Vector3(0, cy, ca)
  // which way round carries the guard (origin) toward +Y
  const axis: 'x' | 'z' = lateral === 'x' ? 'z' : 'x'
  const probe = new THREE.Vector3().sub(center).applyAxisAngle(axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), 0.01).add(center)
  return { center, radius, sign: probe.y > 0 ? 1 : -1, axis }
}

interface Pose {
  guard: THREE.Vector3
  quat: THREE.Quaternion
  dir: THREE.Vector3 // guard → tip (unit)
  sinkDepth: number // distance along the blade axis that fully submerges the sword
}

/** Guard + tip screen anchors → world pose with a fixed blade length (never scaled). */
function solvePose(cam: THREE.PerspectiveCamera, guardPct: { x: number; y: number }, tipPct: { x: number; y: number }, out: Pose) {
  const [gx, gy] = pctToNdc(guardPct.x, guardPct.y)
  const [tx, ty] = pctToNdc(tipPct.x, tipPct.y)
  pointAtNdc(cam, gx, gy, KATANA_DISTANCE, out.guard)
  // tip lies on the ray through its screen anchor, at blade length from the guard
  const o = cam.position
  const d = new THREE.Vector3(tx, ty, 0.5).unproject(cam).sub(o).normalize()
  const oc = new THREE.Vector3().subVectors(o, out.guard)
  const b = d.dot(oc)
  const c = oc.lengthSq() - BLADE_LEN * BLADE_LEN
  const disc = Math.max(0, b * b - c)
  const s1 = -b - Math.sqrt(disc)
  const s2 = -b + Math.sqrt(disc)
  // prefer the solution at a similar depth to the guard (blade roughly in the picture plane)
  const s = Math.abs(s1 - KATANA_DISTANCE) < Math.abs(s2 - KATANA_DISTANCE) ? s1 : s2
  const tip = o.clone().addScaledVector(d, s)
  out.dir.subVectors(tip, out.guard).normalize()
  // hover: the katana floats in mid-air, the tip a clear gap above the water
  const lift = Math.max(0, WATER_Y + HOVER_GAP - tip.y)
  out.guard.y += lift
  out.quat.setFromUnitVectors(DOWN, out.dir)
  // depth along the axis needed to put the pommel under the water
  const pommelAbove = out.guard.y + HANDLE_Y * SWORD_SCALE * Math.abs(out.dir.y) - WATER_Y
  out.sinkDepth = (pommelAbove + 0.25) / Math.max(0.3, Math.abs(out.dir.y))
}

const makePose = (): Pose => ({ guard: new THREE.Vector3(), quat: new THREE.Quaternion(), dir: new THREE.Vector3(0, -1, 0), sinkDepth: 5 })

/* camera at a path key, for composing the finale pose */
const _keyCam = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 220)
function keyCamera(i: number, aspect: number) {
  const k = CAMERA_PATH[i]
  _keyCam.aspect = aspect
  _keyCam.position.copy(k.pos)
  _keyCam.lookAt(k.target)
  _keyCam.updateProjectionMatrix()
  _keyCam.updateMatrixWorld()
  return _keyCam
}

/* burning edge and ash colours: crimson embers by night, warm gold by day */
const EDGE_NIGHT = new THREE.Color(1.0, 0.16, 0.07).multiplyScalar(3.2)
const EDGE_DAY = new THREE.Color(1.0, 0.72, 0.4).multiplyScalar(2.2)
const ASH_NIGHT = new THREE.Color(0.05, 0.035, 0.035)
const ASH_DAY = new THREE.Color(0.32, 0.3, 0.31)

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/* ─── Main Katana Container ─── */
export function Katana({ cursorRef }: KatanaProps) {
  const size = useThree((s) => s.size)

  const rootRef = useRef<THREE.Group>(null!)
  const sinkRef = useRef<THREE.Group>(null!)
  const tiltRef = useRef<THREE.Group>(null!)
  const orientRef = useRef<THREE.Group>(null!)
  const spinRef = useRef<THREE.Group>(null!)
  const tipRef = useRef<THREE.Object3D>(null!)
  const guardRef = useRef<THREE.Object3D>(null!)
  const dark = useKatanaModel('dark')
  const light = useKatanaModel('light')

  const poses = useRef({ hero: makePose(), finale: makePose() })
  const state = useRef({
    spin: REST_SPIN,
    tiltX: 0,
    tiltZ: 0,
    driftX: 0,
    driftY: 0,
    time: 0,
    /** which katana is out: follows the theme, swapped at the start of a reveal */
    kind: (sceneStore.day > 0.5 ? 'light' : 'dark') as KatanaKind,
    /** the draw 0 (sheathed) → 1 (blade out, saya burnt away) */
    draw: 0,
    /** what starts the draw: the intro rise or the finale rise */
    cue: 'intro' as 'intro' | 'finale',
    finaleWas: 0,
    /** day/night transformation 0 → 1 (1 = idle), and the katana it started from */
    morph: 1,
    morphFrom: 'dark' as KatanaKind,
  })

  // theme toggle: the hovering katana makes one revolution in mid-air while the other
  // theme's katana replaces it, sweeping from the pommel to the tip
  useLayoutEffect(
    () =>
      onSceneEvent('theme', () => {
        const s = state.current
        const next: KatanaKind = sceneStore.day > 0.5 ? 'light' : 'dark'
        if (next === s.kind) return
        s.morphFrom = s.kind
        s.kind = next
        s.draw = 1 // a toggle during the draw finishes it
        s.morph = sceneStore.reducedMotion ? 1 : 0
      }),
    []
  )

  // nav jump (screen covered by the slash): settle the spin spring instantly instead of unwinding turns
  useLayoutEffect(
    () =>
      onSceneEvent('jump', () => {
        const vh = Math.max(1, window.innerHeight)
        state.current.spin = REST_SPIN + (sceneStore.scrollY / vh) * TURN_PER_VIEWPORT
      }),
    []
  )

  // Composition from the reference anchors, against the fixed hero camera
  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const mobile = isMobileViewport()
    solvePose(
      heroCamera(aspect),
      mobile ? HERO_LAYOUT.guardMobile : HERO_LAYOUT.guard,
      mobile ? HERO_LAYOUT.tipMobile : HERO_LAYOUT.tip,
      poses.current.hero
    )
    // finale: more upright, a little closer to centre, between the heading and the links
    solvePose(keyCamera(CAMERA_PATH.length - 1, aspect), mobile ? { x: 55, y: 26 } : { x: 51.5, y: 22 }, mobile ? { x: 52, y: 72 } : { x: 48.5, y: 80 }, poses.current.finale)
  }, [size])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const s = state.current
    const reduced = sceneStore.reducedMotion
    s.time += delta

    /* 1. Pose + sink/rise offset layer (separate from spin and cursor layers) */
    const finale = sceneStore.katanaFinale
    const inFinale = finale > 0.001
    const pose = inFinale ? poses.current.finale : poses.current.hero
    // finale entered again (scrolled into Enquire): rise sheathed and draw once more
    if (finale > 0.001 && s.finaleWas <= 0.001 && !reduced) {
      s.draw = 0
      s.cue = 'finale'
    }
    s.finaleWas = finale

    // the draw: the sword rises the last stretch out of its saya (which holds still in the
    // air), then the saya burns away from the mouth down, shedding ash
    const cueUp = s.cue === 'intro' ? sceneStore.katanaRise > 0.9 : finale > 0.9
    if (reduced) s.draw = 1
    else if (s.draw < 1 && cueUp) s.draw = Math.min(1, s.draw + delta / DRAW_TIME)
    const d = s.draw
    const riseE = easeInOutCubic(Math.min(1, d / 0.35))
    const liftUnder = (DRAW_RISE / pose.sinkDepth) * (1 - riseE)
    const under = inFinale
      ? Math.max(1 - easeOutExpo(finale), liftUnder)
      : Math.max(1 - easeOutExpo(sceneStore.katanaRise), easeInOutCubic(sceneStore.katanaSink), liftUnder)
    const visible = under < 0.999
    sceneStore.swordVisible = visible
    rootRef.current.visible = visible

    rootRef.current.position.copy(pose.guard)
    orientRef.current.quaternion.copy(pose.quat)
    // hover: a slow bob and a slight sway, never down to the water
    const hover = reduced ? 0 : 1 - under
    sinkRef.current.position.copy(pose.dir).multiplyScalar(pose.sinkDepth * under)
    sinkRef.current.position.y += Math.sin(s.time * 0.9) * 0.03 * hover
    sinkRef.current.rotation.set(Math.sin(s.time * 0.53) * 0.012 * hover, 0, Math.sin(s.time * 0.71 + 1.3) * 0.014 * hover)

    /* 1b. Which katana shows, the transformation between them, and the saya */
    if (s.morph < 1) s.morph = Math.min(1, s.morph + delta / MORPH_TIME)
    const morphing = s.morph < 1
    const model = s.kind === 'light' ? light : dark
    const other = s.kind === 'light' ? dark : light
    model.root.visible = true
    other.root.visible = morphing && s.morphFrom !== s.kind
    const me = easeInOutCubic(s.morph)
    // the front sweeps from the pommel (model y ≈ −0.33) past the tip (≈ 0.72)
    const front = THREE.MathUtils.lerp(-0.42, 0.82, me)
    const edgeCol = s.kind === 'light' ? EDGE_DAY : EDGE_NIGHT
    for (const [m, keep] of [
      [model, -1],
      [other, 1],
    ] as const) {
      m.morph.uDisOn.value = morphing ? 1 : 0
      m.morph.uDisFront.value = front
      m.morph.uDisKeep.value = keep
      m.morph.uDisEdge.value.copy(edgeCol)
      m.morph.uDisRef.value.copy(m.root.matrixWorld).invert()
    }
    if (other.saya) other.saya.visible = false

    const saya = model.saya
    if (saya) {
      // the saya holds still in the air while the sword rises out of it
      const angle = model.arcSign * ((DRAW_RISE / SWORD_SCALE) * riseE / model.arcRadius)
      model.pivot.rotation.set(model.arcAxis === 'x' ? angle : 0, 0, model.arcAxis === 'z' ? angle : 0)
      // then it burns away from the mouth down
      const burn = Math.max(0, (d - 0.3) / 0.7)
      const sayaFront = THREE.MathUtils.lerp(SAYA_X0 - 0.06, SAYA_X1 + 0.35, easeInOutCubic(burn))
      saya.visible = d < 1 && !morphing
      model.sayaDis.uDisOn.value = burn > 0 ? 1 : 0
      model.sayaDis.uDisFront.value = sayaFront
      model.sayaDis.uDisKeep.value = 1
      model.sayaDis.uDisEdge.value.copy(edgeCol)
      model.sayaDis.uDisRef.value.copy(saya.matrixWorld).invert()
      const pt = model.particles
      if (pt) {
        pt.points.visible = burn > 0 && d < 1
        pt.uniforms.uFront.value = sayaFront
        pt.uniforms.uTime.value = s.time
        pt.uniforms.uColor.value.copy(s.kind === 'light' ? ASH_DAY : ASH_NIGHT)
        pt.uniforms.uHot.value.copy(edgeCol)
      }
      // a glint runs down the steel as it clears the saya
      const glint = Math.sin(Math.PI * Math.min(1, Math.max(0, (d - 0.2) / 0.6)))
      for (const m of model.bladeMats) m.envMapIntensity = 4.4 + 2.2 * glint
    }

    /* 2. Scroll-driven spin    /* 2. Scroll-driven spin around the blade axis, followed by a critically damped spring;
          the finale blends to the nearest calm rest angle. */
    const vh = Math.max(1, window.innerHeight)
    const scrollSpin = REST_SPIN + (sceneStore.scrollY / vh) * TURN_PER_VIEWPORT
    const rest = REST_SPIN + TAU * Math.round((scrollSpin - REST_SPIN) / TAU)
    const target = THREE.MathUtils.lerp(scrollSpin, rest, easeInOutCubic(finale))
    const prev = s.spin
    s.spin = reduced ? target : THREE.MathUtils.damp(s.spin, target, SPIN_LAMBDA, delta)
    sceneStore.swordSpin = (s.spin - prev) / Math.max(delta, 1e-4)
    spinRef.current.rotation.y = s.spin + TAU * easeInOutCubic(s.morph < 1 ? s.morph : 0)

    /* 3. Cursor: subtle opposite-direction tilt + drift, separate damped layer */
    const cursor = cursorRef?.current
    const cx = cursor ? cursor.x : 0
    const cy = cursor ? cursor.y : 0
    const k = reduced ? 0 : 1
    s.tiltZ = THREE.MathUtils.damp(s.tiltZ, cx * 0.045 * k, 2.2, delta)
    s.tiltX = THREE.MathUtils.damp(s.tiltX, cy * 0.035 * k, 2.2, delta)
    s.driftX = THREE.MathUtils.damp(s.driftX, -cx * 0.06 * k, 2.0, delta)
    s.driftY = THREE.MathUtils.damp(s.driftY, cy * 0.03 * k, 2.0, delta)
    tiltRef.current.rotation.set(s.tiltX, 0, s.tiltZ)
    tiltRef.current.position.set(s.driftX, s.driftY, 0)

    /* 4. Day: polished steel (no crimson); night: crimson toward the tip */
    bladeTintAmount.value = 1 - sceneStore.day

    /* 5. Publish tip / guard positions for the water and depth of field */
    tipRef.current.getWorldPosition(sceneStore.swordTip)
    guardRef.current.getWorldPosition(sceneStore.swordCenter)
  })

  return (
    <>
      <group ref={rootRef}>
        <group ref={sinkRef}>
          <group ref={tiltRef}>
            <group ref={orientRef}>
              <group ref={spinRef} rotation={[0, REST_SPIN, 0]}>
                {/* model origin at the guard, blade along +Y: flip so the handle is on top */}
                <group rotation={[Math.PI, 0, 0]} scale={SWORD_SCALE}>
                  <primitive object={dark.root} />
                  <primitive object={light.root} />
                </group>
                {/* blade tip (model +Y 0.699, flipped) and a focus point on the upper blade */}
                <object3D ref={tipRef} position={[0, -BLADE_LEN, 0]} />
                <object3D ref={guardRef} position={[0, -0.6, 0]} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </>
  )
}

// Preload the GLB model for instant WebGL instantiation
useGLTF.preload(KATANA_URLS.dark)
useGLTF.preload(KATANA_URLS.light)

export default Katana
