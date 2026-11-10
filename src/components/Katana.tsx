import { useRef, useMemo, useLayoutEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { KatanaTassel } from './KatanaTassels'
import { onSceneEvent, sceneStore } from '../scene/store'
import { pointAtNdc, isMobileViewport, heroCamera, pctToNdc } from '../scene/placement'
import { CAMERA_FOV, CAMERA_PATH, HERO_LAYOUT, KATANA_DISTANCE, WATER_Y } from '../scene/config'
import type { CursorRef } from './Scene3D'

/* ─── Props ─── */
export interface KatanaProps {
  cursorRef: CursorRef
}

/** Uploaded katana; textures resized to 2K for the web (source kept in assets-src/). */
const KATANA_URL = '/models/katana.opt.glb'
/** Uniform model scale — fixed, never animated. */
const SWORD_SCALE = 3.3
/** Model-space blade extent (+Y from the tsuba) and handle length (−Y). */
const BLADE_Y = 0.696
const HANDLE_Y = 0.307
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
function addBladeGradient(mat: THREE.MeshPhysicalMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBladeTint = { value: new THREE.Color(1.0, 0.12, 0.1) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying float vBladeY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vBladeY = position.y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying float vBladeY;\n uniform vec3 uBladeTint;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           // 0 at the upper blade → 1 at the tip (lower third reads crimson)
           float bw = smoothstep(${(BLADE_Y * 0.36).toFixed(3)}, ${(BLADE_Y * 0.97).toFixed(3)}, vBladeY);
           bw = pow(bw, 1.25);
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

/* ─── The uploaded antique katana with its own PBR texture maps ─── */
function AntiqueKatanaModel() {
  const { scene } = useGLTF(KATANA_URL)
  const gl = useThree((s) => s.gl)

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const src = mesh.material as THREE.MeshStandardMaterial
      const mat = new THREE.MeshPhysicalMaterial({
        map: src.map,
        normalMap: src.normalMap,
        metalnessMap: src.metalnessMap,
        roughnessMap: src.roughnessMap,
        color: new THREE.Color(1, 1, 1),
        metalness: 1.0,
        roughness: 1.0,
        envMapIntensity: 4.4,
        normalScale: new THREE.Vector2(1, 1),
        side: src.side,
        // brushed-steel streak along the blade
        anisotropy: 0.35,
        anisotropyRotation: Math.PI / 2,
        specularIntensity: 1,
      })
      for (const tex of [mat.map, mat.normalMap, mat.metalnessMap, mat.roughnessMap]) {
        if (tex) tex.anisotropy = maxAniso
      }
      addBladeGradient(mat)
      mesh.material = mat
    })
    return clone
  }, [scene, gl])

  // Model origin is at the guard (tsuba); blade points +Y. Flip so the handle is on top.
  return (
    <group rotation={[Math.PI, 0, 0]} scale={SWORD_SCALE}>
      <primitive object={clonedScene} />
    </group>
  )
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
  const tasselAnchorRef = useRef<THREE.Object3D>(null!)

  const poses = useRef({ hero: makePose(), finale: makePose() })
  const state = useRef({
    spin: REST_SPIN,
    tiltX: 0,
    tiltZ: 0,
    driftX: 0,
    driftY: 0,
    time: 0,
  })

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
    solvePose(keyCamera(4, aspect), mobile ? { x: 55, y: 26 } : { x: 51.5, y: 22 }, mobile ? { x: 52, y: 72 } : { x: 48.5, y: 80 }, poses.current.finale)
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
    const under = inFinale
      ? 1 - easeOutExpo(finale)
      : Math.max(1 - easeOutExpo(sceneStore.katanaRise), easeInOutCubic(sceneStore.katanaSink))
    const visible = under < 0.999
    sceneStore.swordVisible = visible
    rootRef.current.visible = visible

    rootRef.current.position.copy(pose.guard)
    orientRef.current.quaternion.copy(pose.quat)
    const bob = reduced ? 0 : Math.sin(s.time * 0.9) * 0.025 * (1 - under)
    // slide along the blade's own axis — tip first out of the water
    sinkRef.current.position.copy(pose.dir).multiplyScalar(pose.sinkDepth * under)
    sinkRef.current.position.y += bob

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

    /* 4. Publish tip / guard positions for the water and depth of field */
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
                <AntiqueKatanaModel />
                {/* blade tip (model +Y 0.696, flipped) and a focus point on the upper blade */}
                <object3D ref={tipRef} position={[0, -BLADE_LEN, 0]} />
                <object3D ref={guardRef} position={[0, -0.6, 0]} />
                {/* cord tie point on the handle just above the guard */}
                <object3D ref={tasselAnchorRef} position={[0.045, 0.2, 0.0]} />
              </group>
            </group>
          </group>
        </group>
      </group>
      <KatanaTassel anchorRef={tasselAnchorRef} cursorRef={cursorRef} scale={SWORD_SCALE} />
    </>
  )
}

// Preload the GLB model for instant WebGL instantiation
useGLTF.preload(KATANA_URL)

export default Katana
