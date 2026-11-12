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
    // upright banks roll: a slow vertical billow travelling along the bank
    q.y += (sin(q.x * 0.55 + t * 0.21 + uSeed) * 0.32 + sin(q.x * 1.3 - t * 0.13) * 0.12) * uVertical;
    vec2 warp = vec2(fbm(q * 0.55 + vec2(0.0, t * 0.035)), fbm(q * 0.55 + vec2(5.2, -t * 0.03)));
    float n = fbm(q + (warp - 0.5) * 2.2);
    // large slow masses underneath the wisps give the fog volume and depth
    float mass = fbm(q * 0.42 + vec2(3.1, -1.7) - vec2(t * 0.012, 0.0));
    n = mix(n, n * 0.55 + mass * 0.6, 0.45);
    // slow density breathing
    n += 0.06 * sin(t * 0.11 + uSeed);
    float d = smoothstep(0.38, 0.82, n);

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
    float forward = pow(clamp(dot(-toCam, toMoon), 0.0, 1.0), 4.0) * 1.25;
    float lateral = exp(-pow((vWorld.x - uMoonPos.x) / 5.0, 2.0));
    // denser cores read darker and cooler (self-shadowed), thin edges catch the light
    float core = smoothstep(0.55, 0.95, n);
    vec3 col = uColor * (0.68 + 0.45 * n) * mix(1.0, 0.82, core) + uMoonColor * (forward * 0.9 + lateral * 0.25) * (1.0 - core * 0.5);

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
  // Only the far horizon banks remain as planes: they sit beyond the volumetric fog's
  // march distance and soften the far waterline. Everything nearer is the raymarched
  // volume (VolumetricFog.ts), which wraps the rocks instead of slicing through them.
  { position: [0, WATER_Y + 0.8, -26], size: [90, 2.2], vertical: true, wind: [0.22, 0], scale: 0.09, density: 0.62, seed: 3.1 },
  { position: [6, WATER_Y + 0.7, -16], size: [60, 1.9], vertical: true, wind: [0.3, 0], scale: 0.13, density: 0.5, seed: 7.4 },]

const NIGHT_FOG = new THREE.Color('#8d8a90').multiplyScalar(0.62)
const NIGHT_LIGHT = new THREE.Color('#7a1012').multiplyScalar(0.6)
const DAY_FOG = new THREE.Color(0.95, 0.94, 0.92).multiplyScalar(1.3)
const DAY_LIGHT = new THREE.Color(0.26, 0.2, 0.12)

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
    // day: luminous off-white morning mist with a warm sun bias; night: grey with crimson moonlight
    const day = sceneStore.day > 0.5
    uniforms.uColor.value.copy(day ? DAY_FOG : NIGHT_FOG)
    uniforms.uMoonColor.value.copy(day ? DAY_LIGHT : NIGHT_LIGHT)
    uniforms.uDensity.value = layer.density * (day ? 0.95 : 1)
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
