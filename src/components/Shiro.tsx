import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { CRIMSON, MOON_POSITION, SHIRO_POSITION, SHIRO_SCALE, SHIRO_YAW } from '../scene/config'
import { sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Distant Himeji-style castle on its wooded hill, across the water behind the torii.
   Built in Blender (scripts/blender/build_shiro.py). COLOR_0: R = baked AO,
   G = night window mask, B = per-part tone variation. Surface detail (tile rows,
   dressed stone, stained plaster, leafy canopy) is procedural in the shader, from
   the model-space position and normal.

   The castle adapts to the scene: its own light and haze follow sceneStore.day and
   the live scene fog colour, so it always reads as a far, fogged silhouette.
   ───────────────────────────────────────────────────────────────────────────── */

type Kind = 'plaster' | 'roof' | 'stone' | 'window' | 'wood' | 'foliage' | 'ground'

/** Albedo per material: [night, day]. Night is dark and moonlit; day is pale and hazy. */
const PALETTE: Record<Kind, [string, string]> = {
  plaster: ['#a9a6b0', '#efebe3'],
  roof: ['#2a282e', '#454a52'],
  stone: ['#4a4441', '#8f897f'],
  window: ['#0c0908', '#2c2927'],
  wood: ['#151213', '#3d3733'],
  foliage: ['#111411', '#5f7258'],
  ground: ['#131211', '#867f6c'],
}
/** Procedural detail pattern per surface (see the fragment shader). */
const KIND_INDEX: Record<Kind, number> = { plaster: 0, roof: 1, stone: 2, window: 3, wood: 4, foliage: 5, ground: 6 }
/** How strongly each surface catches the crimson rim at night. */
const RIM: Record<Kind, number> = { plaster: 0.3, roof: 1.1, stone: 0.18, window: 0, wood: 0.12, foliage: 0.05, ground: 0.03 }

const NIGHT_LIGHT = new THREE.Color(CRIMSON).multiplyScalar(0.8)
const DAY_LIGHT = new THREE.Color('#ffe8cc').multiplyScalar(1.05)
const NIGHT_AMBIENT = new THREE.Color('#9aa0b8').multiplyScalar(1.15)
const DAY_AMBIENT = new THREE.Color('#d6e2f0').multiplyScalar(0.62)
const RIM_COLOR = new THREE.Color('#9c1a15')
const WARM = new THREE.Color('#ff9a4a').multiplyScalar(1.8)
/** Daylight comes from the scene's warm key (Scene3D DAY rig). */
const DAY_DIR = new THREE.Vector3(5, 7, 6).normalize()

const vertexShader = /* glsl */ `
  attribute vec4 color;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec4 vCol;
  varying vec3 vObj;
  varying vec3 vNObj;
  varying vec3 vTgW;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vCol = color;
    vObj = position;
    vNObj = normal;
    // horizontal tangent across the slope / along the wall (tile rows, stone courses)
    vTgW = normalize(mat3(modelMatrix) * vec3(-normal.z, 0.0, normal.x) + vec3(1e-5));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragmentShader = /* glsl */ `
  uniform vec3 uNightBase;
  uniform vec3 uDayBase;
  uniform float uRim;
  uniform float uWindow;
  uniform float uDay;
  uniform vec3 uLightDir;
  uniform vec3 uLightCol;
  uniform vec3 uAmbient;
  uniform vec3 uRimCol;
  uniform vec3 uWarm;
  uniform vec3 uFogCol;
  uniform float uHaze;
  uniform float uFogDensity;
  uniform float uWaterY;
  uniform float uTime;
  uniform float uKind;
  varying vec3 vN;
  varying vec3 vWorld;
  varying vec4 vCol;
  varying vec3 vObj;
  varying vec3 vNObj;
  varying vec3 vTgW;

  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 V = normalize(cameraPosition - vWorld);
    float ao = mix(0.3, 1.0, vCol.r);
    vec3 alb = mix(uNightBase, uDayBase, uDay) * (0.88 + 0.24 * vCol.b);

    // surface detail (model units; faded out once a feature spans only a few pixels, so the
    // far castle never shimmers): tiled roofs, dressed ishigaki stone, stained plaster, canopy
    vec3 no = normalize(vNObj);
    float fw = length(fwidth(vObj));
    vec2 hz = no.xz;
    float hl = length(hz);
    vec2 tg = hl > 1e-3 ? vec2(-hz.y, hz.x) / hl : vec2(1.0, 0.0);
    float along = dot(vObj.xz, tg);
    float detail = 1.0;
    if (uKind > 0.5 && uKind < 1.5) {
      // hongawara rows running down the slope, cap tiles catching the light, course lines
      float k = (1.0 - smoothstep(0.06, 0.16, fw / 0.3)) * smoothstep(0.08, 0.3, hl) * step(0.05, no.y);
      float u = along / 0.3;
      float s = sin(u * 6.2831853);
      float course = smoothstep(0.82, 1.0, fract(vObj.y / 0.24 + 0.15 * h21(vec2(floor(u), 3.0))));
      detail = mix(1.0, (0.86 + 0.26 * smoothstep(0.1, 0.9, s) - 0.2 * smoothstep(-0.2, -0.9, s)) * (1.0 - 0.22 * course)
                        * (0.9 + 0.2 * vn(vec2(floor(u), vObj.y * 0.7))), k);
      n = normalize(n + vTgW * cos(u * 6.2831853) * 0.5 * k);
    } else if (uKind > 1.5 && uKind < 2.5) {
      // coursed rough-dressed blocks with dark joints and per-stone tone
      float k = 1.0 - smoothstep(0.08, 0.2, fw / 0.45);
      float row = floor(vObj.y / 0.42);
      float bx = (along + h21(vec2(row, 1.0)) * 0.9) / (0.55 + 0.35 * h21(vec2(row, 7.0)));
      vec2 cell = vec2(floor(bx), row);
      vec2 f = vec2(fract(bx), fract(vObj.y / 0.42));
      float joint = 1.0 - smoothstep(0.0, 0.07, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y) * 1.3));
      detail = mix(1.0, (0.78 + 0.4 * h21(cell)) * (1.0 - 0.55 * joint) * (0.9 + 0.2 * vn(vObj.xy * 6.0 + vObj.z * 3.0)), k);
    } else if (uKind < 0.5) {
      // plaster: soft mottling and rain stains running down from the eaves
      float k = 1.0 - smoothstep(0.1, 0.4, fw);
      float streak = vn(vec2(along * 5.0, vObj.y * 0.35));
      detail = mix(1.0, (0.94 + 0.08 * vn(vObj.xz * 1.7 + vObj.y)) * (1.0 - 0.14 * smoothstep(0.55, 0.85, streak)), k);
    } else if (uKind > 4.5 && uKind < 5.5) {
      // foliage: leafy clumps instead of flat blobs
      float k = 1.0 - smoothstep(0.15, 0.6, fw);
      float leaf = vn(vObj.xz * 2.6 + vObj.y * 1.9) * 0.6 + vn(vObj.xy * 6.5 + vObj.z * 4.1) * 0.4;
      detail = mix(1.0, 0.7 + 0.6 * leaf, k);
    }
    alb *= detail;

    float diff = max(dot(n, uLightDir), 0.0);
    float sky = 0.55 + 0.45 * n.y;
    vec3 col = alb * (uAmbient * sky + uLightCol * diff) * ao;

    // night: crimson moon rim on grazing edges (eaves, ridges, gables)
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    float facing = 0.35 + 0.65 * max(dot(n, uLightDir), 0.0);
    col += uRimCol * fres * facing * uRim * (1.0 - uDay) * ao;

    // night: a few dim warm windows, breathing slowly
    float lit = vCol.g * uWindow * (1.0 - uDay);
    col += uWarm * lit * 2.2 * (0.75 + 0.25 * sin(uTime * 0.7 + vCol.b * 40.0));

    // distance haze toward the live scene fog colour, thicker near the water
    float d = length(cameraPosition - vWorld);
    float f = 1.0 - exp(-pow(uFogDensity * d, 2.0));
    float low = smoothstep(uWaterY + 2.2, uWaterY, vWorld.y) * 0.3;
    float haze = clamp(uHaze + f + low - lit * 0.5, 0.0, 0.96);
    gl_FragColor = vec4(mix(col, uFogCol, haze), 1.0);
    #include <colorspace_fragment>
  }
`

/** Shared uniforms (one castle in the scene): written once per frame, referenced by every
 *  castle material, so the per-frame writes reach the GPU without per-material copies. */
const shared = {
  uDay: { value: 0 },
  uLightDir: { value: new THREE.Vector3() },
  uLightCol: { value: new THREE.Color() },
  uAmbient: { value: new THREE.Color() },
  uRimCol: { value: RIM_COLOR.clone() },
  uWarm: { value: WARM.clone() },
  uFogCol: { value: new THREE.Color('#0d0b0d') },
  uHaze: { value: 0.4 },
  uFogDensity: { value: 0.022 },
  uWaterY: { value: SHIRO_POSITION.y },
  uTime: { value: 0 },
}
const MOON_DIR = MOON_POSITION.clone().sub(SHIRO_POSITION).normalize()

export function Shiro() {
  const { scene } = useGLTF('/models/shiro.glb')
  const sceneFog = useThree((s) => s.scene.fog)

  const model = useMemo(() => {
    const clone = scene.clone(true)
    const made: THREE.ShaderMaterial[] = []
    clone.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = false
      mesh.receiveShadow = false
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      const next = mats.map((m) => {
        const kind = ((m.name || 'plaster').toLowerCase() as Kind) in PALETTE ? ((m.name || 'plaster').toLowerCase() as Kind) : 'plaster'
        const [night, day] = PALETTE[kind]
        // built imperatively: the uniform objects are shared, so per-frame writes reach the GPU
        const mat = new THREE.ShaderMaterial({
          name: `shiro-${kind}`,
          vertexShader,
          fragmentShader,
          side: THREE.DoubleSide,
          uniforms: {
            ...shared,
            uNightBase: { value: new THREE.Color(night) },
            uDayBase: { value: new THREE.Color(day) },
            uRim: { value: RIM[kind] },
            uWindow: { value: kind === 'window' ? 1 : 0 },
            uKind: { value: KIND_INDEX[kind] },
          },
        })
        made.push(mat)
        return mat
      })
      mesh.material = Array.isArray(mesh.material) ? next : next[0]
    })
    return { clone, made }
  }, [scene])

  useEffect(() => () => model.made.forEach((m) => m.dispose()), [model])

  useFrame((state) => {
    const day = sceneStore.day > 0.5 ? 1 : 0
    shared.uDay.value = day
    shared.uTime.value = state.clock.elapsedTime
    shared.uLightDir.value.copy(day ? DAY_DIR : MOON_DIR)
    shared.uLightCol.value.copy(day ? DAY_LIGHT : NIGHT_LIGHT)
    shared.uAmbient.value.copy(day ? DAY_AMBIENT : NIGHT_AMBIENT)
    shared.uHaze.value = day ? 0.04 : 0.02
    // near the shrine it is clear; from the hero (twice as far) it is only a faint silhouette
    shared.uFogDensity.value = day ? 0.034 : 0.03
    if (sceneFog && 'color' in sceneFog) shared.uFogCol.value.copy(sceneFog.color)
  })

  return (
    <group position={SHIRO_POSITION} rotation={[0, SHIRO_YAW, 0]} scale={SHIRO_SCALE}>
      <primitive object={model.clone} />
    </group>
  )
}

useGLTF.preload('/models/shiro.glb')

export default Shiro
