import * as THREE from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
   Katana material effects, injected into the authored physical materials:
   - blade gradient: crimson toward the tip by night (moon + water bounce)
   - dissolve: the material burns away along an axis of a reference object, with an
     irregular glowing edge. Used for the saya after the draw (mouth → end) and for the
     day/night transformation (one katana replaces the other, pommel → tip).
   ───────────────────────────────────────────────────────────────────────────── */

export interface DissolveUniforms {
  /** world → reference-object space (set every frame) */
  uDisRef: { value: THREE.Matrix4 }
  /** axis in reference space the front travels along */
  uDisAxis: { value: THREE.Vector3 }
  /** front position along the axis (reference units) */
  uDisFront: { value: number }
  /** +1 keeps what lies beyond the front, −1 keeps what lies before it */
  uDisKeep: { value: number }
  /** 0 off (fully shown), 1 on */
  uDisOn: { value: number }
  /** irregularity / edge width (reference units) */
  uDisWidth: { value: number }
  /** emissive colour of the burning edge */
  uDisEdge: { value: THREE.Color }
}

export function makeDissolve(axis: THREE.Vector3, width: number): DissolveUniforms {
  return {
    uDisRef: { value: new THREE.Matrix4() },
    uDisAxis: { value: axis.clone() },
    uDisFront: { value: 0 },
    uDisKeep: { value: 1 },
    uDisOn: { value: 0 },
    uDisWidth: { value: width },
    uDisEdge: { value: new THREE.Color(0, 0, 0) },
  }
}

const NOISE = /* glsl */ `
  float disHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float disNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(disHash(i), disHash(i + vec3(1,0,0)), f.x), mix(disHash(i + vec3(0,1,0)), disHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(disHash(i + vec3(0,0,1)), disHash(i + vec3(1,0,1)), f.x), mix(disHash(i + vec3(0,1,1)), disHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`

export function patchKatanaMaterial(
  mat: THREE.MeshPhysicalMaterial,
  opts: { dissolve: DissolveUniforms; blade?: { tipY: number; amount: { value: number } } }
) {
  const { dissolve: D, blade } = opts
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, D)
    const vs = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform mat4 uDisRef;
         uniform vec3 uDisAxis;
         varying float vDisCoord;
         varying vec3 vDisPos;
         ${blade ? 'varying float vBladeY;' : ''}`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vec3 disP = (uDisRef * modelMatrix * vec4(transformed, 1.0)).xyz;
         vDisPos = disP;
         vDisCoord = dot(disP, uDisAxis);
         ${blade ? 'vBladeY = position.y;' : ''}`
      )
    let fs = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uDisFront;
         uniform float uDisKeep;
         uniform float uDisOn;
         uniform float uDisWidth;
         uniform vec3 uDisEdge;
         varying float vDisCoord;
         varying vec3 vDisPos;
         ${blade ? 'varying float vBladeY;\nuniform vec3 uBladeTint;\nuniform float uBladeAmt;' : ''}
         ${NOISE}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         float disEdge = 0.0;
         if (uDisOn > 0.5) {
           float n = disNoise(vDisPos * (3.0 / uDisWidth)) * 0.65 + disNoise(vDisPos * (9.0 / uDisWidth)) * 0.35;
           float dd = (vDisCoord + (n - 0.5) * uDisWidth - uDisFront) * uDisKeep;
           if (dd < 0.0) discard;
           disEdge = 1.0 - smoothstep(0.0, uDisWidth * 0.35, dd);
         }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uDisEdge * disEdge * disEdge;`
      )
    if (blade) {
      shader.uniforms.uBladeTint = { value: new THREE.Color(1.0, 0.12, 0.1) }
      shader.uniforms.uBladeAmt = blade.amount
      fs = fs.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         {
           // 0 at the upper blade → 1 at the tip (lower third reads crimson)
           float bw = smoothstep(${(blade.tipY * 0.36).toFixed(3)}, ${(blade.tipY * 0.97).toFixed(3)}, vBladeY);
           bw = pow(bw, 1.25) * uBladeAmt;
           vec3 tint = mix(vec3(1.0), uBladeTint * 1.55, bw);
           reflectedLight.directSpecular *= tint;
           reflectedLight.indirectSpecular *= tint;
           float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
           reflectedLight.indirectSpecular += uBladeTint * bw * (0.05 + 0.1 * fres);
         }`
      )
    }
    shader.vertexShader = vs
    shader.fragmentShader = fs
  }
  mat.customProgramCacheKey = () => (blade ? 'katana-blade-dissolve' : 'katana-dissolve')
}

/* ─── Ash / ink particles shed by the saya's burning edge ─── */
const PARTICLE_VERT = /* glsl */ `
  uniform float uFront;
  uniform float uWidth;
  uniform float uTime;
  uniform float uPixel;
  attribute float aSeed;
  attribute vec3 aDrift;
  varying float vAlpha;
  void main() {
    // a particle leaves once the burning front has passed it
    float coord = position.x;
    float age = (uFront - coord) / max(uWidth, 1e-3) * 0.35;
    float life = clamp(age, 0.0, 1.0);
    vec3 p = position;
    float t = life * (1.4 + aSeed);
    // drift away from the saya, sink slowly (the saya's +X points down the blade), curl a little
    p += aDrift * t * 0.09;
    p.x += t * t * 0.05;
    p.y += sin(t * 5.0 + aSeed * 20.0) * 0.008 * t;
    p.z += cos(t * 4.0 + aSeed * 13.0) * 0.008 * t;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vAlpha = step(0.0, age) * (1.0 - life) * smoothstep(0.0, 0.08, life + 0.02);
    gl_PointSize = uPixel * (1.5 + aSeed * 2.0) * (1.0 - 0.6 * life) * (6.0 / max(1.0, -mv.z));
  }
`
const PARTICLE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || vAlpha <= 0.001) discard;
    float a = smoothstep(0.5, 0.1, d) * vAlpha;
    gl_FragColor = vec4(mix(uColor, uHot, vAlpha * vAlpha), a);
    #include <colorspace_fragment>
  }
`

export interface SayaParticles {
  points: THREE.Points
  uniforms: {
    uFront: { value: number }
    uWidth: { value: number }
    uTime: { value: number }
    uPixel: { value: number }
    uColor: { value: THREE.Color }
    uHot: { value: THREE.Color }
  }
}

/** Points sampled from the saya's surface, in the saya node's own space. */
export function makeSayaParticles(saya: THREE.Object3D, count = 1400): SayaParticles {
  saya.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(saya.matrixWorld).invert()
  const src: THREE.Vector3[] = []
  const v = new THREE.Vector3()
  saya.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    const step = Math.max(1, Math.floor(pos.count / 2500))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).applyMatrix4(inv)
      src.push(v.clone())
    }
  })
  const n = Math.min(count, Math.max(1, src.length))
  const position = new Float32Array(n * 3)
  const seed = new Float32Array(n)
  const drift = new Float32Array(n * 3)
  let r = 9781
  const rnd = () => ((r = (r * 16807) % 2147483647) - 1) / 2147483646
  for (let i = 0; i < n; i++) {
    const p = src[Math.floor(rnd() * src.length)] ?? new THREE.Vector3()
    position.set([p.x, p.y + (rnd() - 0.5) * 0.004, p.z + (rnd() - 0.5) * 0.004], i * 3)
    seed[i] = rnd()
    // outward from the saya's axis, a little random
    const a = rnd() * Math.PI * 2
    drift.set([rnd() * 0.3, Math.cos(a), Math.sin(a)], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
  g.setAttribute('aDrift', new THREE.BufferAttribute(drift, 3))
  const uniforms = {
    uFront: { value: -1 },
    uWidth: { value: 0.06 },
    uTime: { value: 0 },
    uPixel: { value: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2) },
    uColor: { value: new THREE.Color(0.08, 0.06, 0.06) },
    uHot: { value: new THREE.Color(1.0, 0.3, 0.12) },
  }
  const mat = new THREE.ShaderMaterial({
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
  })
  const points = new THREE.Points(g, mat)
  points.frustumCulled = false
  points.visible = false
  return { points, uniforms }
}
