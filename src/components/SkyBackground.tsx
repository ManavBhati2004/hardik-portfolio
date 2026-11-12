import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { HORIZON_COLOR, LAYER_NO_REFLECT, MOON_POSITION, SKY_ZENITH } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'
import { linkUniforms } from '../scene/linkUniforms'

/* ─────────────────────────────────────────────────────────────────────────────
   Deep night sky.
   - Sky dome: charcoal gradient + very faint high cloud veils from 3D noise
     sampled on the view direction. The direction is rotated slowly around the
     vertical axis over time, so the sky turns continuously with no texture seam
     and no reset. Only this layer rotates — the scene and camera stay still.
   - A small number of faint stars (instanced points) that twinkle slowly and
     drift extremely slowly; kept out of the sword column.
   ───────────────────────────────────────────────────────────────────────────── */

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vDir = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_Position.z = gl_Position.w * 0.99999; // always just inside the far plane
  }
`

const skyFrag = /* glsl */ `
  precision highp float;
  uniform float uAngle;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uMoonDir;
  uniform float uDay;
  varying vec3 vDir;

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 3.1; a *= 0.5; } return v; }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // gradient: horizon haze → near-black zenith (mirrors below the horizon for the reflection)
    float t = smoothstep(-0.02, 0.55, abs(h));
    vec3 col = mix(uHorizon, uZenith, t);

    // slowly rotating cloud veils (rotation of the lookup direction = seamless sky rotation)
    float c = cos(uAngle), s = sin(uAngle);
    vec3 rd = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
    // broad, soft cloud masses: near-isotropic noise with a domain warp (no long horizontal
    // bands, which read as water lines repeated in the sky)
    vec3 cp = rd * vec3(2.1, 3.0, 2.1);
    float warp = fbm(cp + 4.0);
    float clouds = fbm(cp + vec3(warp * 1.5, warp * 0.8, -warp * 1.3) + 9.0);
    clouds = smoothstep(0.5, 0.84, clouds) * smoothstep(0.03, 0.22, h) * (1.0 - smoothstep(0.5, 0.95, h));
    float sdm = max(dot(d, uMoonDir), 0.0);
    // night air: a deep blue-black that lifts a little toward the horizon
    col += vec3(0.0025, 0.0035, 0.0075) * (1.0 - t);
    // clouds catch moonlight on the moon side, and stay near-black elsewhere
    float moonward = pow(sdm, 5.0);
    col += clouds * (vec3(0.006, 0.006, 0.008) + vec3(0.03, 0.005, 0.005) * moonward);
    // atmosphere around the moon: tight glow + a wide, faint scatter
    col += vec3(0.03, 0.004, 0.004) * pow(sdm, 40.0) * 0.5 + vec3(0.018, 0.003, 0.004) * pow(sdm, 7.0) * (1.0 - 0.6 * clouds);
    // a faint band of star dust across the upper sky
    float band = exp(-pow(dot(d, normalize(vec3(0.42, 0.55, -0.72))) * 4.5, 2.0));
    col += vec3(0.006, 0.006, 0.009) * band * (0.4 + 0.6 * warp) * smoothstep(0.08, 0.45, h) * (1.0 - clouds);

    // day: misty ink-wash morning — off-white haze at the horizon, pale grey-blue above,
    // a soft warm sun glow where the moon sits by night, faint grey cloud veils
    if (uDay > 0.5) {
      float th = smoothstep(-0.04, 0.7, abs(h));
      // a slightly deeper, cooler off-white overhead, so the white lacquer separates from the sky
      vec3 day = mix(vec3(0.975, 0.965, 0.945) * 1.32, vec3(0.70, 0.76, 0.83) * 1.05, th);
      float sd = max(dot(d, uMoonDir), 0.0);
      day += vec3(1.0, 0.78, 0.58) * (pow(sd, 10.0) * 0.05 + pow(sd, 70.0) * 0.14);
      day -= clouds * vec3(0.07, 0.07, 0.065);
      col = day;
    }
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 400.0;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const starVert = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // slow, independent twinkle (no rapid blinking)
    float tw = 0.62 + 0.38 * sin(uTime * aSpeed + aPhase) * sin(uTime * aSpeed * 0.37 + aPhase * 1.7);
    // keep the sword column clear (screen centre band)
    vec2 ndc = gl_Position.xy / gl_Position.w;
    float column = smoothstep(0.06, 0.2, abs(ndc.x - 0.04));
    vAlpha = tw * column;
    gl_PointSize = aSize * uPixelRatio;
  }
`

const starFrag = /* glsl */ `
  uniform float uNight;
  varying float vAlpha;
  void main() {
    if (uNight < 0.5) discard; // no stars by day
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.85, 0.86, 0.9) * 1.4, core * core * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

function Stars() {
  const groupRef = useRef<THREE.Points>(null!)
  const { geometry, uniforms } = useMemo(() => {
    const COUNT = 380
    const pos = new Float32Array(COUNT * 3)
    const size = new Float32Array(COUNT)
    const phase = new Float32Array(COUNT)
    const speed = new Float32Array(COUNT)
    let seed = 1337
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < COUNT; i++) {
      // spread over the visible sky in front of the camera (with margin for the slow drift)
      const az = (rnd() - 0.5) * 2.1 // radians around -Z
      const el = 0.1 + Math.pow(rnd(), 0.8) * 0.75
      const r = 120
      pos[i * 3] = Math.sin(az) * Math.cos(el) * r
      pos[i * 3 + 1] = Math.sin(el) * r
      pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * r
      // mostly faint points, some medium, a few bright ones
      const m = rnd()
      size[i] = m > 0.96 ? 2.6 + rnd() * 0.9 : m > 0.75 ? 1.5 + rnd() * 0.7 : 0.8 + rnd() * 0.6
      phase[i] = rnd() * Math.PI * 2
      speed[i] = 0.25 + rnd() * 0.5
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1))
    return {
      geometry: g,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2) },
        uNight: { value: 1 },
      },
    }
  }, [])

  useFrame((_, delta) => {
    const d = Math.min(delta, 0.05) * ambientMotion()
    uniforms.uTime.value += d
    uniforms.uNight.value = 1 - sceneStore.day
    // extremely slow drift — the sky feels alive without visible motion
    groupRef.current.rotation.y += d * 0.0022
    groupRef.current.rotation.z = Math.sin(uniforms.uTime.value * 0.01) * 0.01
  })

  return (
    <points ref={groupRef} geometry={geometry} onUpdate={(self) => self.layers.set(LAYER_NO_REFLECT)} renderOrder={-1}>
      <shaderMaterial
        vertexShader={starVert}
        fragmentShader={starFrag}
        uniforms={uniforms} ref={linkUniforms(uniforms)}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export function SkyBackground() {
  const uniforms = useMemo(
    () => ({
      uAngle: { value: 0 },
      uZenith: { value: SKY_ZENITH.clone() },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uMoonDir: { value: MOON_POSITION.clone().normalize() },
      uDay: { value: 0 },
    }),
    []
  )

  useFrame((_, delta) => {
    // sky layer rotates slowly in one direction, independent of the moon
    uniforms.uAngle.value += Math.min(delta, 0.05) * 0.004 * ambientMotion()
    uniforms.uDay.value = sceneStore.day
  })

  return (
    <group>
      <mesh renderOrder={-2} frustumCulled={false}>
        <sphereGeometry args={[150, 48, 24]} />
        <shaderMaterial
          vertexShader={skyVert}
          fragmentShader={skyFrag}
          uniforms={uniforms} ref={linkUniforms(uniforms)}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      <Stars />
    </group>
  )
}

export default SkyBackground
