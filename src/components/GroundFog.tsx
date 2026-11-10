import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { LAYER_NO_REFLECT, MOON_POSITION, WATER_Y } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Low-lying mist that FLOWS continuously through the landscape.
   - No pointer input of any kind (the old cursor-repel behaviour is removed).
   - Each layer advects an unbounded, domain-warped fbm noise field with time
     (p − wind·t), so wisps travel across the frame, thin out and new ones form —
     there is no loop, reset or visible tile.
   - Horizontal sheets hug the water at different heights; upright haze banks sit
     in depth behind the rocks. Every layer fades to zero before its edges.
   - Lit by the same moon/ambient colours as the rest of the scene.
   ───────────────────────────────────────────────────────────────────────────── */

const fogVert = /* glsl */ `
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vViewZ;
  varying float vNdcX;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vViewZ = -mv.z;
    gl_Position = projectionMatrix * mv;
    vNdcX = gl_Position.x / gl_Position.w;
  }
`

const fogFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec2 uWind;          // flow direction * speed (world units / s)
  uniform float uScale;        // noise frequency
  uniform float uDensity;
  uniform float uSeed;
  uniform float uVertical;     // 0 = horizontal sheet (xz), 1 = upright bank (xy)
  uniform float uBaseY;
  uniform vec3 uColor;
  uniform vec3 uMoonColor;
  uniform vec3 uMoonPos;
  uniform float uThicken;
  uniform float uCenterThin;
  varying vec3 vWorld;
  varying vec2 vUv;
  varying float vViewZ;
  varying float vNdcX;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = mix(vWorld.xz, vec2(vWorld.x, vWorld.y * 2.2), uVertical) * uScale + uSeed;
    float t = uTime;
    // advect the whole field with the wind; slow curl-like warp makes the wisps evolve
    vec2 q = p - uWind * uScale * t;
    vec2 warp = vec2(fbm(q * 0.55 + vec2(0.0, t * 0.035)), fbm(q * 0.55 + vec2(5.2, -t * 0.03)));
    float n = fbm(q + (warp - 0.5) * 2.2);
    // slow density breathing
    n += 0.06 * sin(t * 0.11 + uSeed);
    float d = smoothstep(0.42, 0.86, n);

    // soft layer bounds (no visible plane edges)
    float e = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x)
            * smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
    // upright banks thin out with height above the water
    float hFade = mix(1.0, smoothstep(2.3, 0.0, vWorld.y - uBaseY), uVertical);
    // never fog the lens: fade close to the camera
    float near = smoothstep(1.5, 5.0, vViewZ);

    float a = d * e * hFade * near * uDensity * (1.0 + 0.7 * uThicken);
    // thinner in the screen centre so the blade tip and its reflection stay readable
    a *= mix(1.0, smoothstep(0.0, 0.42, abs(vNdcX)) * 0.55 + 0.45, uCenterThin);

    // lighting: neutral grey mist, warmed by the moon toward its direction
    vec3 toMoon = normalize(uMoonPos - vWorld);
    vec3 toCam = normalize(cameraPosition - vWorld);
    float forward = pow(clamp(dot(-toCam, toMoon), 0.0, 1.0), 6.0);
    float lateral = exp(-pow((vWorld.x - uMoonPos.x) / 5.0, 2.0));
    vec3 col = uColor * (0.75 + 0.35 * n) + uMoonColor * (forward * 0.9 + lateral * 0.25);

    // dither (prevents banding in thin mist)
    a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface Layer {
  position: [number, number, number]
  size: [number, number]
  vertical: boolean
  wind: [number, number]
  scale: number
  density: number
  seed: number
}

/* Layers ordered back → front. Winds differ in speed/direction so layers slide past each other. */
const LAYERS: Layer[] = [
  // far upright banks along the horizon (hide the waterline softly)
  { position: [0, WATER_Y + 1.3, -26], size: [90, 3.4], vertical: true, wind: [0.22, 0], scale: 0.09, density: 0.62, seed: 3.1 },
  { position: [6, WATER_Y + 1.1, -16], size: [60, 2.8], vertical: true, wind: [0.3, 0], scale: 0.13, density: 0.5, seed: 7.4 },
  // mid banks drifting behind the rocks
  { position: [-4, WATER_Y + 0.9, -9], size: [40, 2.3], vertical: true, wind: [0.36, 0], scale: 0.18, density: 0.51, seed: 12.8 },
  { position: [7, WATER_Y + 0.85, -5], size: [24, 2.4], vertical: true, wind: [0.4, 0], scale: 0.22, density: 0.6, seed: 19.2 },
  // horizontal sheets hugging the water
  { position: [0, WATER_Y + 0.05, -15], size: [70, 26], vertical: false, wind: [0.34, 0.05], scale: 0.16, density: 0.42, seed: 23.7 },
  { position: [0, WATER_Y + 0.28, -8], size: [50, 16], vertical: false, wind: [0.42, -0.04], scale: 0.24, density: 0.26, seed: 31.5 },
  { position: [0, WATER_Y + 0.55, -4], size: [36, 10], vertical: false, wind: [0.5, 0.06], scale: 0.3, density: 0.16, seed: 42.9 },
  // wisps curling up the right cliff around the torii
  { position: [6.6, WATER_Y + 1.7, -7.2], size: [10, 3.8], vertical: true, wind: [0.22, 0], scale: 0.34, density: 0.4, seed: 64.1 },
  // thin foreground wisps around the base of the rocks and the blade tip
  { position: [0, WATER_Y + 0.14, 0.5], size: [26, 6], vertical: false, wind: [0.55, 0.02], scale: 0.38, density: 0.14, seed: 57.3 },
]

function FogLayer({ layer }: { layer: Layer }) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: layer.seed * 13.0 },
      uWind: { value: new THREE.Vector2(...layer.wind) },
      uScale: { value: layer.scale },
      uDensity: { value: layer.density },
      uSeed: { value: layer.seed },
      uVertical: { value: layer.vertical ? 1 : 0 },
      uBaseY: { value: WATER_Y },
      uColor: { value: new THREE.Color('#8d8a90').multiplyScalar(0.62) },
      uMoonColor: { value: new THREE.Color('#7a1012').multiplyScalar(0.6) },
      uMoonPos: { value: MOON_POSITION.clone() },
      uThicken: { value: 0 },
      uCenterThin: { value: 1 },
    }),
    [layer]
  )

  useFrame((_, delta) => {
    // time-driven only: keeps flowing when the page is idle
    uniforms.uTime.value += Math.min(delta, 0.05) * ambientMotion()
    uniforms.uThicken.value = sceneStore.fogThicken
    // centre-thinning only matters around the hero / finale framing
    const t = sceneStore.cameraT
    uniforms.uCenterThin.value = 1 - Math.min(1, t, Math.max(0, 4 - t))
  })

  return (
    <mesh
      position={layer.position}
      rotation={layer.vertical ? [0, 0, 0] : [-Math.PI / 2, 0, 0]}
      onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
      renderOrder={2}
    >
      <planeGeometry args={layer.size} />
      <shaderMaterial
        vertexShader={fogVert}
        fragmentShader={fogFrag}
        uniforms={uniforms} ref={linkUniforms(uniforms)}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

export function GroundFog() {
  return (
    <group>
      {LAYERS.map((layer, i) => (
        <FogLayer key={i} layer={layer} />
      ))}
    </group>
  )
}

export default GroundFog
