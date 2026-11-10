// Procedural space environment: nebula sky (baked once to a cubemap), image-based lighting
// derived from the same sky (so reflections match the backdrop), twinkling star points, and a
// shaded planet with atmosphere. Zero textures shipped; ~12 MB VRAM for the sky cube.
import * as THREE from "three";
import { NOISE } from "./noise.glsl.js";

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
varying vec3 vDir;
${NOISE}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = mix(vec3(0.0015, 0.002, 0.004), vec3(0.004, 0.006, 0.012), d.y * 0.5 + 0.5);

  // galactic band: a tilted great circle, broken up by two fbm layers and dark dust lanes
  vec3 bandN = normalize(vec3(0.35, 0.82, -0.45));
  float band = exp(-pow(dot(d, bandN), 2.0) * 9.0);
  float cloud = fbm(d * 2.6, 6);
  float wisps = fbm(d * 7.0 + cloud * 1.8, 5);
  float dust = smoothstep(0.42, 0.72, fbm(d * 11.0 + 4.0, 4));
  vec3 teal = vec3(0.05, 0.16, 0.2), rose = vec3(0.22, 0.06, 0.14), gold = vec3(0.24, 0.16, 0.08);
  vec3 neb = mix(teal, rose, smoothstep(0.35, 0.7, fbm(d * 1.7 + 11.0, 4)));
  neb = mix(neb, gold, smoothstep(0.55, 0.85, band) * 0.6);
  col += neb * band * pow(cloud * wisps * 2.2, 2.2) * (1.0 - dust * 0.85) * 0.55;
  // off-band emission nebula patches
  col += rose * pow(smoothstep(0.58, 0.9, fbm(d * 3.2 + 40.0, 5)), 2.0) * 0.08;

  // the sun as seen from orbit: tight disc + wide glare (drives IBL warmth too)
  float mu = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(mu, 9000.0) * uSunDisc + pow(mu, 180.0) * 0.6 + pow(mu, 12.0) * 0.012);
  gl_FragColor = vec4(col, 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

function skyMesh(sunDir, sunColor, sunDisc) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(100, 64, 32),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uSunDir: { value: sunDir.clone() },
        uSunColor: { value: sunColor.clone() },
        uSunDisc: { value: sunDisc },
      },
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
}

/**
 * Bake sky -> cubemap (background) and sky + planet-shine -> PMREM (environment).
 * One-time cost at startup (~20-60 ms); per-frame cost is a plain cubemap lookup.
 */
export function buildSpaceEnvironment(renderer, { sunDir, sunColor, planetDir, size = 512 }) {
  const skyScene = new THREE.Scene();
  const sky = skyMesh(sunDir, sunColor, 60.0);
  skyScene.add(sky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cubeCam = new THREE.CubeCamera(1, 1000, cubeRT);
  cubeCam.update(renderer, skyScene);

  // Environment scene: same sky, sun disc toned down (the DirectionalLight owns the key),
  // plus a broad blue "planet-shine" card below — cheap fill that makes metals read.
  const envScene = new THREE.Scene();
  const envSky = skyMesh(sunDir, sunColor, 4.0);
  envScene.add(envSky);
  const shine = new THREE.Mesh(
    new THREE.CircleGeometry(60, 48),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.3, 0.6), side: THREE.DoubleSide }),
  );
  shine.position.copy(planetDir).multiplyScalar(80);
  shine.lookAt(0, 0, 0);
  envScene.add(shine);
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), new THREE.MeshBasicMaterial({ color: 0x9fb8ff, side: THREE.DoubleSide }));
  rim.position.set(-sunDir.x, 0.2, -sunDir.z).normalize().multiplyScalar(80);
  rim.lookAt(0, 0, 0);
  envScene.add(rim);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const o of [sky, envSky, shine, rim]) { o.geometry.dispose(); o.material.dispose(); }
  return { background: cubeRT.texture, environment: envRT.texture, dispose: () => { cubeRT.dispose(); envRT.dispose(); } };
}

// ------------------------------------------------------------------------------------ stars
export function createStars({ count = 7000, radius = 900, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const meta = new Float32Array(count * 2); // size, twinkle phase
  const bandN = new THREE.Vector3(0.35, 0.82, -0.45).normalize();
  const v = new THREE.Vector3();
  const temps = [[0.62, 0.72, 1.0], [0.85, 0.9, 1.0], [1.0, 1.0, 1.0], [1.0, 0.92, 0.78], [1.0, 0.75, 0.52]];
  for (let i = 0; i < count; i++) {
    // 45% of stars concentrate near the galactic band — matches the nebula
    do {
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (rnd() < 0.45) v.addScaledVector(bandN, -v.dot(bandN) * (0.75 + rnd() * 0.25)).normalize();
    v.multiplyScalar(radius).toArray(pos, i * 3);
    const mag = Math.pow(rnd(), 9);                 // few bright, many faint
    const t = temps[Math.min(4, Math.floor(rnd() * rnd() * 5 + (rnd() < 0.2 ? 3 : 0)))];
    const b = 0.25 + mag * 7.0;                      // brightest go >1 so bloom catches them
    col.set([t[0] * b, t[1] * b, t[2] * b], i * 3);
    meta.set([1.2 + mag * 3.2, rnd() * 100], i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("meta", new THREE.BufferAttribute(meta, 2));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec2 meta;
      uniform float uTime, uPixelRatio;
      varying vec3 vColor;
      void main() {
        float tw = 0.78 + 0.22 * sin(uTime * (1.3 + fract(meta.y) * 2.4) + meta.y);
        vColor = color * tw;
        gl_PointSize = meta.x * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // pin to far plane: never occludes, never clipped
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float r2 = dot(c, c) * 4.0;
        float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.2);
        gl_FragColor = vec4(vColor * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}

// ------------------------------------------------------------------------------------ planet
export function createPlanet({ radius, sunDir, sunColor, quality = 1 }) {
  const uniforms = {
    uSunDir: { value: sunDir.clone() },
    uSunColor: { value: sunColor.clone() },
    uTime: { value: 0 },
  };
  const octaves = quality > 0 ? 6 : 4;
  const surface = new THREE.ShaderMaterial({
    uniforms,
    defines: { OCT: octaves },
    vertexShader: /* glsl */ `
      varying vec3 vP, vN, vW;
      void main() {
        vP = normalize(position);
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uSunColor;
      uniform float uTime;
      varying vec3 vP, vN, vW;
      ${NOISE}
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(uSunDir);
        float h = fbm(vP * 2.4, OCT);
        float land = smoothstep(0.5, 0.53, h);
        float lat = abs(vP.y);
        vec3 ocean = mix(vec3(0.004, 0.02, 0.06), vec3(0.01, 0.06, 0.12), smoothstep(0.35, 0.5, h));
        float dry = fbm(vP * 6.0 + 3.0, 4);
        vec3 ground = mix(vec3(0.04, 0.08, 0.025), vec3(0.2, 0.14, 0.07), smoothstep(0.4, 0.65, dry));
        ground = mix(ground, vec3(0.75), smoothstep(0.78, 0.86, lat + (h - 0.5) * 0.3));
        vec3 alb = mix(ocean, ground, land);

        vec3 cp = vP * 3.5 + vec3(uTime * 0.004, 0.0, uTime * 0.002);
        float clouds = smoothstep(0.48, 0.78, fbm(cp + fbm(vP * 8.0, 3) * 0.6, OCT));
        alb = mix(alb, vec3(0.62), clouds * 0.85);

        float ndl = dot(N, L);
        float day = smoothstep(-0.08, 0.25, ndl);
        vec3 col = alb * max(ndl, 0.0) * uSunColor * 1.15;

        // ocean sun glint (Blinn-Phong is plenty at this scale)
        vec3 H = normalize(L + V);
        col += uSunColor * pow(max(dot(N, H), 0.0), 180.0) * (1.0 - land) * (1.0 - clouds) * 1.4 * day;

        // night side: city lights on land, under clouds, only where it is dark
        float cities = smoothstep(0.62, 0.8, fbm(vP * 42.0, 3)) * smoothstep(0.55, 0.6, h);
        col += vec3(1.0, 0.62, 0.3) * cities * (1.0 - clouds * 0.8) * (1.0 - day) * 1.6;

        // in-surface atmosphere: Rayleigh-ish blue at the limb, warm band at the terminator
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        float twilight = exp(-pow(ndl * 5.0, 2.0));
        vec3 atmo = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.45, 0.2), twilight * 0.7);
        col += atmo * fres * smoothstep(-0.25, 0.35, ndl) * 0.8;
        col += vec3(0.02, 0.05, 0.12) * day;  // aerial blue veil on the day side
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 64), surface);

  // outer halo: back faces of a slightly bigger shell, additive, lit side only
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 96, 48),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vN, vW;
        void main() {
          vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        varying vec3 vN, vW;
        void main() {
          vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
          // back faces: N points away from the camera, so 1 + N.V peaks at the silhouette
          float rim = pow(clamp(1.0 + dot(N, V), 0.0, 1.0), 5.0);
          float lit = smoothstep(-0.25, 0.5, dot(N, normalize(uSunDir)));
          vec3 c = mix(vec3(0.9, 0.4, 0.2), vec3(0.3, 0.55, 1.0), lit) * rim * (0.1 + lit) * 0.9;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const group = new THREE.Group();
  group.add(planet, halo);
  group.userData.uniforms = uniforms;
  return group;
}
