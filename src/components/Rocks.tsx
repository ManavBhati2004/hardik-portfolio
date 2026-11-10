import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { WATER_Y } from '../scene/config'

/* ─────────────────────────────────────────────────────────────────────────────
   Photoscanned coastal rocks (Poly Haven, CC0), decimated for the web in
   Blender (scripts/blender/process_rocks.py). Each keeps its own PBR maps
   (albedo, normal, roughness); the material grades the scan toward dark
   graphite and adds a wet, glossier band at the waterline.
   ───────────────────────────────────────────────────────────────────────────── */

const ROCK_FILES = {
  coast01: '/models/rocks/coast_rocks_01.opt.glb',
  coast05: '/models/rocks/coast_rocks_05.opt.glb',
  cliff: '/models/rocks/coastal_cliff_04.opt.glb',
  boulder02: '/models/rocks/namaqualand_boulder_02.opt.glb',
  boulder01: '/models/rocks/boulder_01.opt.glb',
} as const
type RockKey = keyof typeof ROCK_FILES

export interface RockPlacement {
  model: RockKey
  position: [number, number, number]
  rotation?: [number, number, number]
  scale: number | [number, number, number]
  /** brightness multiplier of the graphite grade */
  tone?: number
  /** object name (lets other props, e.g. the torii, find this rock) */
  name?: string
}

function gradeMaterial(src: THREE.MeshStandardMaterial, tone: number, maxAniso: number) {
  const mat = src.clone()
  mat.color = new THREE.Color(tone, tone * 0.98, tone * 1.0)
  mat.metalness = 0
  mat.roughness = 1
  mat.envMapIntensity = 0.75
  mat.normalScale = new THREE.Vector2(1.35, 1.35)
  mat.side = THREE.FrontSide
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) if (t) t.anisotropy = maxAniso
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterY = { value: WATER_Y }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWorld;\nuniform float uWaterY;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // grade the scan toward cool graphite (keep a little of the original variation)
         float rl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         diffuseColor.rgb = mix(vec3(rl) * vec3(0.96, 0.97, 1.0), diffuseColor.rgb, 0.22);
         // wet band just above the waterline: darker albedo
         float wet = 1.0 - smoothstep(uWaterY + 0.02, uWaterY + 0.32, vRockWorld.y);
         diffuseColor.rgb *= mix(1.0, 0.42, wet);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(roughnessFactor * 1.05, 0.62, 1.0);
         roughnessFactor = mix(roughnessFactor, 0.48, wet);`
      )
  }
  return mat
}

function Rock({ placement, maxAniso }: { placement: RockPlacement; maxAniso: number }) {
  const { scene } = useGLTF(ROCK_FILES[placement.model])
  const object = useMemo(() => {
    const clone = scene.clone(true)
    if (placement.name) clone.name = placement.name
    clone.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      m.material = gradeMaterial(m.material as THREE.MeshStandardMaterial, placement.tone ?? 0.55, maxAniso)
    })
    return clone
  }, [scene, placement.tone, placement.name, maxAniso])

  const scale: [number, number, number] =
    typeof placement.scale === 'number' ? [placement.scale, placement.scale, placement.scale] : placement.scale

  return (
    <primitive object={object} position={placement.position} rotation={placement.rotation ?? [0, 0, 0]} scale={scale} />
  )
}

export function Rocks({ placements }: { placements: RockPlacement[] }) {
  const gl = useThree((s) => s.gl)
  const maxAniso = gl.capabilities.getMaxAnisotropy()
  return (
    <group>
      {placements.map((p, i) => (
        <Rock key={i} placement={p} maxAniso={maxAniso} />
      ))}
    </group>
  )
}

Object.values(ROCK_FILES).forEach((f) => useGLTF.preload(f))

export default Rocks
