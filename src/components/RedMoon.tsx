import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useTexture } from '@react-three/drei'
import { LAYER_NO_REFLECT, MOON_RADIUS } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { useMoonPlacement } from '../scene/useMoonPlacement'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Distant blood moon: a real sphere with the 2K NASA lunar albedo + crater
   normal map, lit by a soft key so maria, craters and limb darkening read
   in 3D. Colour is a muted, dark crimson (not a flat red disc), with a faint
   atmospheric halo. Rotates very slowly, forever, around one axis — never
   tied to the cursor.
   ───────────────────────────────────────────────────────────────────────────── */

const moonVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const moonFrag = /* glsl */ `
  uniform sampler2D uDiffuse;
  uniform sampler2D uNormal;
  uniform vec3 uLightDir;
  uniform vec3 uTint;
  uniform float uExposure;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vWorld;

  void main() {
    vec3 Ng = normalize(vNormalW);
    // tangent frame on the sphere (longitude / latitude directions)
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Ng) + vec3(1e-4, 0.0, 0.0));
    vec3 B = normalize(cross(Ng, T));
    vec3 nT = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    vec3 N = normalize(T * nT.x * 0.9 + B * nT.y * 0.9 + Ng * nT.z);

    vec3 albedo = texture2D(uDiffuse, vUv).rgb;
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    // keep maria contrast: lift highlands, deepen maria
    float relief = pow(lum, 1.35) * 1.6;

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(cameraPosition - vWorld);
    // Oren-Nayar-ish lunar response: flat-ish disc with soft terminator & limb darkening
    float ndl = dot(N, L);
    float lit = smoothstep(-0.18, 0.55, ndl);
    float limb = pow(clamp(dot(Ng, V), 0.0, 1.0), 0.45);
    vec3 col = uTint * relief * lit * mix(0.55, 1.0, limb);
    // night side keeps a trace of earthshine so the sphere silhouette stays readable
    col += uTint * relief * 0.035;
    // thin warm rim on the lit limb
    float rim = pow(1.0 - clamp(dot(Ng, V), 0.0, 1.0), 4.0) * smoothstep(-0.1, 0.5, dot(Ng, L));
    col += vec3(0.9, 0.22, 0.16) * rim * 0.22;

    gl_FragColor = vec4(col * uExposure, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const haloVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const haloFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uPresence;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;           // 0 centre → 1 edge of quad
    float r = max(d - uInner, 0.0) / (1.0 - uInner);
    float a = (exp(-r * 5.0) * 0.09 + exp(-r * 14.0) * 0.08) * uPresence;
    a *= smoothstep(1.0, 0.75, d) * step(uInner * 0.98, d);
    a += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/* Day: a pale sun behind morning haze — warm-white core, wide soft bloom (no hard disc). */
const sunFrag = /* glsl */ `
  uniform float uPresence;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;            // 0 centre → 1 quad edge
    float core = 1.0 - smoothstep(0.17, 0.2, d);  // soft-edged disc, veiled
    float glow = exp(-d * 5.5) * 0.85 + exp(-d * 2.2) * 0.35;
    vec3 col = vec3(1.0, 0.97, 0.9) * (core * 1.25 + glow);
    float a = clamp(core * 0.92 + glow, 0.0, 1.0) * smoothstep(1.0, 0.7, d) * uPresence;
    gl_FragColor = vec4(col * 1.6, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function RedMoon() {
  const camera = useThree((s) => s.camera)
  const moonRef = useRef<THREE.Mesh>(null!)
  const haloRef = useRef<THREE.Mesh>(null!)

  const [diffuseMap, normalMap] = useTexture(['/textures/moon_nasa_2k.jpg', '/textures/moon_nasa_normal_2k.jpg'])
  diffuseMap.colorSpace = THREE.SRGBColorSpace
  normalMap.colorSpace = THREE.NoColorSpace
  diffuseMap.anisotropy = 8

  const uniforms = useMemo(
    () => ({
      uDiffuse: { value: diffuseMap },
      uNormal: { value: normalMap },
      uLightDir: { value: new THREE.Vector3(0.45, 0.35, 0.82) },
      uTint: { value: new THREE.Color(0.78, 0.04, 0.035) },
      uExposure: { value: 0.5 },
    }),
    [diffuseMap, normalMap]
  )

  const haloUniforms = useMemo(
    () => ({ uColor: { value: new THREE.Color('#5a0c0c') }, uInner: { value: 1 / 2.6 }, uPresence: { value: 0 } }),
    []
  )
  const placement = useMoonPlacement()
  const sunRef = useRef<THREE.Mesh>(null!)
  const sunUniforms = useMemo(() => ({ uPresence: { value: 0 } }), [])

  useFrame((_, delta) => {
    // slow, continuous, single-axis rotation (independent of input)
    moonRef.current.rotation.y += Math.min(delta, 0.05) * 0.012 * ambientMotion()
    haloRef.current.quaternion.copy(camera.quaternion)
    // presence: fades and brightens in as the preloader mist parts; dims behind dense sections
    const p = sceneStore.moonPresence
    const presence = p * p * (3 - 2 * p)
    uniforms.uExposure.value = 0.5 * presence * (1 - sceneStore.dim * 0.35) * (1 + 0.12 * sceneStore.katanaFinale)
    haloUniforms.uPresence.value = presence
    // day ↔ night: moon and its halo by night, hazy sun by day
    const day = sceneStore.day > 0.5
    moonRef.current.visible = !day
    haloRef.current.visible = !day
    sunRef.current.visible = day
    sunRef.current.quaternion.copy(camera.quaternion)
    sunUniforms.uPresence.value = presence * (1 - sceneStore.dim * 0.3)
  })

  return (
    <group position={placement.position} scale={placement.scale}>
      <mesh ref={moonRef} rotation={[0.18, 2.4, 0.08]}>
        <sphereGeometry args={[MOON_RADIUS, 128, 96]} />
        <shaderMaterial vertexShader={moonVert} fragmentShader={moonFrag} uniforms={uniforms} ref={linkUniforms(uniforms)} />
      </mesh>
      {/* faint atmospheric halo (not reflected; kept subtle) */}
      <mesh
        ref={haloRef}
        position={[0, 0, -0.2]}
        renderOrder={1}
        onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
      >
        <planeGeometry args={[MOON_RADIUS * 2.6, MOON_RADIUS * 2.6]} />
        <shaderMaterial
          vertexShader={haloVert}
          fragmentShader={haloFrag}
          uniforms={haloUniforms} ref={linkUniforms(haloUniforms)}
          transparent
          depthWrite={false}
        />
      </mesh>
      {/* day sun (same placement as the moon) */}
      <mesh ref={sunRef} renderOrder={1} visible={false} onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}>
        <planeGeometry args={[MOON_RADIUS * 6, MOON_RADIUS * 6]} />
        <shaderMaterial
          vertexShader={haloVert}
          fragmentShader={sunFrag}
          uniforms={sunUniforms} ref={linkUniforms(sunUniforms)}
          transparent
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

useTexture.preload(['/textures/moon_nasa_2k.jpg', '/textures/moon_nasa_normal_2k.jpg'])

export default RedMoon
