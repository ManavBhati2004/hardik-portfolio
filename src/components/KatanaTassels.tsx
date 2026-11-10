import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { sceneStore } from '../scene/store'
import { bakeGeometry } from '../scene/bakeGeometry'
import type { CursorRef } from './Scene3D'

export interface KatanaTasselProps {
  /** Tie point on the handle (world transform is read every frame). */
  anchorRef: React.RefObject<THREE.Object3D | null>
  cursorRef: CursorRef
  scale: number
}

/* Moves wind/hang data out of `color` so the GLTF loader does not tint the silk with it */
function takeData(geo: THREE.BufferGeometry) {
  const g = geo.clone()
  const c = g.getAttribute('color')
  if (c) {
    g.setAttribute('hangData', c)
    g.deleteAttribute('color')
  }
  return g
}

/**
 * Silk sword tassel (model built in Blender: twisted cord, knot, binding, fringe).
 * Hangs from the handle under gravity; a damped pendulum reacts to the hilt's real
 * motion (scroll spin, cursor drift, entrance) and the strands bend/flutter in the
 * vertex shader by their hang weight.
 */
export function KatanaTassel({ anchorRef, cursorRef, scale }: KatanaTasselProps) {
  const { scene } = useGLTF('/models/tassel.opt.glb')
  const groupRef = useRef<THREE.Group>(null!)

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLag: { value: new THREE.Vector3() },
    }),
    []
  )

  const { geometry, material } = useMemo(() => {
    let geo: THREE.BufferGeometry | null = null
    let src: THREE.MeshStandardMaterial | null = null
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !geo) {
        geo = takeData(bakeGeometry(m, scene))
        src = m.material as THREE.MeshStandardMaterial
      }
    })
    const s = src as THREE.MeshStandardMaterial | null
    const mat = new THREE.MeshPhysicalMaterial({
      map: s?.map ?? null,
      normalMap: s?.normalMap ?? null,
      color: new THREE.Color(1.9, 1.5, 1.5),
      roughness: 0.52,
      metalness: 0,
      sheen: 1,
      sheenColor: new THREE.Color('#c0303a'),
      sheenRoughness: 0.42,
      envMapIntensity: 0.9,
      side: THREE.DoubleSide,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime
      shader.uniforms.uLag = uniforms.uLag
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute vec4 hangData;
           uniform float uTime;
           uniform vec3 uLag;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float w = hangData.r;
           float bend = w * w;
           // trailing lag of the lower cord/fringe (local metres)
           transformed += uLag * bend;
           // fine fringe flutter, de-synchronised per strand
           float fr = smoothstep(0.62, 1.0, w);
           transformed.x += sin(uTime * 2.3 + hangData.g * 37.0) * 0.0016 * fr;
           transformed.z += cos(uTime * 1.9 + hangData.g * 23.0) * 0.0016 * fr;`
        )
    }
    return { geometry: geo as THREE.BufferGeometry | null, material: mat }
  }, [scene, uniforms])

  const sim = useRef({
    prevPos: new THREE.Vector3(),
    prevVel: new THREE.Vector3(),
    init: false,
    ax: 0,
    vx: 0,
    az: 0,
    vz: 0,
    lag: new THREE.Vector3(),
    time: 0,
  })
  const tmpPos = useMemo(() => new THREE.Vector3(), [])
  const tmpVel = useMemo(() => new THREE.Vector3(), [])
  const tmpAcc = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, rawDelta) => {
    const anchor = anchorRef.current
    const g = groupRef.current
    if (!anchor || !g) return
    const dt = Math.min(rawDelta, 0.05)
    const s = sim.current
    s.time += dt
    uniforms.uTime.value = s.time

    anchor.getWorldPosition(tmpPos)
    if (!s.init) {
      s.prevPos.copy(tmpPos)
      s.init = true
    }
    tmpVel.subVectors(tmpPos, s.prevPos).divideScalar(Math.max(dt, 1e-4))
    tmpAcc.subVectors(tmpVel, s.prevVel).divideScalar(Math.max(dt, 1e-4))
    tmpAcc.clampLength(0, 30)
    s.prevPos.copy(tmpPos)
    s.prevVel.copy(tmpVel)

    const reduced = sceneStore.reducedMotion
    const cursor = cursorRef?.current
    const breeze = reduced ? 0 : Math.sin(s.time * 0.55) * 0.35 + Math.sin(s.time * 1.27 + 1.3) * 0.18
    const spinPush = THREE.MathUtils.clamp(sceneStore.swordSpin, -6, 6) * 0.35
    const cursorPush = cursor ? cursor.smoothX * 0.2 : 0

    // damped pendulum (stiffness ~ g/L), driven by the hilt's acceleration
    const K = 7.5
    const C = 2.4
    const fz = -K * s.az - C * s.vz + tmpAcc.x * 0.09 + breeze * 0.25 + spinPush - cursorPush
    const fx = -K * s.ax - C * s.vx - tmpAcc.z * 0.09 + breeze * 0.12
    s.vz += fz * dt
    s.vx += fx * dt
    s.az += s.vz * dt
    s.ax += s.vx * dt
    s.az = THREE.MathUtils.clamp(s.az, -0.6, 0.6)
    s.ax = THREE.MathUtils.clamp(s.ax, -0.5, 0.5)

    g.visible = sceneStore.swordVisible
    g.position.copy(tmpPos)
    g.rotation.set(s.ax, 0, s.az)

    // lower strands trail behind the hilt's velocity (in local metres)
    s.lag.set(-tmpVel.x * 0.006, 0, -tmpVel.z * 0.006).clampLength(0, 0.03)
    uniforms.uLag.value.lerp(s.lag, 1 - Math.exp(-6 * dt))
  })

  if (!geometry) return null
  return (
    <group ref={groupRef} scale={scale}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  )
}

useGLTF.preload('/models/tassel.opt.glb')

export default KatanaTassel
