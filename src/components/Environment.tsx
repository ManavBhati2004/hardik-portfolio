import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { Rocks, type RockPlacement } from './Rocks'
import { TORII_XZ, WATER_Y } from '../scene/config'


/* ───────────────────────────────────────────────────────────────────────────
   Myōjin torii (built in Blender: scripts/blender/build_torii.py) on the
   far-right cliff. It is planted on the actual rock surface by raycasting
   down onto the cliff.
   ─────────────────────────────────────────────────────────────────────────── */
function ToriiShrineModel({ groundName }: { groundName: string }) {
  const { scene } = useGLTF('/models/torii.opt.glb')
  const ref = useRef<THREE.Group>(null!)

  const clonedScene = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((mat) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return
        const name = (mat.name || '').toLowerCase()
        if (name.includes('roof')) {
          mat.color = new THREE.Color('#0b0b0d')
          mat.roughness = 0.55
        } else if (name.includes('stone') || name.includes('feet')) {
          mat.color = new THREE.Color('#3a3a3e')
          mat.roughness = 0.9
        } else if (name.includes('plaque')) {
          // the blank gakuzuka plaque: dark weathered wood inside its black frame
          mat.color = new THREE.Color('#1c1612')
          mat.roughness = 0.8
        } else {
          // weathered vermilion lacquer, kept dark so it sits in the night
          mat.color = new THREE.Color('#6a120e')
          mat.roughness = 0.55
        }
        mat.metalness = 0
        mat.envMapIntensity = 0.8
        mat.needsUpdate = true
      })
    })
    return clone
  }, [scene])

  useLayoutEffect(() => {
    const root = ref.current.parent
    const ground = root?.getObjectByName(groundName)
    if (!ground) return
    ground.updateWorldMatrix(true, true)
    const ray = new THREE.Raycaster(new THREE.Vector3(TORII_XZ.x, 20, TORII_XZ.y), new THREE.Vector3(0, -1, 0))
    const hit = ray.intersectObject(ground, true)[0]
    ref.current.position.set(TORII_XZ.x, hit ? hit.point.y - 0.04 : WATER_Y + 1.6, TORII_XZ.y)
  }, [groundName])

  return (
    <group ref={ref} position={[TORII_XZ.x, WATER_Y + 1.6, TORII_XZ.y]} rotation={[0, -0.35, 0]} scale={0.23}>
      {/* the torii model's origin sits at its middle; lift so its feet touch the ground */}
      <group position={[0, 1.82, 0]}>
        <primitive object={clonedScene} />
      </group>
    </group>
  )
}

/* ───────────────────────────────────────────────────────────────────────────
   Rock layout per the reference (visible water band starts at z ≈ 1):
   - left foreground: low, layered group
   - right foreground: long flat slab reaching toward the centre
   - far right: tall rock mass under the torii, receding into the fog
   - centre stays open water below the sword
   ─────────────────────────────────────────────────────────────────────────── */
const ROCKS: RockPlacement[] = [
  // far-right headland carrying the torii, with the big scanned cliff behind it
  { model: 'coast05', name: 'torii-base', position: [8.7, WATER_Y - 0.5, -8.4], rotation: [0, 2.2, 0], scale: [1.8, 2.05, 1.7], tone: 0.49 },
  { model: 'coast05', position: [6.2, WATER_Y - 0.5, -6.4], rotation: [0, -0.7, 0], scale: [1.4, 1.15, 1.3], tone: 0.45 },
  { model: 'coast05', position: [11.6, WATER_Y - 0.5, -7.0], rotation: [0, 0.9, 0], scale: [1.5, 2.6, 1.5], tone: 0.43 },
  { model: 'cliff', position: [16, WATER_Y - 0.4, -17], rotation: [0, -2.4, 0], scale: 0.22, tone: 0.41 },
  // right foreground slab
  { model: 'boulder02', position: [3.0, WATER_Y - 0.24, 0.8], rotation: [0, 2.85, 0], scale: [1.9, 0.62, 1.3], tone: 0.61 },
  // (the close-up boulders cycle through the boulder variants, see ROCK_FILES in Rocks.tsx)
  { model: 'boulder02', position: [1.35, WATER_Y - 0.12, 3.0], rotation: [0, 1.2, 0], scale: [0.36, 0.2, 0.3], tone: 0.57 },
  // left foreground group
  { model: 'coast05', position: [-3.9, WATER_Y - 0.32, 2.4], rotation: [0, -0.6, 0], scale: [0.72, 0.4, 0.72], tone: 0.54 },
  { model: 'boulder02', position: [-2.0, WATER_Y - 0.16, 3.5], rotation: [0, 2.4, 0], scale: [0.48, 0.28, 0.42], tone: 0.59 },
  { model: 'boulder02', position: [-5.6, WATER_Y - 0.22, -0.6], rotation: [0, 0.4, 0], scale: 0.85, tone: 0.49 },
  // distant low shoreline on the left, mostly in the fog
  { model: 'coast01', position: [-16, WATER_Y - 0.15, -20], rotation: [0, 0.6, 0], scale: 0.16, tone: 0.41 },
]

export function Environment() {
  return (
    <group>
      <Rocks placements={ROCKS} />
      <ToriiShrineModel groundName="torii-base" />
    </group>
  )
}

useGLTF.preload('/models/torii.opt.glb')

export default Environment
