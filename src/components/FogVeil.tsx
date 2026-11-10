import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { LAYER_NO_REFLECT } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Screen-space mist veil (rendered over the scene, outside Suspense so it is
   on screen from the very first frame).
   - Preloader: near-black drifting mist. uPart (0 → 1) pushes the mist density
     away from the screen centre, so it parts horizontally from the middle out.
   - Journey: uDim darkens the scene behind dense sections (one owner: here).
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
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
    float t = uTime;
    vec2 q = p * 2.4 + vec2(t * 0.035, t * 0.012);
    vec2 w = vec2(fbm(q + vec2(0.0, t * 0.02)), fbm(q + vec2(5.2, -t * 0.017)));
    float n = fbm(q + (w - 0.5) * 1.8);

    // mist parting: an uneven, feathered gap that opens from the centre outward
    float x = abs(vUv.x - 0.5) * 2.0;                 // 0 centre → 1 edge
    float edge = uPart * 1.35 + (n - 0.5) * 0.35 * (1.0 - uPart * 0.6);
    float closed = smoothstep(edge - 0.32, edge + 0.02, x);
    closed = uPart <= 0.0001 ? 1.0 : closed;
    closed *= 1.0 - smoothstep(0.92, 1.0, uPart);

    // veil colour: near-black with faint cool-grey wisps
    vec3 mist = vec3(0.012, 0.012, 0.016) + vec3(0.055, 0.052, 0.06) * smoothstep(0.35, 0.95, n);
    float aVeil = closed;

    // journey darkening (not tied to the mist)
    vec3 col = mist;
    float a = aVeil;
    if (uDim > 0.0) {
      float aDim = uDim * 0.32;
      col = mix(vec3(0.0), mist, aVeil / max(aVeil + aDim * (1.0 - aVeil), 1e-4));
      a = aVeil + aDim * (1.0 - aVeil);
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
    }),
    []
  )

  useFrame((state, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05) * ambientMotion()
    uniforms.uPart.value = sceneStore.fogPart
    uniforms.uDim.value = sceneStore.dim
    uniforms.uAspect.value = state.size.width / Math.max(1, state.size.height)
  })

  return (
    <mesh
      frustumCulled={false}
      renderOrder={9999}
      onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
    >
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms} ref={linkUniforms(uniforms)}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}

export default FogVeil
