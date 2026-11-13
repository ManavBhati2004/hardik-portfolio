import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { WATER_Y } from '../scene/config'

/* ─────────────────────────────────────────────────────────────────────────────
   Procedural shoreline rocks built in Blender (scripts/blender/build_rocks.py):
   fractured, voronoi-cracked and strata-grooved sculpts baked down to light
   meshes with albedo, normal and ORM (AO + roughness) maps, plus a moss mask in
   the vertex colours (ORM blue = baked crevice mask). Each model key keeps the
   footprint of the scan it replaced; repeated placements of a key cycle through
   its variants. The material grades them toward dark graphite, adds a wet,
   glossier band at the waterline and grows moss on benches and in the cracks.
   ───────────────────────────────────────────────────────────────────────────── */

const ROCK_FILES = {
  coast01: ['/models/rocks/shoreline.opt.glb'],
  coast05: ['/models/rocks/headland_a.opt.glb', '/models/rocks/headland_b.opt.glb', '/models/rocks/headland_c.opt.glb'],
  cliff: ['/models/rocks/cliff.opt.glb'],
  boulder02: ['/models/rocks/boulder_a.opt.glb', '/models/rocks/boulder_b.opt.glb'],
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
  // physical material: clearcoat gives the wet band a real glossy film
  const mat = new THREE.MeshPhysicalMaterial({
    map: src.map,
    normalMap: src.normalMap,
    roughnessMap: src.roughnessMap,
    // baked ambient occlusion (R of the ORM map)
    aoMap: src.aoMap,
    aoMapIntensity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.16,
  })
  mat.color = new THREE.Color(tone, tone * 0.98, tone * 1.0)
  mat.metalness = 0
  mat.roughness = 1
  mat.envMapIntensity = 0.75
  // the scans' own normals are 1K: keep them at natural strength (over-driving them caused
  // the speckled look up close) and add procedural micro-detail in the shader instead
  mat.normalScale = new THREE.Vector2(1.0, 1.0)
  mat.side = THREE.FrontSide
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap]) if (t) t.anisotropy = maxAniso
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterY = { value: WATER_Y }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 mossMask;\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormalW;\nvarying float vMossMask;'
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRockWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRockNormalW = normalize(mat3(modelMatrix) * objectNormal);\nvMossMask = mossMask.r;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
         varying vec3 vRockWorld;
         varying vec3 vRockNormalW;
         varying float vMossMask;
         uniform float uWaterY;
         float rh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
         float rn(vec3 x) {
           vec3 i = floor(x), f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           return mix(mix(mix(rh(i), rh(i + vec3(1,0,0)), f.x), mix(rh(i + vec3(0,1,0)), rh(i + vec3(1,1,0)), f.x), f.y),
                      mix(mix(rh(i + vec3(0,0,1)), rh(i + vec3(1,0,1)), f.x), mix(rh(i + vec3(0,1,1)), rh(i + vec3(1,1,1)), f.x), f.y), f.z);
         }
         float rfbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * rn(p); p = p * 2.07 + 5.3; a *= 0.5; } return v; }`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // grade the scan toward cool graphite (keep a little of the original variation)
         float rl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         diffuseColor.rgb = mix(vec3(rl) * vec3(0.96, 0.97, 1.0), diffuseColor.rgb, 0.22);
         // baked crevice mask (blue channel of the ORM map; 0 on maps without one)
         float crev = 0.0;
         #ifdef USE_ROUGHNESSMAP
           crev = texture2D(roughnessMap, vRoughnessMapUv).b;
         #endif
         // wet band just above the waterline: darker albedo, with a ragged upper edge;
         // water wicks a little higher up the cracks
         float wetEdge = 0.34 + (rfbm(vRockWorld * 3.0) - 0.5) * 0.2 + crev * 0.22;
         float wet = 1.0 - smoothstep(uWaterY + 0.02, uWaterY + wetEdge, vRockWorld.y);
         diffuseColor.rgb *= mix(1.0, 0.38, wet);
         // thin dark algae film right at the waterline
         float algae = 1.0 - smoothstep(uWaterY - 0.04, uWaterY + 0.1 + (rn(vRockWorld * 7.0) - 0.5) * 0.08, vRockWorld.y);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.036, 0.026), algae * 0.6);
         // moss / lichen: on up-facing surfaces and in hollows, never in the wet band
         float up = smoothstep(0.35, 0.85, vRockNormalW.y);
         // patch noise: broad colonies with a finer ragged edge (not an even speckle)
         float mossN = rfbm(vRockWorld * 0.9 + 7.0) * 0.7 + rfbm(vRockWorld * 4.0 + 2.0) * 0.3;
         float moss = up * smoothstep(0.5, 0.72, mossN) * (1.0 - wet) * 0.7;
         // baked moss mask (sheltered hollows and benches), broken up by the same noise
         moss = max(moss, vMossMask * smoothstep(0.48, 0.7, mossN) * (1.0 - wet) * 0.45);
         // moss creeping along the cracks and joints (not on overhangs)
         moss = max(moss, crev * smoothstep(-0.2, 0.45, vRockNormalW.y) * smoothstep(0.38, 0.62, mossN) * (1.0 - wet) * 0.7);
         vec3 mossC = mix(vec3(0.13, 0.16, 0.09), vec3(0.24, 0.26, 0.16), rn(vRockWorld * 9.0));
         diffuseColor.rgb = mix(diffuseColor.rgb, mossC, moss);
         // pale lichen flecks on the exposed tops
         float lichen = up * smoothstep(0.64, 0.78, rfbm(vRockWorld * 2.0 + 3.0)) * (1.0 - wet) * 0.14;
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25 + vec3(0.04, 0.045, 0.035), lichen);`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = clamp(roughnessFactor * 1.05, 0.62, 1.0);
         roughnessFactor = mix(roughnessFactor, 0.36, wet);
         roughnessFactor = mix(roughnessFactor, 0.95, moss);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // light procedural micro-grain on top of the baked normal map (which now carries the
           // pits and hairline cracks itself)
           // fade the detail out when a pixel covers more than the detail scale (no sparkle/aliasing)
           float footprint = length(fwidth(vRockWorld));
           float detailK = 1.0 - smoothstep(0.012, 0.04, footprint);
           float hd = rfbm(vRockWorld * 12.0);
           vec2 dHdxy = vec2(dFdx(hd), dFdy(hd)) * 0.15 * detailK;
           vec3 sx = dFdx(-vViewPosition);
           vec3 sy = dFdy(-vViewPosition);
           vec3 r1 = cross(sy, normal);
           vec3 r2 = cross(normal, sx);
           float det = dot(sx, r1) * faceDirection;
           vec3 g = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
           normal = normalize(abs(det) * normal - g);
         }`
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
         // the glossy water film only exists in the wet band
         material.clearcoat *= wet;`
      )
  }
  return mat
}

function Rock({ placement, file, maxAniso }: { placement: RockPlacement; file: string; maxAniso: number }) {
  const { scene } = useGLTF(file)
  const object = useMemo(() => {
    const clone = scene.clone(true)
    if (placement.name) clone.name = placement.name
    clone.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      // the moss mask ships as COLOR_0: expose it under its own name so it never tints the albedo
      const g = m.geometry
      const maskAttr = g.getAttribute('color')
      if (maskAttr && !g.getAttribute('mossMask')) {
        g.setAttribute('mossMask', maskAttr)
        g.deleteAttribute('color')
      }
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
  // repeated uses of a model key cycle through its variants, in order of appearance
  const seen: Partial<Record<RockKey, number>> = {}
  const files = placements.map((p) => {
    const n = seen[p.model] ?? 0
    seen[p.model] = n + 1
    const variants = ROCK_FILES[p.model]
    return variants[n % variants.length]
  })
  return (
    <group>
      {placements.map((p, i) => (
        <Rock key={i} placement={p} file={files[i]} maxAniso={maxAniso} />
      ))}
    </group>
  )
}

Object.values(ROCK_FILES).forEach((variants) => variants.forEach((f) => useGLTF.preload(f)))

export default Rocks
