import { useRef, useMemo, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { onSceneEvent, sceneStore } from '../scene/store'
import { pointAtNdc, isMobileViewport, heroCamera, pctToNdc } from '../scene/placement'
import { CAMERA_FOV, CAMERA_PATH, HERO_LAYOUT, KATANA_DISTANCE, WATER_Y } from '../scene/config'
import type { CursorRef } from './Scene3D'

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

function addBladeGradient(mat: THREE.MeshPhysicalMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBladeTint = { value: new THREE.Color(1.0, 0.12, 0.1) }
    shader.uniforms.uBladeAmt = bladeTintAmount
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vBladeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBladeY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vBladeY;\n uniform vec3 uBladeTint;\n uniform float uBladeAmt;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           // 0 at the upper blade → 1 at the tip (lower third reads crimson)
           float bw = smoothstep(${(BLADE_Y * 0.36).toFixed(3)}, ${(BLADE_Y * 0.97).toFixed(3)}, vBladeY);
           bw = pow(bw, 1.25) * uBladeAmt;
           vec3 tint = mix(vec3(1.0), uBladeTint * 1.55, bw);
           reflectedLight.directSpecular *= tint;
           reflectedLight.indirectSpecular *= tint;
           // faint crimson environment picked up from the moon and the lit water
           float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
           reflectedLight.indirectSpecular += uBladeTint * bw * (0.05 + 0.1 * fres);
         }`
      )
  }
  mat.customProgramCacheKey = () => 'katana-blade-gradient'
}

/* ─── One katana model: its authored materials, tuned for the scene's lighting ─── */
interface KatanaParts {
  root: THREE.Object3D
  saya: THREE.Object3D | null
}

function useKatanaModel(kind: KatanaKind): KatanaParts {
  const { scene } = useGLTF(KATANA_URLS[kind])
  const gl = useThree((s) => s.gl)
  return useMemo(() => {
    const root = scene.clone(true)
    const maxAniso = gl.capabilities.getMaxAnisotropy()
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
        addBladeGradient(mat)
      } else if (mat.metalness > 0.5) {
        mat.envMapIntensity = 2.6 // gold fittings, chain
      } else {
        // lacquer and silk: a clear lacquer coat on the hard parts, soft silk on the wraps
        mat.envMapIntensity = 1.4
        if (mat.roughness < 0.3) {
          mat.clearcoat = 0.6
          mat.clearcoatRoughness = 0.08
        }
      }
      mesh.material = mat
    })
    return { root, saya: root.getObjectByName('Saya') ?? null }
  }, [scene, gl])
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
  const sayaMouthRef = useRef(new THREE.Vector3())
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
    /** own rise for reveals not driven by the intro / finale (theme toggle) 0 → 1 */
    rise: 1,
    /** saya slide 0 (sheathed) → 1 (gone under the water) */
    draw: 0,
    /** what starts the draw: 'intro' (katanaRise), 'finale' (katanaFinale), 'own' (rise) */
    cue: 'intro' as 'intro' | 'finale' | 'own',
    sayaWasAbove: true,
    finaleWas: 0,
  })

  // theme toggle: the other theme's katana rises sheathed and is drawn again
  useLayoutEffect(
    () =>
      onSceneEvent('theme', () => {
        const s = state.current
        s.kind = sceneStore.day > 0.5 ? 'light' : 'dark'
        if (sceneStore.reducedMotion) return
        s.rise = 0
        s.draw = 0
        s.cue = 'own'
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
      s.rise = 1
    }
    s.finaleWas = finale
    if (s.rise < 1) s.rise = Math.min(1, s.rise + delta / 1.7)
    const ownUnder = 1 - easeOutExpo(s.rise)
    const under = inFinale
      ? Math.max(1 - easeOutExpo(finale), ownUnder)
      : Math.max(1 - easeOutExpo(sceneStore.katanaRise), easeInOutCubic(sceneStore.katanaSink), ownUnder)
    const visible = under < 0.999
    sceneStore.swordVisible = visible
    rootRef.current.visible = visible

    rootRef.current.position.copy(pose.guard)
    orientRef.current.quaternion.copy(pose.quat)
    const bob = reduced ? 0 : Math.sin(s.time * 0.9) * 0.025 * (1 - under)
    // slide along the blade's own axis — tip first out of the water
    sinkRef.current.position.copy(pose.dir).multiplyScalar(pose.sinkDepth * under)
    sinkRef.current.position.y += bob

    /* 1b. The reveal: once the sheathed sword is up, the saya slides off down the blade
          (toward the tip, into the water), leaves with a slight tilt and sinks back in. */
    const cueUp = s.cue === 'intro' ? sceneStore.katanaRise > 0.82 : s.cue === 'finale' ? finale > 0.85 : s.rise > 0.82
    if (reduced) s.draw = 1
    else if (s.draw < 1 && cueUp) s.draw = Math.min(1, s.draw + delta / 1.6)
    const model = s.kind === 'light' ? light : dark
    const other = s.kind === 'light' ? dark : light
    model.root.visible = true
    other.root.visible = false
    const saya = model.saya
    if (saya) {
      const d = s.draw
      // a short pull to free it, then it falls along the blade under its own weight
      const pull = Math.min(1, d / 0.12)
      const fall = Math.max(0, (d - 0.12) / 0.88)
      // model units: from the guard to well below the water along the blade axis
      const reach = (Math.max(0.3, (pose.guard.y - WATER_Y) / Math.max(0.3, Math.abs(pose.dir.y))) + 1.2) / SWORD_SCALE
      // (the saya node keeps the file's own frame: the blade runs along its local +X)
      saya.position.set(0.012 * easeOutExpo(pull) + reach * fall * fall, 0, 0)
      saya.rotation.set(0, 0, 0.16 * fall * fall * fall)
      saya.visible = d < 1
      // splash where the saya mouth goes through the surface
      saya.getWorldPosition(sayaMouthRef.current)
      const above = sayaMouthRef.current.y > WATER_Y
      if (s.sayaWasAbove && !above && d > 0 && d < 1) {
        sceneStore.splash.x = sayaMouthRef.current.x
        sceneStore.splash.z = sayaMouthRef.current.z
        sceneStore.splash.strength = 0.05
      }
      s.sayaWasAbove = above || d === 0
    }

    /* 2. Scroll-driven spin around the blade axis, followed by a critically damped spring;
          the finale blends to the nearest calm rest angle. */
    const vh = Math.max(1, window.innerHeight)
    const scrollSpin = REST_SPIN + (sceneStore.scrollY / vh) * TURN_PER_VIEWPORT
    const rest = REST_SPIN + TAU * Math.round((scrollSpin - REST_SPIN) / TAU)
    const target = THREE.MathUtils.lerp(scrollSpin, rest, easeInOutCubic(finale))
    const prev = s.spin
    s.spin = reduced ? target : THREE.MathUtils.damp(s.spin, target, SPIN_LAMBDA, delta)
    sceneStore.swordSpin = (s.spin - prev) / Math.max(delta, 1e-4)
    spinRef.current.rotation.y = s.spin

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
