import * as THREE from 'three'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { MOON_POSITION, WATER_Y } from '../scene/config'
import { ambientMotion, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Volumetric mist — a depth-aware raymarched fog volume (post effect).

   Why: flat fog planes read as sheets (visible edges, hard lines where they cut
   rocks, no depth inside). Here every pixel marches a view ray through a real
   3D fog volume up to the scene depth, so the mist wraps around and between
   the rocks, the torii and the blade, has parallax as the camera travels, and
   scatters the moon / sun through it.

   - density: exponential height falloff over the water (FogExp2-like, which
     reads more natural than linear), shaped by tileable 3D fbm noise that
     drifts with the wind and rolls slowly
   - lighting: Beer–Lambert transmittance + Henyey–Greenstein forward
     scattering toward the moon (night) / sun (day), ambient sky light, darker
     dense cores; no bloom tricks (contrast comes from the light ratio)
   - jittered steps (interleaved gradient noise) instead of banding
   - preloader: an extra full-height bank that parts from the centre outward
   ───────────────────────────────────────────────────────────────────────────── */

const NOISE_SIZE = 64

/** Tileable 3D value-noise fbm, baked once (R8, 64³ ≈ 260 KB). */
function bakeNoise3D(): THREE.Data3DTexture {
  const N = NOISE_SIZE
  const data = new Uint8Array(N * N * N)
  // periodic lattice per octave so the texture tiles seamlessly
  const lattice = (period: number, seed: number) => {
    const L = new Float32Array(period * period * period)
    let s = seed
    for (let i = 0; i < L.length; i++) {
      s = (s * 16807) % 2147483647
      L[i] = (s - 1) / 2147483646
    }
    return L
  }
  const octaves = [
    { period: 4, amp: 0.5, L: lattice(4, 1337) },
    { period: 8, amp: 0.27, L: lattice(8, 7331) },
    { period: 16, amp: 0.15, L: lattice(16, 4242) },
    { period: 32, amp: 0.08, L: lattice(32, 9001) },
  ]
  const fade = (t: number) => t * t * (3 - 2 * t)
  let i = 0
  for (let z = 0; z < N; z++) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let v = 0
        for (const o of octaves) {
          const P = o.period
          const fx = (x / N) * P
          const fy = (y / N) * P
          const fz = (z / N) * P
          const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz)
          const tx = fade(fx - x0), ty = fade(fy - y0), tz = fade(fz - z0)
          const at = (a: number, b: number, c: number) => o.L[((c % P) * P + (b % P)) * P + (a % P)]
          const x1 = x0 + 1, y1 = y0 + 1, z1 = z0 + 1
          const c00 = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * tx
          const c10 = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * tx
          const c01 = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * tx
          const c11 = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * tx
          const c0 = c00 + (c10 - c00) * ty
          const c1 = c01 + (c11 - c01) * ty
          v += (c0 + (c1 - c0) * tz) * o.amp
        }
        data[i++] = Math.round(Math.min(1, Math.max(0, v)) * 255)
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N)
  tex.format = THREE.RedFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

const fragment = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D uNoise;
  uniform mat4 uProjInv;
  uniform mat4 uViewInv;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uDay;
  uniform float uDensity;      // overall density (thickens on the journey)
  uniform float uCenterThin;   // 1 around the hero framing: keep the blade tip readable
  uniform float uPart;         // preloader: 0 closed → 1 parted
  uniform float uSteps;
  uniform vec3 uLightPos;      // moon (night) / sun (day)
  uniform vec3 uWind;
  uniform float uWaterY;
  uniform float uSigma;        // extinction per unit density
  uniform float uHeight;       // height falloff scale above the water
  uniform float uLightK;       // forward-scatter strength
  uniform float uAmbK;         // ambient brightness
  uniform float uPreK;         // preloader bank density
  uniform float uJit;          // step jitter amount

  float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

  float hg(float c, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (12.5663706 * pow(1.0 + g2 - 2.0 * g * c, 1.5));
  }

  // two scales of drifting noise: big rolling banks + finer wisps
  // (fine detail fades out with distance: far mist is soft, and sparse samples of fine
  //  noise along grazing rays would otherwise alias into contour bands)
  float fogNoise(vec3 p, float dist) {
    vec3 q = p * 0.11 + uWind * uTime * 0.012;
    float big = texture(uNoise, q).r;
    float fineW = 1.0 - smoothstep(7.0, 16.0, dist);
    if (fineW <= 0.0) return big * 0.68 + 0.5 * 0.42;
    vec3 r = p * 0.38 + vec3(uTime * 0.021, uTime * 0.006, -uTime * 0.014) + big * 0.6;
    float fine = texture(uNoise, r).r;
    return big * 0.68 + mix(0.5, fine, fineW) * 0.42;
  }

  // density at a world point: exponential height falloff over the water, sculpted by noise
  float densityAt(vec3 p, float preload, float dist) {
    float h = p.y - uWaterY;
    if (h < -0.05) return 0.0;
    float n = fogNoise(p, dist);
    // ground bank: thick on the water, thinning upward (and rolling with the noise)
    float ground = exp(-max(h, 0.0) / (uHeight * (0.5 + 1.0 * n))) * smoothstep(0.46, 0.8, n);
    // higher drifting wisps
    float wisps = exp(-max(h - 0.6, 0.0) / 0.9) * smoothstep(0.58, 0.85, n) * 0.35;
    float d = (ground + wisps) * uDensity;
    // preloader: a deep bank filling the whole view, parting from the centre
    d += preload * uPreK * (0.25 + smoothstep(0.35, 0.85, n));
    return d;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec2 ndc = uv * 2.0 - 1.0;
    vec4 vp = uProjInv * vec4(ndc, depth * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
    vec3 ro = uCamPos;
    vec3 rd = normalize(wp - ro);
    float sceneDist = depth >= 0.9999 ? 1e4 : length(wp - ro);

    // preloader cover: closed at uPart 0, opening horizontally from the centre (uneven edge)
    float preload = 0.0;
    if (uPart < 0.999) {
      float x = abs(ndc.x);
      float edge = uPart * 1.6 - 0.25 + (texture(uNoise, vec3(uv * 1.7, uTime * 0.01)).r - 0.5) * 0.5;
      // the gap opens in the centre and widens outward: fog remains only beyond the edge
      preload = smoothstep(edge - 0.3, edge + 0.05, x);
      preload = uPart <= 0.001 ? 1.0 : preload;
    }

    // march only through the fog slab (water → top of the volume); the whole ray while preloading
    float top = uWaterY + (preload > 0.0 ? 9.0 : 3.2);
    float t0 = 0.0;
    float t1 = min(sceneDist, 34.0);
    if (abs(rd.y) > 1e-4) {
      float ta = (uWaterY - 0.05 - ro.y) / rd.y;
      float tb = (top - ro.y) / rd.y;
      t0 = max(t0, min(ta, tb));
      t1 = min(t1, max(ta, tb));
    } else if (ro.y > top) {
      t1 = -1.0;
    }
    if (t1 <= t0) { outputColor = inputColor; return; }

    // never fog the lens: start a little in front of the camera
    t0 = max(t0, 0.6);
    float steps = uSteps;
    // geometric step distribution: dense near the camera where the mist has detail,
    // sparse in the distance where it is soft (no screen-door noise on grazing rays)
    float ratio = t1 / t0;
    // a little per-pixel jitter breaks up step banding without a visible screen-door pattern
    float jitter = mix(0.5, ign(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0), uJit);
    float tPrev = t0;

    // lighting colours: night = cool grey mist + crimson moonlight; day = luminous paper-white + warm sun
    vec3 ambN = vec3(0.075, 0.075, 0.088);
    vec3 litN = vec3(0.62, 0.11, 0.1);
    vec3 ambD = vec3(1.18, 1.16, 1.13);
    vec3 litD = vec3(1.6, 1.42, 1.15);
    vec3 amb = mix(ambN, ambD, uDay) * uAmbK;
    vec3 lightC = mix(litN, litD, uDay);

    vec3 Lpos = uLightPos;
    float trans = 1.0;
    vec3 scat = vec3(0.0);
    // the hero framing keeps a thinner column in the middle (blade + its reflection)
    float thin = mix(1.0, 0.45 + 0.55 * smoothstep(0.08, 0.5, abs(ndc.x - 0.05)), uCenterThin);

    for (int i = 0; i < 32; i++) {
      if (float(i) >= steps || trans < 0.02) break;
      float tNext = t0 * pow(ratio, (float(i) + 1.0) / steps);
      float stepLen = tNext - tPrev;
      float t = tPrev + stepLen * jitter;
      tPrev = tNext;
      vec3 p = ro + rd * t;
      float d = densityAt(p, preload, t) * thin;
      if (d > 0.002) {
        // fade in over the first metres: the camera never sits inside a flat veil
        d *= smoothstep(0.8, 4.0, t) + preload;
        float sigma = d * uSigma;
        float att = exp(-sigma * stepLen);
        vec3 toL = normalize(Lpos - p);
        float phase = hg(dot(rd, toL), 0.62) * 9.0 + 0.35;      // strong forward glow toward the light
        float core = smoothstep(0.6, 1.6, d);                       // dense cores are self-shadowed
        // billow shading: lighter where the bank thins at its top, darker in its folds
        float relief = 0.62 + 0.7 * smoothstep(0.35, 0.9, fogNoise(p + vec3(0.0, 0.35, 0.0), t));
        // the opening bank is cool grey mist, a little brighter than the night behind it (so it
        // reads as mist parting, not darkness); the crimson moon glow stays subtle inside it
        vec3 lum = (amb * (1.0 - 0.45 * core) * (1.0 + preload * 1.4)
                    + lightC * phase * uLightK * (1.0 - 0.6 * core) * (1.0 - preload * 0.75)) * relief;
        // energy-conserving integration of in-scattering over the step
        scat += trans * lum * (1.0 - att);
        trans *= att;
      }
    }
    outputColor = vec4(inputColor.rgb * trans + scat, inputColor.a);
  }
`

export class VolumetricFogEffect extends Effect {
  private camera: THREE.PerspectiveCamera
  private time = 0

  constructor(camera: THREE.PerspectiveCamera, steps: number) {
    super('VolumetricFogEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uNoise', new THREE.Uniform(bakeNoise3D())],
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uViewInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamPos', new THREE.Uniform(new THREE.Vector3())],
        ['uTime', new THREE.Uniform(0)],
        ['uDay', new THREE.Uniform(0)],
        ['uDensity', new THREE.Uniform(1)],
        ['uCenterThin', new THREE.Uniform(1)],
        ['uPart', new THREE.Uniform(0)],
        ['uSteps', new THREE.Uniform(steps)],
        ['uLightPos', new THREE.Uniform(MOON_POSITION.clone())],
        ['uWind', new THREE.Uniform(new THREE.Vector3(1.0, 0.0, 0.25))],
        ['uWaterY', new THREE.Uniform(WATER_Y)],
        ['uSigma', new THREE.Uniform(0.9)],
        ['uHeight', new THREE.Uniform(0.6)],
        ['uLightK', new THREE.Uniform(0.035)],
        ['uAmbK', new THREE.Uniform(1.0)],
        ['uPreK', new THREE.Uniform(1.1)],
        ['uJit', new THREE.Uniform(0.3)],
      ]),
    })
    this.camera = camera
  }

  setSteps(steps: number) {
    this.uniforms.get('uSteps')!.value = steps
  }

  update(_renderer: THREE.WebGLRenderer, _input: THREE.WebGLRenderTarget, deltaTime?: number) {
    const u = this.uniforms
    const cam = this.camera
    this.time += Math.min(deltaTime ?? 0.016, 0.05) * ambientMotion()
    ;(u.get('uProjInv')!.value as THREE.Matrix4).copy(cam.projectionMatrixInverse)
    ;(u.get('uViewInv')!.value as THREE.Matrix4).copy(cam.matrixWorld)
    ;(u.get('uCamPos')!.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld)
    u.get('uTime')!.value = this.time
    u.get('uDay')!.value = sceneStore.day
    u.get('uPart')!.value = sceneStore.fogPart
    // swells while the camera travels low over the water; slightly denser on a misty morning
    u.get('uDensity')!.value = (1 + 0.65 * sceneStore.fogThicken) * (sceneStore.day > 0.5 ? 1.1 : 1)
    const t = sceneStore.cameraT
    u.get('uCenterThin')!.value = 1 - Math.min(1, t * 2, Math.max(0, (4 - t) * 2))
  }
}
