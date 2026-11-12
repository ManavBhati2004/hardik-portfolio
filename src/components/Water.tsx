import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { HORIZON_COLOR, LAYER_DEFAULT, MOON_POSITION, WATER_Y } from '../scene/config'
import { sceneStore, ambientMotion } from '../scene/store'
import type { CursorRef } from './Scene3D'
import { linkUniforms } from '../scene/linkUniforms'

export interface WaterProps {
  cursorRef?: CursorRef
}

/* ─────────────────────────────────────────────────────────────────────────────
   Calm reflective water.
   - Real-time planar reflection: a mirrored camera renders the live scene (sword,
     moon, rocks, branches, sky) into a texture every frame, so the sword's
     reflection follows its scroll rotation and cursor tilt exactly.
   - GPU ripple simulation (height field, wave equation): the cursor stirs the water
     and a slow drip falls under the blade tip; ripples bend the reflection.
   - Small continuous wind waves (time-driven), GGX moon specular, Fresnel,
     distance fade into the horizon haze (no seam).
   ───────────────────────────────────────────────────────────────────────────── */

/** Region of the water covered by the ripple simulation (world XZ). */
const RIPPLE_MIN = new THREE.Vector2(-9, -9)
const RIPPLE_SIZE = new THREE.Vector2(18, 16)
const SIM_RES = 256

const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const simFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev;
  uniform vec2 uTexel;
  uniform vec4 uDrop;      // xy = uv, z = strength, w = radius (uv)
  uniform vec4 uDrop2;
  varying vec2 vUv;

  float bump(vec4 d) {
    vec2 q = (vUv - d.xy) * vec2(${(RIPPLE_SIZE.x / RIPPLE_SIZE.y).toFixed(4)}, 1.0);
    float r = length(q) / max(d.w, 1e-4);
    return r < 1.0 ? d.z * (0.5 + 0.5 * cos(3.14159265 * r)) : 0.0;
  }

  void main() {
    vec4 s = texture2D(uPrev, vUv);
    float avg = (
      texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r +
      texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r +
      texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r +
      texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r) * 0.25;
    float vel = s.g + (avg - s.r) * 2.0;
    vel *= 0.986;
    float h = s.r + vel;
    h += bump(uDrop) + bump(uDrop2);
    h *= 0.997;
    // absorb at the borders so nothing reflects back from the sim edge
    vec2 e = min(vUv, 1.0 - vUv);
    float edge = smoothstep(0.0, 0.06, min(e.x, e.y));
    gl_FragColor = vec4(h * edge, vel * edge, 0.0, 1.0);
  }
`

const waterVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const waterFrag = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform sampler2D uReflection;
  uniform mat4 uTextureMatrix;
  uniform sampler2D uRipple;
  uniform vec2 uRippleMin;
  uniform vec2 uRippleSize;
  uniform vec2 uRippleTexel;
  uniform vec3 uMoonPos;
  uniform vec3 uKeyDir;
  uniform vec3 uHorizon;
  uniform float uMotion;
  uniform float uDay;
  varying vec3 vWorld;

  // gentle wind ripples: gradient of drifting value noise (two scales, two directions)
  float h21(vec2 p) { p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  vec2 windGrad(vec2 p, float t) {
    const float e = 0.06;
    vec2 g = vec2(0.0);
    vec2 a = p * 1.7 + vec2(t * 0.32, t * 0.11);
    vec2 b = p * 4.1 + vec2(-t * 0.47, t * 0.29);
    g += vec2(vn(a + vec2(e, 0.0)) - vn(a - vec2(e, 0.0)), vn(a + vec2(0.0, e)) - vn(a - vec2(0.0, e))) * 0.10;
    g += vec2(vn(b + vec2(e, 0.0)) - vn(b - vec2(e, 0.0)), vn(b + vec2(0.0, e)) - vn(b - vec2(0.0, e))) * 0.05;
    // gusts: patches of the lake ruffle while others stay glassy
    float gust = smoothstep(0.35, 0.75, vn(p * 0.18 + vec2(t * 0.05, -t * 0.03)));
    return g * (0.45 + 0.85 * gust);
  }

  // small directional wind waves → normal perturbation (time-driven, never pointer-driven)
  vec2 waveGrad(vec2 p, float t) {
    vec2 g = vec2(0.0);
    vec2 d1 = normalize(vec2(0.9, 0.42));  float k1 = 1.35; g += d1 * cos(dot(p, d1) * k1 - t * 0.55) * k1 * 0.020;
    vec2 d2 = normalize(vec2(-0.5, 0.86)); float k2 = 2.30; g += d2 * cos(dot(p, d2) * k2 + t * 0.71) * k2 * 0.010;
    vec2 d3 = normalize(vec2(0.7, -0.7));  float k3 = 3.90; g += d3 * cos(dot(p, d3) * k3 - t * 0.93) * k3 * 0.0055;
    vec2 d4 = normalize(vec2(-0.3, -0.95));float k4 = 6.70; g += d4 * cos(dot(p, d4) * k4 + t * 1.21) * k4 * 0.0028;
    vec2 d5 = normalize(vec2(0.97, 0.2));  float k5 = 11.0; g += d5 * cos(dot(p, d5) * k5 - t * 1.60) * k5 * 0.0012;
    return g;
  }

  float D_GGX(float NdotH, float a) {
    float a2 = a * a;
    float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorld);
    float dist = length(cameraPosition - vWorld);

    // wind waves fade with distance (avoids shimmer/aliasing near the horizon)
    float lod = clamp(1.0 - dist / 45.0, 0.15, 1.0);
    // the fine wind ripples fade out with distance well before they would alias into
    // moiré bands at grazing angles near the horizon
    float near = 1.0 - smoothstep(6.0, 22.0, dist);
    vec2 grad = (waveGrad(vWorld.xz, uTime) * mix(1.0, 1.45, near) + windGrad(vWorld.xz, uTime) * near) * lod * uMotion;

    // interactive ripples from the height-field simulation
    vec2 ruv = (vWorld.xz - uRippleMin) / uRippleSize;
    if (ruv.x > 0.0 && ruv.x < 1.0 && ruv.y > 0.0 && ruv.y < 1.0) {
      float hL = texture2D(uRipple, ruv - vec2(uRippleTexel.x, 0.0)).r;
      float hR = texture2D(uRipple, ruv + vec2(uRippleTexel.x, 0.0)).r;
      float hD = texture2D(uRipple, ruv - vec2(0.0, uRippleTexel.y)).r;
      float hU = texture2D(uRipple, ruv + vec2(0.0, uRippleTexel.y)).r;
      grad += vec2(hR - hL, hU - hD) * 7.0;
    }
    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

    // ── reflection: projective lookup into the mirrored render, bent by the surface normal
    vec4 rc = uTextureMatrix * vec4(vWorld, 1.0);
    vec2 suv = rc.xy / rc.w;
    vec2 distort = N.xz * (0.075 + 0.025 * smoothstep(4.0, 20.0, dist));
    suv += distort;
    // slight roughness blur (4 taps) — calm water, not a perfect mirror
    vec2 bl = vec2(0.0012, 0.0024) * (1.0 + dist * 0.04);
    vec3 refl = (
      texture2D(uReflection, suv + vec2( bl.x,  bl.y)).rgb +
      texture2D(uReflection, suv + vec2(-bl.x,  bl.y)).rgb +
      texture2D(uReflection, suv + vec2( bl.x, -bl.y)).rgb +
      texture2D(uReflection, suv + vec2(-bl.x, -bl.y)).rgb) * 0.25;

    // ── Fresnel (water F0 ≈ 0.02)
    float NdotV = clamp(dot(N, V), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
    float reflAmt = clamp(F * 1.35 + 0.18, 0.0, 0.92);

    vec3 body = mix(vec3(0.0035, 0.0032, 0.0040), vec3(0.34, 0.39, 0.43), uDay);
    vec3 col = mix(body, refl, reflAmt);

    // ── GGX moon glints on the ripples (restrained crimson)
    vec3 Lm = normalize(uMoonPos - vWorld);
    vec3 Hm = normalize(Lm + V);
    float spec = D_GGX(clamp(dot(N, Hm), 0.0, 1.0), 0.12) * F;
    // night: restrained crimson glints from the moon; day: warm-white sparkle from the sun
    col += mix(vec3(0.55, 0.06, 0.05) * 0.2, vec3(1.0, 0.95, 0.85) * 0.5, uDay) * spec;

    // cool key-light sparkle on near ripples
    vec3 Hk = normalize(uKeyDir + V);
    float sk = D_GGX(clamp(dot(N, Hk), 0.0, 1.0), 0.08) * F;
    // key-light sparkle on near ripples (tight lobe → small twinkling glints)
    col += vec3(0.75, 0.8, 0.9) * sk * mix(0.06, 0.12, uDay) * lod;

    // ── distance fade into the shared horizon haze (no hard seam)
    float haze = 1.0 - exp(-pow(dist * 0.032, 1.6));
    col = mix(col, uHorizon, clamp(haze, 0.0, 1.0));

    // dither against banding in the dark gradient
    col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 512.0;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const DAY_HORIZON = new THREE.Color(0.95, 0.94, 0.92).multiplyScalar(1.25)

export function Water({ cursorRef }: WaterProps) {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const meshRef = useRef<THREE.Mesh>(null!)

  /* ── reflection target + mirrored camera ── */
  const reflection = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      samples: 0,
    })
    rt.texture.generateMipmaps = false
    const cam = new THREE.PerspectiveCamera()
    cam.layers.set(LAYER_DEFAULT)
    return { rt, cam, textureMatrix: new THREE.Matrix4() }
  }, [])

  useEffect(() => {
    const dpr = gl.getPixelRatio()
    // half resolution on desktop, a third on phones (the reflection is blurred by ripples anyway)
    const k = size.width < 768 ? 0.34 : 0.5
    reflection.rt.setSize(Math.round(size.width * dpr * k), Math.round(size.height * dpr * k))
  }, [size, gl, reflection])

  /* ── ripple simulation (ping-pong) ── */
  const sim = useMemo(() => {
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    } as const
    const a = new THREE.WebGLRenderTarget(SIM_RES, SIM_RES, opts)
    const b = new THREE.WebGLRenderTarget(SIM_RES, SIM_RES, opts)
    const material = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: simFrag,
      uniforms: {
        uPrev: { value: a.texture },
        uTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
        uDrop: { value: new THREE.Vector4(0, 0, 0, 0.02) },
        uDrop2: { value: new THREE.Vector4(0, 0, 0, 0.02) },
      },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    const simScene = new THREE.Scene()
    simScene.add(quad)
    const simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    return { a, b, material, simScene, simCam, read: a, write: b }
  }, [])

  useEffect(() => {
    const clearColor = new THREE.Color()
    gl.getClearColor(clearColor)
    const alpha = gl.getClearAlpha()
    gl.setClearColor(0x000000, 1)
    for (const rt of [sim.a, sim.b]) {
      gl.setRenderTarget(rt)
      gl.clear()
    }
    gl.setRenderTarget(null)
    gl.setClearColor(clearColor, alpha)
    return () => {
      sim.a.dispose()
      sim.b.dispose()
      sim.material.dispose()
      reflection.rt.dispose()
    }
  }, [gl, sim, reflection])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uReflection: { value: reflection.rt.texture },
      uTextureMatrix: { value: reflection.textureMatrix },
      uRipple: { value: sim.a.texture },
      uRippleMin: { value: RIPPLE_MIN.clone() },
      uRippleSize: { value: RIPPLE_SIZE.clone() },
      uRippleTexel: { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) },
      uMoonPos: { value: MOON_POSITION.clone() },
      uKeyDir: { value: new THREE.Vector3(5, 7, 6).normalize() },
      uHorizon: { value: HORIZON_COLOR.clone() },
      uMotion: { value: 1 },
      uDay: { value: 0 },
    }),
    [reflection, sim]
  )

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(260, 200, 1, 1)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  /* scratch objects */
  const tmp = useMemo(
    () => ({
      plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y),
      normal: new THREE.Vector3(0, 1, 0),
      planePos: new THREE.Vector3(0, WATER_Y, 0),
      camPos: new THREE.Vector3(),
      view: new THREE.Vector3(),
      lookAt: new THREE.Vector3(),
      target: new THREE.Vector3(),
      rot: new THREE.Matrix4(),
      clipPlane: new THREE.Vector4(),
      reflPlane: new THREE.Plane(),
      q: new THREE.Vector4(),
      ray: new THREE.Raycaster(),
      ndc: new THREE.Vector2(),
      hit: new THREE.Vector3(),
      lastHit: new THREE.Vector3(1e9, 0, 0),
      lastCursor: new THREE.Vector2(9, 9),
      acc: 0,
      dripTimer: 1.2,
      tipBelow: true,
      time: 0,
    }),
    []
  )

  /* ── 1. ripple input + simulation, 2. mirrored render — before the main render ── */
  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const motion = ambientMotion()
    tmp.time += dt * motion
    uniforms.uTime.value = tmp.time
    uniforms.uMotion.value = motion
    uniforms.uDay.value = sceneStore.day
    uniforms.uHorizon.value.copy(sceneStore.day > 0.5 ? DAY_HORIZON : HORIZON_COLOR)

    /* pointer → water plane */
    const drop = sim.material.uniforms.uDrop.value as THREE.Vector4
    const drop2 = sim.material.uniforms.uDrop2.value as THREE.Vector4
    drop.z = 0
    drop2.z = 0
    const cursor = cursorRef?.current
    if (cursor && !sceneStore.reducedMotion) {
      const moved = Math.hypot(cursor.x - tmp.lastCursor.x, cursor.y - tmp.lastCursor.y)
      tmp.lastCursor.set(cursor.x, cursor.y)
      if (moved > 0.0005) {
        tmp.ndc.set(cursor.x, -cursor.y)
        tmp.ray.setFromCamera(tmp.ndc, camera)
        if (tmp.ray.ray.intersectPlane(tmp.plane, tmp.hit)) {
          const u = (tmp.hit.x - RIPPLE_MIN.x) / RIPPLE_SIZE.x
          const v = (tmp.hit.z - RIPPLE_MIN.y) / RIPPLE_SIZE.y
          const travel = tmp.hit.distanceTo(tmp.lastHit)
          tmp.lastHit.copy(tmp.hit)
          if (u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98 && travel < 4) {
            drop.set(u, v, Math.min(0.02, 0.004 + travel * 0.03), 0.011)
          }
        }
      }
    }

    /* slow drip beneath the blade tip */
    const tip = sceneStore.swordTip
    const tipU = (tip.x - RIPPLE_MIN.x) / RIPPLE_SIZE.x
    const tipV = (tip.z - RIPPLE_MIN.y) / RIPPLE_SIZE.y
    const tipOnWater = tipU > 0 && tipU < 1 && tipV > 0 && tipV < 1
    tmp.dripTimer -= dt
    if (tmp.dripTimer <= 0 && !sceneStore.reducedMotion && sceneStore.swordVisible && tip.y < WATER_Y + 1.2) {
      tmp.dripTimer = 2.2 + Math.random() * 2.4
      if (tipOnWater) drop2.set(tipU, tipV, 0.012, 0.007)
    }
    /* blade entering / leaving the water: ripple burst from the entry point */
    const below = tip.y < WATER_Y
    if (below !== tmp.tipBelow) {
      tmp.tipBelow = below
      if (tipOnWater && sceneStore.swordVisible && !sceneStore.reducedMotion) drop2.set(tipU, tipV, 0.035, 0.018)
    }
    if (below && sceneStore.swordVisible && tipOnWater && !sceneStore.reducedMotion && Math.random() < dt * 3) {
      // the blade cutting the surface keeps a gentle wake while it passes through
      drop.set(tipU + (Math.random() - 0.5) * 0.01, tipV, 0.006, 0.01)
    }

    /* fixed-step simulation (60 Hz) */
    tmp.acc += dt
    let steps = 0
    const prevTarget = gl.getRenderTarget()
    while (tmp.acc >= 1 / 60 && steps < 3) {
      sim.material.uniforms.uPrev.value = sim.read.texture
      gl.setRenderTarget(sim.write)
      gl.render(sim.simScene, sim.simCam)
      const t = sim.read
      sim.read = sim.write
      sim.write = t
      tmp.acc -= 1 / 60
      steps++
      drop.z = 0
      drop2.z = 0
    }
    if (steps === 3) tmp.acc = 0
    uniforms.uRipple.value = sim.read.texture

    /* mirrored camera (oblique near plane = water surface) */
    const mesh = meshRef.current
    const rc = reflection.cam
    tmp.camPos.setFromMatrixPosition(camera.matrixWorld)
    tmp.view.subVectors(tmp.planePos, tmp.camPos)
    if (tmp.view.dot(tmp.normal) > 0) {
      gl.setRenderTarget(prevTarget)
      return
    }
    tmp.view.reflect(tmp.normal).negate().add(tmp.planePos)
    tmp.rot.extractRotation(camera.matrixWorld)
    tmp.lookAt.set(0, 0, -1).applyMatrix4(tmp.rot).add(tmp.camPos)
    tmp.target.subVectors(tmp.planePos, tmp.lookAt).reflect(tmp.normal).negate().add(tmp.planePos)

    const pc = camera as THREE.PerspectiveCamera
    rc.position.copy(tmp.view)
    rc.up.set(0, 1, 0).applyMatrix4(tmp.rot).reflect(tmp.normal)
    rc.lookAt(tmp.target)
    rc.far = pc.far
    rc.updateMatrixWorld()
    rc.projectionMatrix.copy(pc.projectionMatrix)

    reflection.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    reflection.textureMatrix.multiply(rc.projectionMatrix)
    reflection.textureMatrix.multiply(rc.matrixWorldInverse)

    tmp.reflPlane.setFromNormalAndCoplanarPoint(tmp.normal, tmp.planePos)
    tmp.reflPlane.applyMatrix4(rc.matrixWorldInverse)
    tmp.clipPlane.set(tmp.reflPlane.normal.x, tmp.reflPlane.normal.y, tmp.reflPlane.normal.z, tmp.reflPlane.constant)
    const pm = rc.projectionMatrix
    tmp.q.x = (Math.sign(tmp.clipPlane.x) + pm.elements[8]) / pm.elements[0]
    tmp.q.y = (Math.sign(tmp.clipPlane.y) + pm.elements[9]) / pm.elements[5]
    tmp.q.z = -1.0
    tmp.q.w = (1.0 + pm.elements[10]) / pm.elements[14]
    tmp.clipPlane.multiplyScalar(2.0 / tmp.clipPlane.dot(tmp.q))
    pm.elements[2] = tmp.clipPlane.x
    pm.elements[6] = tmp.clipPlane.y
    pm.elements[10] = tmp.clipPlane.z + 1.0 - 0.003
    pm.elements[14] = tmp.clipPlane.w

    // render the mirrored scene (atmosphere layer excluded; no extra shadow-map pass)
    mesh.visible = false
    const shadowAuto = gl.shadowMap.autoUpdate
    gl.shadowMap.autoUpdate = false
    gl.setRenderTarget(reflection.rt)
    gl.clear()
    gl.render(scene, rc)
    gl.shadowMap.autoUpdate = shadowAuto
    gl.setRenderTarget(prevTarget)
    mesh.visible = true
  })

  return (
    <mesh ref={meshRef} position={[0, WATER_Y, -60]} geometry={geometry} receiveShadow={false}>
      <shaderMaterial
        vertexShader={waterVert}
        fragmentShader={waterFrag}
        uniforms={uniforms} ref={linkUniforms(uniforms)}
        depthWrite
        fog={false}
      />
    </mesh>
  )
}

export default Water
