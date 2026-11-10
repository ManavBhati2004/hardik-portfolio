import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { MOON_POSITION } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { bakeGeometry } from '../scene/bakeGeometry'
import { pointAtNdc, isMobileViewport, heroCamera } from '../scene/placement'

/* ─────────────────────────────────────────────────────────────────────────────
   Flowering branch entering from the upper-left (model built in Blender:
   scripts/blender/build_blossom_branch.py — swept bark with Poly Haven bark
   PBR maps, modelled five-petal blossoms, buds and stamens).

   Wind is applied per-vertex, not to the whole object:
   - sway weight = (distance from the root)² → the main limb barely moves,
     outer twigs and blossom clusters move more
   - phase comes from the vertex's own position, so the motion is continuous
     across joints (twigs never detach) and travels along the branch like a gust
   - layered low-frequency sines (no synchronised oscillation) + a small
     per-blossom flutter
   Time-driven only — keeps moving when the mouse is idle.
   ───────────────────────────────────────────────────────────────────────────── */

const windChunk = /* glsl */ `
  float w = windData.r;
  float sway = w * w;
  vec3 wp0 = position;
  float ph = dot(wp0, vec3(0.55, 0.35, 0.25));
  vec3 windOff = vec3(
    sin(uTime * 0.47 + ph * 0.9) * 0.055 + sin(uTime * 1.13 + ph * 2.1) * 0.016,
    sin(uTime * 0.61 + ph * 1.1 + 1.7) * 0.034 + cos(uTime * 1.37 + ph * 1.7) * 0.01,
    cos(uTime * 0.53 + ph * 0.8 + 0.6) * 0.042
  ) * sway;
  // gusts: slow envelope so the breeze breathes rather than ticking
  windOff *= 0.75 + 0.35 * sin(uTime * 0.13 + 1.2) * sin(uTime * 0.071);
  // blossom flutter (petal tips only; a = distance from flower centre)
  windOff += vec3(
    sin(uTime * 2.6 + windData.b * 41.0),
    cos(uTime * 2.2 + windData.b * 29.0),
    sin(uTime * 1.9 + windData.b * 17.0)
  ) * 0.0055 * windData.a * (0.4 + w);
  transformed += windOff * uWind;
`

function takeWindData(geo: THREE.BufferGeometry) {
  const g = geo.clone()
  const c = g.getAttribute('color')
  if (c) {
    g.setAttribute('windData', c)
    g.deleteAttribute('color')
  } else {
    g.setAttribute('windData', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 4), 4))
  }
  return g
}

function injectWind(
  mat: THREE.MeshStandardMaterial,
  uniforms: { uTime: { value: number }; uWind: { value: number } },
  extraFrag?: (shader: { fragmentShader: string; vertexShader: string; uniforms: Record<string, THREE.IUniform> }) => void
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uWind = uniforms.uWind
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec4 windData;
         uniform float uTime;
         uniform float uWind;
         varying vec4 vWindData;`
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n vWindData = windData;\n${windChunk}`)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n varying vec4 vWindData;`
    )
    extraFrag?.(shader)
  }
}

export function BlossomBranch() {
  const { scene } = useGLTF('/models/blossom_branch.opt.glb')
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const groupRef = useRef<THREE.Group>(null!)
  const offsetRef = useRef<THREE.Group>(null!)

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uWind: { value: 1 } }), [])

  const parts = useMemo(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    const out: { geometry: THREE.BufferGeometry; material: THREE.Material; name: string }[] = []
    scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const src = m.material as THREE.MeshStandardMaterial
      const geometry = takeWindData(bakeGeometry(m, scene))
      const name = (m.name || src.name || '').toLowerCase()
      let material: THREE.MeshStandardMaterial

      if (name.includes('bark')) {
        material = new THREE.MeshStandardMaterial({
          map: src.map,
          normalMap: src.normalMap,
          roughnessMap: src.roughnessMap,
          color: new THREE.Color(0.2, 0.15, 0.13),
          roughness: 1,
          metalness: 0,
          normalScale: new THREE.Vector2(1.4, 1.4),
          envMapIntensity: 0.6,
        })
        injectWind(material, uniforms)
      } else if (name.includes('stamen')) {
        material = new THREE.MeshStandardMaterial({
          map: src.map,
          color: new THREE.Color(0.9, 0.8, 0.8),
          roughness: 0.6,
          metalness: 0,
          side: THREE.DoubleSide,
          envMapIntensity: 0.5,
        })
        injectWind(material, uniforms)
      } else {
        // petals: textured, per-blossom tint (pale rose → deep crimson), soft sheen and
        // back-lit translucency from the moon behind
        const petal = new THREE.MeshPhysicalMaterial({
          map: src.map,
          color: new THREE.Color(1, 1, 1),
          roughness: 0.62,
          metalness: 0,
          sheen: 0.6,
          sheenColor: new THREE.Color('#f3b8c0'),
          sheenRoughness: 0.5,
          side: THREE.DoubleSide,
          envMapIntensity: 0.55,
        })
        material = petal
        injectWind(material, uniforms, (shader) => {
          shader.uniforms.uMoonPos = { value: MOON_POSITION.clone() }
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n varying vec3 vPetalWorld;')
            .replace(
              '#include <worldpos_vertex>',
              '#include <worldpos_vertex>\n vPetalWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
            )
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n varying vec3 vPetalWorld;\n uniform vec3 uMoonPos;')
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
               // per-blossom tint: mostly crimson-rose, some pale, a few deep red
               float r = vWindData.b;
               vec3 tintA = vec3(1.0, 0.55, 0.6);
               vec3 tintB = vec3(0.85, 0.16, 0.2);
               vec3 tintC = vec3(1.0, 0.86, 0.88);
               vec3 tint = r < 0.62 ? mix(tintB, tintA, r / 0.62) : mix(tintA, tintC, (r - 0.62) / 0.38);
               diffuseColor.rgb *= tint;`
            )
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               // thin-petal translucency: moonlight seen through the petals
               vec3 toMoon = normalize(uMoonPos - vPetalWorld);
               vec3 toCamW = normalize(cameraPosition - vPetalWorld);
               float back = pow(clamp(dot(-toCamW, toMoon), 0.0, 1.0), 3.0);
               totalEmissiveRadiance += diffuseColor.rgb * vec3(0.55, 0.12, 0.12) * (0.05 + back * 0.22);`
            )
        })
      }
      for (const t of [material.map, material.normalMap, material.roughnessMap]) if (t) t.anisotropy = maxAniso
      out.push({ geometry, material, name })
    })
    return out
  }, [scene, uniforms, gl])

  // Composition: root just outside the upper-left corner, bough reaching right and down
  // (against the fixed hero camera so the live camera journey never re-places it)
  useLayoutEffect(() => {
    const mobile = isMobileViewport()
    const cam = heroCamera(size.width / Math.max(1, size.height))
    const p = pointAtNdc(cam, mobile ? -1.15 : -1.1, mobile ? 1.02 : 1.04, mobile ? 5.6 : 5.2)
    groupRef.current.position.copy(p)
  }, [size])

  // intro / journey offset layer: eases in from beyond the corner, drifts out while the
  // camera travels, and drifts back for the finale
  const drift = useRef(1)
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    uniforms.uTime.value += delta * ambientMotion()
    const t = sceneStore.cameraT
    const journeyAway = THREE.MathUtils.smoothstep(t, 0.05, 0.9) * (1 - THREE.MathUtils.smoothstep(t, 3.25, 3.95))
    const target = Math.max(1 - sceneStore.branchIn, journeyAway)
    // the intro owns branchIn with its own easing; the journey part is damped here
    drift.current = sceneStore.introDone ? THREE.MathUtils.damp(drift.current, target, 2.2, delta) : target
    const a = drift.current
    offsetRef.current.position.set(-1.6 * a, 1.1 * a, 0)
    offsetRef.current.rotation.set(0, 0, 0.22 * a)
  })

  const mobile = isMobileViewport()
  return (
    <group ref={groupRef}>
      <group ref={offsetRef}>
        <group rotation={[0.12, 0.35, 0.16]} scale={mobile ? 0.4 : 0.6}>
          {parts.map((p, i) => (
            <mesh key={i} geometry={p.geometry} material={p.material} receiveShadow castShadow={false} frustumCulled={false} />
          ))}
        </group>
      </group>
    </group>
  )
}

useGLTF.preload('/models/blossom_branch.opt.glb')

export default BlossomBranch
