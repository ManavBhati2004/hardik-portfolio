import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGLTF } from '@react-three/drei'
import { MOON_POSITION } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { bakeGeometry } from '../scene/bakeGeometry'
import { flowerGeometry } from './blossomGeometry'
import { FallingPetals } from './FallingPetals'
import { pointAtNdc, isMobileViewport, heroCamera } from '../scene/placement'

/* ─────────────────────────────────────────────────────────────────────────────
   Cherry tree on the left shore (model built in Blender: scripts/blender/build_sakura.py —
   recursive curve trunk/branches converted to mesh, baked procedural cherry bark).
   Its trunk and crown stay outside the hero frame; one long limb (the model origin is
   where it leaves the trunk) enters from the upper-left and frames the hero. Blossoms and
   buds are instanced on the twig tips (`_twig_tip` vertex weight).

   Wind is applied per-vertex, not to the whole object:
   - sway weight = (distance past the trunk fork)² → trunk and limbs barely move,
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

/* Extra blossoms: instanced flowers placed on outer twigs. Wind is computed from the
   instance's position (so each flower sways with the twig it sits on) and converted
   back into the flower's local space. */
function injectInstancedWind(
  mat: THREE.MeshPhysicalMaterial,
  uniforms: { uTime: { value: number }; uWind: { value: number }; uDay: { value: number } }
) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime
    shader.uniforms.uWind = uniforms.uWind
    shader.uniforms.uDay = uniforms.uDay
    shader.uniforms.uMoonPos = { value: MOON_POSITION.clone() }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec4 windData;
         uniform float uTime;
         uniform float uWind;
         varying vec3 vPetalWorld;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           mat3 im = mat3(instanceMatrix);
           float s2 = max(dot(im[0], im[0]), 1e-6);
           vec3 ip = instanceMatrix[3].xyz;
           float w = windData.r;
           float sway = w * w;
           float ph = dot(ip, vec3(0.55, 0.35, 0.25));
           vec3 windOff = vec3(
             sin(uTime * 0.47 + ph * 0.9) * 0.055 + sin(uTime * 1.13 + ph * 2.1) * 0.016,
             sin(uTime * 0.61 + ph * 1.1 + 1.7) * 0.034 + cos(uTime * 1.37 + ph * 1.7) * 0.01,
             cos(uTime * 0.53 + ph * 0.8 + 0.6) * 0.042
           ) * sway;
           windOff *= 0.75 + 0.35 * sin(uTime * 0.13 + 1.2) * sin(uTime * 0.071);
           // petal flutter (strongest at the petal tips)
           windOff += vec3(sin(uTime * 2.6 + windData.b * 41.0), cos(uTime * 2.2 + windData.b * 29.0), 0.0)
                      * 0.004 * (0.4 + w) * length(position.xy);
           transformed += transpose(im) * (windOff * uWind) / s2;
         }`
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vPetalWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;'
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec3 vPetalWorld;\n uniform vec3 uMoonPos;\n uniform float uDay;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // thin petals glow when the moon / sun is behind them
         vec3 toL = normalize(uMoonPos - vPetalWorld);
         vec3 toC = normalize(cameraPosition - vPetalWorld);
         float back = pow(clamp(dot(-toC, toL), 0.0, 1.0), 2.5);
         vec3 lightC = mix(vec3(0.62, 0.2, 0.24), vec3(1.0, 0.86, 0.8), uDay);
         totalEmissiveRadiance += diffuseColor.rgb * lightC * (mix(0.06, 0.16, uDay) + back * 0.35);`
      )
  }
  mat.customProgramCacheKey = () => 'blossom-instanced-wind'
}

/** Sample the twig tips (the model's `_twig_tip` weight) and build flower / bud instances there. */
function buildBlossomInstances(bark: THREE.BufferGeometry, count: number, seed: number) {
  const pos = bark.getAttribute('position') as THREE.BufferAttribute
  const nor = bark.getAttribute('normal') as THREE.BufferAttribute | undefined
  const wind = bark.getAttribute('windData') as THREE.BufferAttribute
  const tip = bark.getAttribute('_twig_tip') as THREE.BufferAttribute | undefined
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  // candidate vertices on the flowering twigs, weighted by how far out on the twig they are;
  // the hero limb (right of the trunk fork, +x) is weighted up so the bough framing the hero
  // keeps its dense clusters
  const cand: number[] = []
  const cum: number[] = []
  let total = 0
  for (let i = 0; i < pos.count; i++) {
    const t = tip ? tip.getX(i) : wind.getX(i) > 0.42 ? 1 : 0
    if (t < 0.3) continue
    total += t * (pos.getX(i) > 0.25 ? 5 : 1)
    cand.push(i)
    cum.push(total)
  }
  const pick = () => {
    const r = rnd() * total
    let lo = 0
    let hi = cum.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < r) lo = mid + 1
      else hi = mid
    }
    return cand[lo]
  }

  const matrices: THREE.Matrix4[] = []
  const colors: THREE.Color[] = []
  const windData = new Float32Array(count * 4)
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const Z = new THREE.Vector3(0, 0, 1)
  const out = new THREE.Vector3()
  const blush = new THREE.Color(1.0, 0.8, 0.85)
  const white = new THREE.Color(1.0, 0.96, 0.97)
  const deep = new THREE.Color(0.92, 0.52, 0.62)
  for (let k = 0; k < count; k++) {
    const i = pick()
    p.fromBufferAttribute(pos, i)
    if (nor) n.fromBufferAttribute(nor, i).normalize()
    else n.set(rnd() - 0.5, rnd() - 0.5, 1).normalize()
    // face outward from the twig, biased toward the viewer (+z) with some randomness
    out.copy(n).multiplyScalar(0.7).add(new THREE.Vector3(rnd() - 0.5, rnd() - 0.3, 0.9)).normalize()
    q.setFromUnitVectors(Z, out)
    q.multiply(new THREE.Quaternion().setFromAxisAngle(Z, rnd() * Math.PI * 2))
    const bud = rnd() < 0.22
    const size = bud ? 0.035 + rnd() * 0.02 : 0.07 + rnd() * 0.06
    p.addScaledVector(n, size * 0.25)
    const m = new THREE.Matrix4().compose(p.clone(), q.clone(), new THREE.Vector3(size, size, bud ? size * 1.6 : size))
    matrices.push(m)
    const r = rnd()
    colors.push(bud ? deep.clone() : r < 0.18 ? deep.clone().lerp(blush, 0.4) : r < 0.6 ? blush.clone() : white.clone())
    windData[k * 4] = wind.getX(i)
    windData[k * 4 + 1] = wind.getY(i)
    windData[k * 4 + 2] = rnd()
    windData[k * 4 + 3] = 1
  }
  return { matrices, colors, windData }
}

const BLOSSOMS = 3200
const BLOSSOMS_MOBILE = 1600

export function BlossomBranch() {
  const { scene } = useGLTF('/models/sakura.glb')
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const groupRef = useRef<THREE.Group>(null!)
  const offsetRef = useRef<THREE.Group>(null!)

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uWind: { value: 1 }, uDay: { value: 0 } }), [])

  const bark = useMemo(() => {
    const maxAniso = gl.capabilities.getMaxAnisotropy()
    let mesh: THREE.Mesh | null = null
    scene.traverse((o) => {
      if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh
    })
    if (!mesh) return null
    const m = mesh as THREE.Mesh
    const src = m.material as THREE.MeshStandardMaterial
    const geometry = takeWindData(bakeGeometry(m, scene))
    const material = new THREE.MeshStandardMaterial({
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
    for (const t of [material.map, material.normalMap, material.roughnessMap]) if (t) t.anisotropy = maxAniso
    return { geometry, material }
  }, [scene, uniforms, gl])

  // blossoms and buds instanced on the twig tips of the whole tree
  const blossoms = useMemo(() => {
    if (!bark) return null
    const geo = flowerGeometry()
    const count = isMobileViewport() ? BLOSSOMS_MOBILE : BLOSSOMS
    const { matrices, colors, windData } = buildBlossomInstances(bark.geometry, count, 9173)
    geo.setAttribute('windData', new THREE.InstancedBufferAttribute(windData, 4))
    const mat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.58,
      metalness: 0,
      sheen: 0.7,
      sheenColor: new THREE.Color('#f6c6cf'),
      sheenRoughness: 0.45,
      side: THREE.DoubleSide,
      envMapIntensity: 0.55,
    })
    injectInstancedWind(mat, uniforms)
    const mesh = new THREE.InstancedMesh(geo, mat, matrices.length)
    matrices.forEach((m, i) => {
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, colors[i])
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    return mesh
  }, [bark, uniforms])

  // Composition: the hero limb's root (the model origin, where it leaves the trunk) sits just
  // outside the upper-left corner with the bough reaching right and down; the trunk drops
  // off-screen to the left shore and the crown spreads up and left, out of the hero frame
  // (against the fixed hero camera so the live camera journey never re-places it)
  useLayoutEffect(() => {
    const mobile = isMobileViewport()
    const cam = heroCamera(size.width / Math.max(1, size.height))
    const p = pointAtNdc(cam, mobile ? -1.15 : -1.1, mobile ? 1.02 : 1.04, mobile ? 5.6 : 5.2)
    groupRef.current.position.copy(p)
  }, [size])

  // intro offset layer: the bough eases in from beyond the corner. The tree is planted, so it
  // stays put during the camera journey (the camera passes under the crown).
  const drift = useRef(1)
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    uniforms.uTime.value += delta * ambientMotion()
    uniforms.uDay.value = sceneStore.day
    const target = 1 - sceneStore.branchIn
    // the intro owns branchIn with its own easing; afterwards changes are damped here
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
          {bark && (
            <mesh geometry={bark.geometry} material={bark.material} receiveShadow castShadow={false} frustumCulled={false} />
          )}
          {blossoms && <primitive object={blossoms} />}
        </group>
        <FallingPetals />
      </group>
    </group>
  )
}

useGLTF.preload('/models/sakura.glb')

export default BlossomBranch
