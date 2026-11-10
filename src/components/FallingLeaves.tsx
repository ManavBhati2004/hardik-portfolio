import { useRef, useMemo, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { ambientMotion } from '../scene/store'
import { bakeGeometry } from '../scene/bakeGeometry'

/** Reference shows only ~4–6 red leaves in frame at once. */
const LEAF_COUNT = 6
const LEAF_COLORS = ['#9E1A1A', '#7A1010', '#B32626', '#8C1418', '#A52020']
const RESET_Y_MIN = -2.15
const RESET_Y_MAX = 5.8

interface LeafPhysics {
  x: number
  y: number
  z: number
  scale: number
  rotX: number
  rotY: number
  rotZ: number
  fallSpeed: number
  swayAmplitude: number
  swayPeriod: number
  swayOffset: number
  tumbleSpeedX: number
  tumbleSpeedY: number
  tumbleSpeedZ: number
  colorIndex: number
}

function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function createLeafPhysics(rand: () => number): LeafPhysics {
  return {
    x: (rand() - 0.5) * 13,
    y: rand() * 8 - 1.5,
    z: (rand() - 0.5) * 8 - 1,
    scale: 0.08 + rand() * 0.09, // Proper scale for the 1.5-unit ZBrush leaf
    rotX: rand() * Math.PI * 2,
    rotY: rand() * Math.PI * 2,
    rotZ: rand() * Math.PI * 2,
    fallSpeed: 0.12 + rand() * 0.14,
    swayAmplitude: 0.25 + rand() * 0.35,
    swayPeriod: 2.2 + rand() * 2.5,
    swayOffset: rand() * Math.PI * 2,
    tumbleSpeedX: (rand() - 0.5) * 0.9,
    tumbleSpeedY: (rand() - 0.5) * 1.2,
    tumbleSpeedZ: (rand() - 0.5) * 0.8,
    colorIndex: Math.floor(rand() * LEAF_COLORS.length),
  }
}

export function FallingLeaves() {
  const meshRef = useRef<THREE.InstancedMesh>(null!)
  const tempMatrix = useMemo(() => new THREE.Matrix4(), [])
  const tempQuat = useMemo(() => new THREE.Quaternion(), [])
  const tempEuler = useMemo(() => new THREE.Euler(), [])
  const tempScale = useMemo(() => new THREE.Vector3(), [])
  const tempPos = useMemo(() => new THREE.Vector3(), [])
  const timeRef = useRef(0)

  // Load the user's authentic 3D ZBrush leaf model
  const { scene } = useGLTF('/models/leaf.opt.glb')

  const leafGeometry = useMemo(() => {
    let geo: THREE.BufferGeometry | null = null
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && !geo) {
        geo = bakeGeometry(child as THREE.Mesh, scene)
        geo.center()
        geo.computeVertexNormals()
      }
    })
    return geo || new THREE.PlaneGeometry(0.2, 0.2)
  }, [scene])

  const rand = useMemo(() => seededRandom(888), [])

  const leaves = useRef<LeafPhysics[]>(
    Array.from({ length: LEAF_COUNT }, () => createLeafPhysics(rand))
  )

  // Initialize individual leaf colors
  useEffect(() => {
    if (!meshRef.current) return
    const tempColor = new THREE.Color()
    leaves.current.forEach((leaf, i) => {
      tempColor.set(LEAF_COLORS[leaf.colorIndex])
      meshRef.current.setColorAt(i, tempColor)
    })
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true
    }
  }, [])

  useFrame((_, rawDelta) => {
    if (!meshRef.current) return
    const delta = Math.min(rawDelta, 0.05)
    timeRef.current += delta
    const t = timeRef.current
    const motion = ambientMotion()
    const list = leaves.current

    for (let i = 0; i < LEAF_COUNT; i++) {
      const leaf = list[i]

      // 1. Natural downward flutter
      leaf.y -= leaf.fallSpeed * delta * motion

      // 2. Horizontal breeze sway
      const sway = Math.sin(t * (Math.PI * 2 / leaf.swayPeriod) + leaf.swayOffset) * leaf.swayAmplitude
      const currentX = leaf.x + sway
      const currentZ = leaf.z + Math.cos(t * 0.8 + leaf.swayOffset) * 0.15

      // 3. 3D Tumbling rotations
      leaf.rotX += leaf.tumbleSpeedX * delta
      leaf.rotY += leaf.tumbleSpeedY * delta
      leaf.rotZ += leaf.tumbleSpeedZ * delta

      // 4. Recycle leaf when it hits the water surface
      if (leaf.y < RESET_Y_MIN) {
        leaf.y = RESET_Y_MAX + Math.random() * 2
        leaf.x = (Math.random() - 0.5) * 13
        leaf.z = (Math.random() - 0.5) * 8 - 1
      }

      // 5. Update instanced matrix
      tempPos.set(currentX, leaf.y, currentZ)
      tempEuler.set(leaf.rotX, leaf.rotY, leaf.rotZ)
      tempQuat.setFromEuler(tempEuler)
      tempScale.set(leaf.scale, leaf.scale, leaf.scale)

      tempMatrix.compose(tempPos, tempQuat, tempScale)
      meshRef.current.setMatrixAt(i, tempMatrix)
    }

    meshRef.current.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={meshRef}
      args={[leafGeometry, undefined, LEAF_COUNT]}
      receiveShadow
    >
      <meshStandardMaterial
        roughness={0.6}
        metalness={0}
        emissive="#2a0404"
        emissiveIntensity={0.25}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  )
}

useGLTF.preload('/models/leaf.opt.glb')

export default FallingLeaves
