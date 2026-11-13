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
   normal map, lit by a soft key so maria, craters and limb read in 3D
   (Lommel–Seeliger regolith, hard terminator, earthshine). Colour is a muted,
   dark crimson (not a flat red disc), wrapped in a soft crimson haze. Rotates
   very slowly, forever, around one axis — never tied to the cursor.
   ───────────────────────────────────────────────────────────────────────────── */

const moonVert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vTanW;
  varying vec3 vBitW;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    // tangent frame in object space (longitude / latitude of the equirect maps), carried
    // to world space so the relief stays locked to the surface as the moon turns
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), normal) + vec3(1e-4, 0.0, 0.0));
    vec3 B = normalize(cross(normal, T));
    mat3 m = mat3(modelMatrix);
    vNormalW = normalize(m * normal);
    vTanW = normalize(m * T);
    vBitW = normalize(m * B);
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
  varying vec3 vTanW;
  varying vec3 vBitW;
  varying vec3 vWorld;

  void main() {
    vec3 Ng = normalize(vNormalW);
    vec3 nT = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    // unsharp mask on the normals: crisper crater rims than the 2K map alone gives
    vec3 nTs = texture2D(uNormal, vUv, 2.0).xyz * 2.0 - 1.0;
    vec2 rel = nT.xy * 1.15 + (nT.xy - nTs.xy) * 0.6;
    vec3 N = normalize(normalize(vTanW) * rel.x + normalize(vBitW) * rel.y + Ng * max(nT.z, 0.25));

    // albedo with a local-contrast boost (ray systems and crater floors read sharper)
    vec3 albedo = texture2D(uDiffuse, vUv).rgb;
    vec3 albedoS = texture2D(uDiffuse, vUv, 2.5).rgb;
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    float lumS = dot(albedoS, vec3(0.299, 0.587, 0.114));
    lum = clamp(lum + (lum - lumS) * 0.55, 0.0, 1.0);
    // keep maria contrast: lift highlands, deepen maria
    float relief = pow(lum, 1.35) * 1.6;

    vec3 L = normalize(uLightDir);
    vec3 V = normalize(cameraPosition - vWorld);
    float mu0 = max(dot(N, L), 0.0);
    float mu = max(dot(Ng, V), 0.0);
    // regolith: Lommel–Seeliger (flat, bright to the limb) blended with a little Lambert
    float ls = 2.0 * mu0 / (mu0 + mu + 1e-3);
    float bright = mix(mu0, ls, 0.62);
    // airless body → hard terminator, anti-aliased over a hair-thin band of the geometric normal
    float term = smoothstep(-0.015, 0.06, dot(Ng, L));
    vec3 col = uTint * relief * bright * term;

    // earthshine: the night side is faintly lit (cooler, deeper red) so the full sphere reads
    float es = (1.0 - term) * (0.35 + 0.65 * mu);
    col += vec3(0.42, 0.045, 0.06) * relief * 0.05 * es + uTint * relief * 0.012;

    // thin warm rim on the lit limb (forward-scattered light through the haze)
    float rim = pow(1.0 - mu, 5.0) * smoothstep(-0.05, 0.4, dot(Ng, L));
    col += vec3(0.9, 0.22, 0.16) * rim * 0.2;

    gl_FragColor = vec4(col * uExposure, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const haloVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

/* value noise shared by the haze and the sun (sampled along a direction → seamless around the disc) */
const noiseGlsl = /* glsl */ `
  float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { return vn(p) * 0.55 + vn(p * 2.1 + 7.3) * 0.3 + vn(p * 4.3 - 3.1) * 0.15; }
  float dither() { return (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; }
`

/* Crimson atmospheric haze around the moon: a tight aureole hugging the limb and a wide
   soft glow that bleeds into the clouds, broken up by slowly drifting haze. */
const haloFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uPresence;
  uniform float uTime;
  varying vec2 vUv;
  ${noiseGlsl}
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;                  // 0 centre → 1 edge of quad
    float r = d / uInner;                       // 1 = moon limb
    float o = max(r - 1.0, 0.0);
    float haze = fbm(p * 5.0 + vec2(uTime * 0.02, -uTime * 0.012));
    float aureole = exp(-o * 9.0) * 0.34;
    float glow = exp(-o * 2.2) * 0.14 + exp(-o * 0.75) * 0.05;
    float a = (aureole + glow * (0.55 + 0.9 * haze)) * uPresence;
    a *= smoothstep(1.0, 0.62, d) * step(0.985, r);
    vec3 col = mix(uColor * 1.9, uColor, smoothstep(0.0, 1.2, o));
    gl_FragColor = vec4(col, clamp(a + dither(), 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/* Day: a soft, hazy pale-apricot sun exactly the moon's size (the quad is 9 radii wide, so the
   disc edge sits at d = 1/4.5): limb-darkened disc veiled by drifting mist, a Mie aureole and
   faint light shafts through the haze. Kept quieter than the white blade in front of it. */
const sunFrag = /* glsl */ `
  uniform float uPresence;
  uniform float uTime;
  varying vec2 vUv;
  ${noiseGlsl}
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;                  // 0 centre → 1 quad edge
    float r = d * 4.5;                          // 1 = disc edge (moon radius)
    vec2 dir = p / max(length(p), 1e-4);
    // soft limb through the haze
    float core = 1.0 - smoothstep(0.93, 1.04, r);
    // limb darkening (stronger in blue → the limb runs warmer)
    float mu = sqrt(max(1.0 - r * r, 0.0));
    vec3 ld = vec3(1.0) - vec3(0.42, 0.56, 0.68) * (1.0 - pow(mu, 0.8));
    vec3 disc = vec3(1.0, 0.72, 0.5) * ld;
    // mist drifting across the face
    disc *= 0.86 + 0.14 * fbm(vec2(p.x * 6.0 + uTime * 0.03, p.y * 22.0));
    float o = max(r - 1.0, 0.0);
    // Mie aureole: tight bright fringe + wide warm haze
    float glow = exp(-o * 4.5) * 0.2 + exp(-o * 1.2) * 0.075 + exp(-o * 0.4) * 0.025;
    // gentle light shafts (crepuscular rays through the mist), drifting very slowly
    float rays = fbm(dir * 3.5 + vec2(uTime * 0.012, 0.0)) * fbm(dir * 8.0 - vec2(0.0, uTime * 0.008));
    rays = smoothstep(0.18, 0.55, rays) * exp(-o * 0.55) * smoothstep(0.0, 0.25, o) * 0.06;
    vec3 col = disc * core + vec3(1.0, 0.66, 0.42) * (glow + rays) * (1.0 - core);
    float a = clamp(core + (glow + rays) * (1.0 - core), 0.0, 1.0) * smoothstep(1.0, 0.72, d) * uPresence;
    gl_FragColor = vec4(col, clamp(a + dither(), 0.0, 1.0));
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
  normalMap.anisotropy = 8

  const uniforms = useMemo(
    () => ({
      uDiffuse: { value: diffuseMap },
      uNormal: { value: normalMap },
      uLightDir: { value: new THREE.Vector3(0.72, 0.3, 0.62) },
      uTint: { value: new THREE.Color(0.78, 0.04, 0.035) },
      uExposure: { value: 0.5 },
    }),
    [diffuseMap, normalMap]
  )

  const haloUniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color('#5a0c0c') },
      uInner: { value: 1 / 4.2 },
      uPresence: { value: 0 },
      uTime: { value: 0 },
    }),
    []
  )
  const placement = useMoonPlacement()
  const sunRef = useRef<THREE.Mesh>(null!)
  const sunUniforms = useMemo(() => ({ uPresence: { value: 0 }, uTime: { value: 0 } }), [])

  useFrame((_, delta) => {
    // slow, continuous, single-axis rotation (independent of input)
    const dt = Math.min(delta, 0.05) * ambientMotion()
    moonRef.current.rotation.y += dt * 0.012
    haloUniforms.uTime.value += dt
    sunUniforms.uTime.value += dt
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
      {/* crimson atmospheric haze (not reflected; kept soft) */}
      <mesh
        ref={haloRef}
        position={[0, 0, -0.2]}
        renderOrder={1}
        onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)}
      >
        <planeGeometry args={[MOON_RADIUS * 4.2, MOON_RADIUS * 4.2]} />
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
        <planeGeometry args={[MOON_RADIUS * 9, MOON_RADIUS * 9]} />
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
