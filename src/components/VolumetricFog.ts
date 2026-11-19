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
   - preloader: a tall bank of domain-warped billows that rolls toward the lens,
     self-shadowed toward the moon / sun (bright rims, dark folds), parting in
     depth from the centre with a ragged, wisp-curled edge (near bank first)
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
  // every noise fetch is textureLod(…, 0.0): the 3D noise has no mips, and gradient-free fetches
  // let ANGLE / D3D keep the march loops as loops (with texture() the HLSL compiler unrolls them,
  // which cost a 2.4 s compile on the first frame)
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
    float big = textureLod(uNoise, q, 0.0).r;
    float fineW = 1.0 - smoothstep(7.0, 16.0, dist);
    if (fineW <= 0.0) return big * 0.68 + 0.5 * 0.42;
    vec3 r = p * 0.38 + vec3(uTime * 0.021, uTime * 0.006, -uTime * 0.014) + big * 0.6;
    float fine = textureLod(uNoise, r, 0.0).r;
    return big * 0.68 + mix(0.5, fine, fineW) * 0.42;
  }

  // density at a world point: exponential height falloff over the water, sculpted by noise
  float densityAt(vec3 p, float dist) {
    float h = p.y - uWaterY;
    if (h < -0.05) return 0.0;
    float n = fogNoise(p, dist);
    // ground bank: thick on the water, thinning upward (and rolling with the noise)
    float ground = exp(-max(h, 0.0) / (uHeight * (0.5 + 1.0 * n))) * smoothstep(0.46, 0.8, n);
    // higher drifting wisps
    // (near the camera only: seen edge-on from far away, a thin high layer turns into long
    //  horizontal streaks across the lower sky, like water lines repeated above the horizon)
    float wisps = exp(-max(h - 0.6, 0.0) / 0.9) * smoothstep(0.58, 0.85, n) * 0.3 * (1.0 - smoothstep(8.0, 20.0, dist));
    return (ground + wisps) * uDensity;
  }

  // ── preloader bank ──────────────────────────────────────────────────────────
  // Per-ray frame (set once in mainImage).
  vec3 gFwd;      // camera forward
  vec3 gRight;    // camera right
  float gX;       // |ndc.x| of this pixel: the parting is measured across the screen
  float gSide;    // which half of the screen (-1 / 1): the bank drifts out that way

  struct Bank { float d; vec3 q; float keep; };

  // Domain-warped, two-scale billows filling the whole view; rolls slowly toward the lens.
  // The parting happens in depth: the near bank opens first and drifts outward and toward
  // the lens, the far bank follows; the edge is ragged with the billows and curls into wisps.
  Bank bankAt(vec3 p, float t) {
    Bank b;
    float far = smoothstep(1.5, 16.0, t);
    float open = clamp(uPart * 1.3 - far * 0.32, 0.0, 1.0);
    // already clear here whatever the noise does (edge minus its largest ragged offset):
    // skip the fetches, so the opening gap costs almost nothing while it widens
    b.d = 0.0;
    b.keep = 0.0;
    b.q = vec3(0.0);
    if (uPart > 0.001 && gX < open * 2.3 - 1.145) return b;
    vec3 ps = p + gRight * gSide * open * open * 3.5 + gFwd * open * 1.4;
    vec3 q = ps * 0.14 - gFwd * (uTime * 0.035) + vec3(uTime * 0.011, uTime * 0.003, 0.0);
    float w1 = textureLod(uNoise, q * 0.47, 0.0).r;
    float w2 = textureLod(uNoise, q * 0.47 + vec3(0.37, 0.11, 0.73), 0.0).r;
    vec3 warp = vec3(w1 - 0.5, (w2 - 0.5) * 0.6, w2 - w1) * 1.35;
    b.q = q + warp;
    float base = textureLod(uNoise, b.q, 0.0).r;
    float fineW = 1.0 - smoothstep(6.0, 15.0, t);
    float detail = fineW > 0.0 ? textureLod(uNoise, q * 2.7 + warp * 0.8 + vec3(0.0, uTime * 0.02, 0.0), 0.0).r : 0.5;
    float n = base * 0.74 + mix(0.5, detail, fineW) * 0.26;
    // height: a tall bank whose top undulates, thinner and lumpier toward it
    float h = p.y - uWaterY;
    float top = 4.5 + 4.0 * w1;
    float hf = 1.0 - 0.65 * smoothstep(top - 3.0, top + 1.0, h);
    // billows over a thin always-on floor (the view is fully veiled while loading)
    float dens = (0.3 + 1.4 * smoothstep(0.34, 0.68, n)) * hf;
    // ragged parting edge
    float edge = open * 2.3 - 0.2 + (base - 0.5) * 0.9 + (detail - 0.5) * 0.35 * fineW;
    b.keep = uPart <= 0.001 ? 1.0 : smoothstep(edge - 0.32, edge + 0.04, gX);
    // curling wisps where the bank tears: thin, fine-scale, only along the edge
    float band = b.keep * (1.0 - b.keep) * 4.0;
    float wisp = smoothstep(0.55, 0.85, detail + (base - 0.5) * 0.6) * band * 0.9;
    // never a flat sheet on the lens
    float nearFade = 0.35 + 0.65 * smoothstep(0.6, 2.5, t);
    b.d = (dens * b.keep + wisp) * nearFade * uPreK;
    return b;
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec2 ndc = uv * 2.0 - 1.0;
    vec4 vp = uProjInv * vec4(ndc, depth * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uViewInv * vec4(vp.xyz, 1.0)).xyz;
    vec3 ro = uCamPos;
    vec3 rd = normalize(wp - ro);
    float sceneDist = depth >= 0.9999 ? 1e4 : length(wp - ro);

    // preloader: is any of the bank left along this ray? (the far bank opens last, so its
    // edge bounds the whole ray; skip the bank entirely once the centre is clear)
    bool pre = uPart < 0.999;
    if (pre) {
      gFwd = -normalize(uViewInv[2].xyz);
      gRight = normalize(uViewInv[0].xyz);
      gX = abs(ndc.x);
      gSide = ndc.x < 0.0 ? -1.0 : 1.0;
      float farOpen = clamp(uPart * 1.3 - 0.32, 0.0, 1.0);
      if (uPart > 0.001 && gX < farOpen * 2.3 - 1.145) pre = false;
    }

    // march only through the fog slab (water → top of the volume); the whole ray while preloading
    float top = uWaterY + (pre ? 9.0 : 3.2);
    float t0 = 0.0;
    float t1 = min(sceneDist, pre ? 24.0 : 34.0);
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
    // the bank is opaque within a few steps: fewer steps (per quality tier) and an earlier exit
    float steps = pre ? min(uSteps, uSteps > 16.0 ? 20.0 : 12.0) : uSteps;
    float minTrans = pre ? 0.04 : 0.02;
    // geometric step distribution: dense near the camera where the mist has detail,
    // sparse in the distance where it is soft (no screen-door noise on grazing rays)
    float ratio = t1 / t0;
    // a little per-pixel jitter breaks up step banding without a visible screen-door pattern
    float jitter = mix(0.5, ign(gl_FragCoord.xy + fract(uTime * 7.0) * 113.0), uJit);
    float tPrev = t0;

    // lighting colours: night = cool grey mist + crimson moonlight; day = luminous paper-white + warm sun
    vec3 ambN = vec3(0.075, 0.075, 0.088);
    vec3 litN = vec3(0.62, 0.11, 0.1);
    vec3 ambD = vec3(1.2, 1.18, 1.14);
    vec3 litD = vec3(1.7, 1.2, 0.8);
    vec3 amb = mix(ambN, ambD, uDay) * uAmbK;
    vec3 lightC = mix(litN, litD, uDay);
    // the preloader bank: cool grey by night (a little brighter than the night behind it, so it
    // reads as mist, not darkness), paper-white by day; its light is a paler moon / sun glow
    vec3 bankAmb = amb * mix(2.6, 1.05, uDay);
    vec3 bankLit = mix(vec3(0.95, 0.42, 0.38), vec3(1.6, 1.3, 1.0), uDay);

    vec3 Lpos = uLightPos;
    float trans = 1.0;
    vec3 scat = vec3(0.0);
    // the hero framing keeps a thinner column in the middle (blade + its reflection)
    float thin = mix(1.0, 0.45 + 0.55 * smoothstep(0.08, 0.5, abs(ndc.x - 0.05)), uCenterThin);

    for (int i = 0; i < 32; i++) {
      if (float(i) >= steps || trans < minTrans) break;
      float tNext = t0 * pow(ratio, (float(i) + 1.0) / steps);
      float stepLen = tNext - tPrev;
      float t = tPrev + stepLen * jitter;
      tPrev = tNext;
      vec3 p = ro + rd * t;
      // fade in over the first metres: the camera never sits inside a flat veil
      float dG = densityAt(p, t) * thin * smoothstep(0.8, 4.0, t);
      Bank bk;
      bk.d = 0.0;
      bk.keep = 0.0;
      bk.q = vec3(0.0);
      if (pre) bk = bankAt(p, t);
      float d = dG + bk.d;
      if (d > 0.002) {
        float sigma = d * uSigma;
        float att = exp(-sigma * stepLen);
        vec3 toL = normalize(Lpos - p);
        float cosT = dot(rd, toL);
        vec3 lum = vec3(0.0);
        if (dG > 0.0) {
          float phase = hg(cosT, 0.62) * 9.0 + 0.35;                // strong forward glow toward the light
          float core = smoothstep(0.6, 1.6, dG);                       // dense cores are self-shadowed
          // billow shading: lighter where the bank thins at its top, darker in its folds
          float relief = 0.62 + 0.7 * smoothstep(0.35, 0.9, fogNoise(p + vec3(0.0, 0.35, 0.0), t));
          lum += (amb * (1.0 - 0.45 * core) + lightC * phase * uLightK * (1.0 - 0.6 * core)) * relief * (dG / d);
        }
        if (bk.d > 0.0) {
          // two-tap self-shadow toward the light: how much light reaches this point through the bank
          vec3 toLq = toL * 0.14;
          float s1 = smoothstep(0.36, 0.7, textureLod(uNoise, bk.q + toLq * 0.9, 0.0).r);
          float s2 = smoothstep(0.36, 0.7, textureLod(uNoise, bk.q + toLq * 2.4, 0.0).r);
          float sun = exp(-(s1 * 1.1 + s2 * 0.9) * 1.5 * bk.keep);
          // skylight is occluded inside dense folds, open on thin rims and the bank's top
          float occl = 0.32 + 0.68 * sun;
          // forward scattering toward the moon / sun, plus a wide soft halo where it will appear
          float phase = hg(cosT, 0.7) * 2.2 + hg(cosT, 0.2) * 0.6;
          // powder: thin edges catch more light than their density suggests (bright rims)
          float powder = 1.0 - exp(-bk.d * 4.0);
          vec3 bl = bankAmb * occl + bankLit * phase * sun * (0.35 + 0.65 * powder) * mix(0.16, 0.12, uDay);
          lum += bl * (bk.d / d);
        }
        // energy-conserving integration of in-scattering over the step
        scat += trans * lum * (1.0 - att);
        trans *= att;
      }
    }
    outputColor = vec4(inputColor.rgb * trans + scat, inputColor.a);
  }
`

/* Why the fog renders in update() instead of the merged effect shader:
   EffectPass merges the fog with DepthOfField and Bloom, and those two build their blur /
   glow from the pass's *input buffer* in their own update(), i.e. from the scene before the
   fog. DoF then composites `input * (1 - coc) + farBlur`, which put the unfogged scene back
   everywhere out of focus (the closed preloader bank could never become opaque, and the mist
   thinned in the defocused distance). update() runs for every effect, in order, before the
   merged draw, so here the fogged frame is written back into the input buffer first; DoF and
   Bloom then blur and glow the fogged image, and the merged stage is a pass-through. */
const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`
const fogPassFrag = /* glsl */ `
  #include <packing>
  uniform sampler2D tInput;
  uniform sampler2D tDepth;
  uniform bool uRgbaDepth;
  varying vec2 vUv;
  ${fragment}
  void main() {
    vec4 c = texture2D(tInput, vUv);
    vec4 dt = texture2D(tDepth, vUv);
    float d = uRgbaDepth ? unpackRGBAToDepth(dt) : dt.r;
    vec4 o;
    mainImage(c, vUv, d, o);
    gl_FragColor = o;
  }
`
const copyFrag = /* glsl */ `
  uniform sampler2D tInput;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tInput, vUv); }
`
const passThrough = /* glsl */ `
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { outputColor = inputColor; }
`

export class VolumetricFogEffect extends Effect {
  private camera: THREE.PerspectiveCamera
  private time = 0
  private fogRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  private fogMat: THREE.ShaderMaterial
  private copyMat: THREE.ShaderMaterial
  private quad: THREE.Mesh
  private quadScene = new THREE.Scene()
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  constructor(camera: THREE.PerspectiveCamera, steps: number) {
    super('VolumetricFogEffect', passThrough, {
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
        ['uPreK', new THREE.Uniform(2.6)],
        ['uJit', new THREE.Uniform(0.3)],
      ]),
    })
    this.camera = camera
    // the fog's own full-screen pass shares the effect's uniform objects (tuning stays live)
    const shared: Record<string, THREE.IUniform> = {}
    this.uniforms.forEach((u, k) => (shared[k] = u))
    this.fogMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: fogPassFrag,
      uniforms: { ...shared, tInput: { value: null }, tDepth: { value: null }, uRgbaDepth: { value: false } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: copyFrag,
      uniforms: { tInput: { value: null } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fogMat)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  setDepthTexture(depthTexture: THREE.Texture, depthPacking: THREE.DepthPackingStrategies = THREE.BasicDepthPacking) {
    this.fogMat.uniforms.tDepth.value = depthTexture
    this.fogMat.uniforms.uRgbaDepth.value = depthPacking === THREE.RGBADepthPacking
  }

  setSize(width: number, height: number) {
    this.fogRT.setSize(width, height)
  }

  dispose() {
    this.fogRT.dispose()
    this.fogMat.dispose()
    this.copyMat.dispose()
    this.quad.geometry.dispose()
    super.dispose()
  }

  /** Fog the input buffer in place: input → fogRT (fog pass), fogRT → input (copy). */
  private renderFog(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget) {
    if (!this.fogMat.uniforms.tDepth.value) return
    if (this.fogRT.width !== input.width || this.fogRT.height !== input.height) this.fogRT.setSize(input.width, input.height)
    const prevTarget = renderer.getRenderTarget()
    const prevAuto = renderer.autoClear
    renderer.autoClear = false
    this.fogMat.uniforms.tInput.value = input.texture
    this.quad.material = this.fogMat
    renderer.setRenderTarget(this.fogRT)
    renderer.render(this.quadScene, this.quadCam)
    this.copyMat.uniforms.tInput.value = this.fogRT.texture
    this.quad.material = this.copyMat
    renderer.setRenderTarget(input)
    renderer.render(this.quadScene, this.quadCam)
    renderer.setRenderTarget(prevTarget)
    renderer.autoClear = prevAuto
  }

  setSteps(steps: number) {
    this.uniforms.get('uSteps')!.value = steps
  }

  update(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, deltaTime?: number) {
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
    u.get('uDensity')!.value = (1 + 0.65 * sceneStore.fogThicken) * (sceneStore.day > 0.5 ? 0.85 : 1)
    const t = sceneStore.cameraT
    u.get('uCenterThin')!.value = 1 - Math.min(1, t * 2, Math.max(0, (4 - t) * 2))
    this.renderFog(renderer, input)
  }
}
