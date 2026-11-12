import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { petalGeometry } from './blossomGeometry'
import { ambientMotion, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Cherry petals drifting down from the branch. Lives inside the branch's group
   (positions are relative to the branch root, just beyond the top-left corner),
   so the petals leave the frame with the branch during the camera journey.
   Each petal flutters (tumbling + side-to-side swing), drifts with the breeze and
   recycles under the branch. Time-based; slowed by reduced motion.
   ───────────────────────────────────────────────────────────────────────────── */

const COUNT = 26

interface Petal {
  p: THREE.Vector3
  rot: THREE.Euler
  spin: THREE.Vector3
  fall: number
  swing: number
  phase: number
  size: number
}

function rand(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
}

export function FallingPetals() {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const rnd = useMemo(() => rand(4242), [])
  const geo = useMemo(() => petalGeometry(), [])
  const mat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.6,
        metalness: 0,
        side: THREE.DoubleSide,
        color: new THREE.Color(1.0, 0.8, 0.86),
        emissive: new THREE.Color('#3a1418'),
        emissiveIntensity: 0.2,
        envMapIntensity: 0.6,
      }),
    []
  )

  const spawn = (pt: Petal, initial: boolean) => {
    // under the branch: right of the root, slightly in front of it
    pt.p.set(0.3 + rnd() * 2.1, initial ? -0.2 - rnd() * 3.6 : -0.15 - rnd() * 0.7, -0.4 + rnd() * 0.9)
    pt.rot.set(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2)
    pt.spin.set((rnd() - 0.5) * 2.2, (rnd() - 0.5) * 1.6, (rnd() - 0.5) * 2.6)
    pt.fall = 0.16 + rnd() * 0.16
    pt.swing = 0.25 + rnd() * 0.35
    pt.phase = rnd() * Math.PI * 2
    pt.size = 0.045 + rnd() * 0.035
  }

  const petals = useMemo(() => {
    const list: Petal[] = []
    for (let i = 0; i < COUNT; i++) {
      const pt: Petal = { p: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), fall: 0, swing: 0, phase: 0, size: 0 }
      spawn(pt, true)
      list.push(pt)
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), s: new THREE.Vector3(), v: new THREE.Vector3(), time: 0 }), [])

  useFrame((_, raw) => {
    const mesh = meshRef.current
    if (!mesh) return
    const dt = Math.min(raw, 0.05) * ambientMotion()
    tmp.time += dt
    const t = tmp.time
    // a light breeze that slowly changes strength
    const breeze = 0.07 + 0.05 * Math.sin(t * 0.21)
    for (let i = 0; i < COUNT; i++) {
      const pt = petals[i]
      // flutter: a petal falls slower while it is broadside, faster when edge-on
      const flutter = 0.65 + 0.35 * Math.abs(Math.sin(pt.rot.x))
      pt.p.y -= pt.fall * flutter * dt
      pt.p.x += (breeze + Math.sin(t * 1.3 + pt.phase) * pt.swing * 0.6) * dt
      pt.p.z += Math.cos(t * 0.9 + pt.phase) * 0.05 * dt
      pt.rot.x += pt.spin.x * dt
      pt.rot.y += pt.spin.y * dt
      pt.rot.z += pt.spin.z * dt
      if (pt.p.y < -4.2 || pt.p.x > 3.8) spawn(pt, false)
      tmp.q.setFromEuler(pt.rot)
      tmp.s.setScalar(pt.size)
      tmp.v.copy(pt.p)
      tmp.m.compose(tmp.v, tmp.q, tmp.s)
      mesh.setMatrixAt(i, tmp.m)
    }
    mesh.instanceMatrix.needsUpdate = true
    // petals read pale pink by day, softly lit by the moon at night
    mat.emissive.set(sceneStore.day > 0.5 ? '#5a3a3e' : '#3a1418')
  })

  return <instancedMesh ref={meshRef} args={[geo, mat, COUNT]} frustumCulled={false} />
}

export default FallingPetals
