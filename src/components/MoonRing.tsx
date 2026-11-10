import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LAYER_NO_REFLECT } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { useMoonPlacement } from '../scene/useMoonPlacement'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Faint segmented light ring around the moon: exactly three thin, separated
   arcs in muted crimson that glide slowly around the moon's circumference.
   Anti-aliased in the shader (fwidth), soft arc ends, low contrast — an
   atmospheric halo, not a HUD. Sits just in front of the moon, behind the sword.
   ───────────────────────────────────────────────────────────────────────────── */


const vert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const frag = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uWidth;
  uniform vec3 uColor;
  uniform float uPresence;
  varying vec2 vP;

  void main() {
    float r = length(vP);
    float aa = fwidth(r) * 1.2;
    float line = 1.0 - smoothstep(uWidth * 0.5 - aa, uWidth * 0.5 + aa, abs(r - uRadius));
    // faint glow around the line
    float glow = exp(-abs(r - uRadius) / (uWidth * 6.0)) * 0.18;

    // three arcs, 120° apart, each ~78° long with feathered ends, rotating slowly
    float ang = atan(vP.y, vP.x) - uTime * 0.035;
    float seg = fract(ang / 6.2831853 * 3.0);          // 0..1 within each third
    float arc = smoothstep(0.0, 0.08, seg) * (1.0 - smoothstep(0.64, 0.72, seg));
    // each arc brightens gently toward its middle
    arc *= 0.65 + 0.35 * sin(clamp(seg / 0.72, 0.0, 1.0) * 3.14159);

    float a = (line * 0.42 + glow * 0.3) * arc * uPresence;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function MoonRing() {
  const camera = useThree((s) => s.camera)
  const ref = useRef<THREE.Mesh>(null!)
  const placement = useMoonPlacement()
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: 1 },
      uPresence: { value: 0 },
      uWidth: { value: 0.026 },
      uColor: { value: new THREE.Color('#7d4a48') },
    }),
    []
  )

  useFrame((_, delta) => {
    uniforms.uTime.value += Math.min(delta, 0.05) * ambientMotion()
    ref.current.quaternion.copy(camera.quaternion)
    uniforms.uPresence.value = sceneStore.ringPresence * (1 - sceneStore.dim * 0.4) * (1 + 0.35 * sceneStore.katanaFinale)
    uniforms.uRadius.value = placement.ringRadius
  })

  const ringRadius = placement.ringRadius
  const quad = ringRadius * 2.3

  return (
    <mesh
      ref={ref}
      position={placement.position}
      renderOrder={3}
      onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
    >
      <planeGeometry args={[quad, quad]} />
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

export default MoonRing
