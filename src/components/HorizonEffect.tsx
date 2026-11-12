import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { HORIZON_COLOR, LAYER_NO_REFLECT, MOON_POSITION, WATER_Y } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Soft atmospheric band where the far water meets the sky. Same charcoal as
   the sky horizon and the water's distance fade, with a faint crimson warmth
   under the moon — so there is no seam, only depth.
   ───────────────────────────────────────────────────────────────────────────── */

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const frag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uMoonGlow;
  uniform vec3 uMoonPos;
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    float band = exp(-pow(abs(vUv.y - 0.42) * 3.2, 1.7));
    float side = 1.0 - smoothstep(0.55, 0.98, abs(vUv.x - 0.5) * 2.0);
    float drift = 0.9 + 0.1 * sin(vWorld.x * 0.21 + uTime * 0.12) * sin(vWorld.x * 0.07 - uTime * 0.05);
    float moon = exp(-pow((vWorld.x - uMoonPos.x) / 9.0, 2.0));
    vec3 col = mix(uColor, uColor + uMoonGlow, moon);
    float a = band * side * drift * 0.4;
    a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const NIGHT_BAND = HORIZON_COLOR.clone().multiplyScalar(1.6)
const DAY_BAND = new THREE.Color(1.0, 0.98, 0.95).multiplyScalar(1.5)
const NIGHT_GLOW = new THREE.Color('#2a0606')
const DAY_GLOW = new THREE.Color(0.12, 0.08, 0.03)

export function HorizonEffect() {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: HORIZON_COLOR.clone().multiplyScalar(1.6) },
      uMoonGlow: { value: new THREE.Color('#2a0606') },
      uMoonPos: { value: MOON_POSITION.clone() },
    }),
    []
  )

  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05) * ambientMotion()
    // day: pale haze band, warm glow under the sun instead of crimson
    const day = sceneStore.day > 0.5
    uniforms.uColor.value.copy(day ? DAY_BAND : NIGHT_BAND)
    uniforms.uMoonGlow.value.copy(day ? DAY_GLOW : NIGHT_GLOW)
  })

  return (
    <mesh
      position={[0, WATER_Y + 1.6, -48]}
      renderOrder={1}
      onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
    >
      <planeGeometry args={[160, 9, 1, 1]} />
      <shaderMaterial
        vertexShader={vert}
        fragmentShader={frag}
        uniforms={uniforms} ref={linkUniforms(uniforms)}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

export default HorizonEffect
