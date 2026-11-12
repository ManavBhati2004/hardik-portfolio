import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { LAYER_NO_REFLECT } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Screen-space cloud veil (rendered over the scene, outside Suspense so it is
   on screen from the very first frame).
   - Preloader: three parallax layers of billowing, lit cloud. uPart (0 → 1)
     rolls them outward from the centre: the near layer opens first and
     furthest, the far layer last, so the parting has real depth.
   - Journey: uDim darkens (night) or pales (day) the scene behind dense sections.
   ───────────────────────────────────────────────────────────────────────────── */

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`

const frag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform float uPart;
  uniform float uDim;
  uniform float uAspect;
  uniform float uDay;
  varying vec2 vUv;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 6; i++) { v += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  // one billowing cloud layer: domain-warped fbm with puffy (squared) density
  // returns (density, lit) — lit = how much light the surface catches from the centre glow
  vec2 cloud(vec2 p, float t, float seed) {
    vec2 q = p + vec2(t * 0.03, t * 0.012) + seed;
    vec2 w = vec2(fbm(q * 0.7 + vec2(0.0, t * 0.02)), fbm(q * 0.7 + vec2(4.7, -t * 0.018)));
    float n = fbm(q + (w - 0.5) * 1.6);
    float dens = smoothstep(0.32, 0.78, n);
    dens = dens * dens * (3.0 - 2.0 * dens);
    // light: compare with a sample nudged toward the light (screen centre) — cheap self-shadowing
    vec2 toL = normalize(-p + 1e-4) * 0.08;
    float n2 = fbm(q + toL + (w - 0.5) * 1.6);
    float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
    return vec2(dens, lit);
  }

  void main() {
    vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float t = uTime;
    float x = abs(vUv.x - 0.5) * 2.0;   // 0 centre → 1 edge

    // (day values sit above 1: the frame is filmic tone-mapped afterwards, which would
    //  otherwise turn the morning clouds a dull grey)
    vec3 dark = mix(vec3(0.010, 0.010, 0.013), vec3(0.93, 0.92, 0.9) * 1.75, uDay);
    vec3 lightC = mix(vec3(0.16, 0.155, 0.17), vec3(1.0, 0.99, 0.97) * 1.9, uDay);
    vec3 shadowC = mix(vec3(0.03, 0.03, 0.035), vec3(0.8, 0.8, 0.82) * 1.6, uDay);

    // the preloader mist is now the real 3D fog volume (VolumetricFog.ts), which parts in
    // depth around the moon; this veil only handles the section dimming
    vec3 col = dark;
    float a = 0.0;
    // journey dim: toward black by night, toward paper by day
    if (uDim > 0.0) {
      vec3 dimC = mix(vec3(0.0), vec3(0.95, 0.94, 0.92) * 1.75, uDay);
      float aDim = uDim * mix(0.32, 0.26, uDay);
      col = mix(dimC, col, a / max(a + aDim * (1.0 - a), 1e-4));
      a = a + aDim * (1.0 - a);
    }
    a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0 * a;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`

export function FogVeil() {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPart: { value: 0 },
      uDim: { value: 0 },
      uAspect: { value: 1 },
      uDay: { value: 0 },
    }),
    []
  )

  useFrame((state, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05) * ambientMotion()
    uniforms.uPart.value = sceneStore.fogPart
    uniforms.uDim.value = sceneStore.dim
    uniforms.uDay.value = sceneStore.day
    uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height)
  })

  return (
    <mesh frustumCulled={false} renderOrder={9999} onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms}
        ref={linkUniforms(uniforms)}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

export default FogVeil
