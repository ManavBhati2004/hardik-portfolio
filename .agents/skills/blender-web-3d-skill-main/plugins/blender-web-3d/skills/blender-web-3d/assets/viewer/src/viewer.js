// The viewer: one function owns renderer, scene, post chain, model, animation, and the loop.
// Framework-agnostic — call it from a React useEffect (return the dispose function) or a
// plain <script type="module">.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { PropertyBinding } from "three";
import { buildSpaceEnvironment, createPlanet, createStars } from "./shaders/space.js";
import { applyPatches, shared as patchUniforms } from "./shaders/patches.js";
import { FINISH, NAN_SCRUB } from "./shaders/post.js";
import { createQualityGovernor, initialTier, TIERS } from "./quality.js";
import { staticBatch } from "./batching.js";

const DEFAULTS = {
  model: "/models/station.glb",
  fitSize: 20,                                   // model's largest dimension, scene units
  sunDir: new THREE.Vector3(-0.8, 0.32, 0.45),   // one sun: key light, sky disc, planet terminator
  sunColor: new THREE.Color(1.0, 0.9, 0.78),
  cameraStart: new THREE.Vector3(17, 5.5, 24),
  spin: { match: /_Pivot/, axis: "x", speed: 0.07 }, // JS-driven rotors (drivers do not export)
  patches: [
    { match: /Hull/, kind: "panels" },
    { match: /^Window/, kind: "windows" },
    { match: /Solar/, kind: "cells" },
  ],
  strobes: [
    { match: /Beacon_(Red|Green)/, mode: "nav", boost: 6 },
    { match: /Beacon_Dock/, mode: "pulse", boost: 4 },
    { match: /Engine_Glow/, mode: "breathe", boost: 1.12 },
  ],
  planet: { radius: 190, position: new THREE.Vector3(120, -230, -360) },
  quality: "auto",                               // "auto" | "eco" | "balanced" | "high"
  debug: false,
  onProgress: () => {},
  onStats: () => {},
};

export async function createViewer(canvas, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const sunDir = o.sunDir.clone().normalize();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false,            // MSAA lives on the composer target instead
    powerPreference: "high-performance", stencil: false,
    preserveDrawingBuffer: o.debug,      // on only for screenshot QA; costs a copy per frame
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;   // same view transform as Blender's AgX
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;               // count every pass of the frame, not the last

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 4000);
  camera.position.copy(o.cameraStart);

  // ---------------------------------------------------------------- environment
  const env = buildSpaceEnvironment(renderer, {
    sunDir, sunColor: o.sunColor, planetDir: o.planet.position.clone().normalize(),
  });
  scene.background = env.background;
  scene.environment = env.environment;
  scene.environmentIntensity = 0.45;

  const sun = new THREE.DirectionalLight(o.sunColor, 4.2);
  sun.position.copy(sunDir).multiplyScalar(30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 1, far: 70 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.05;                  // curved hard-surface hulls acne without it
  sun.shadow.radius = 2;
  // We decide when the shadow map refreshes. NOTE the flag is per LIGHT: with
  // shadow.autoUpdate=false, renderer.shadowMap.needsUpdate does nothing — the map is never
  // drawn, and sampling the uninitialised map blanks every receiving mesh (no error logged).
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun, sun.target);

  const stars = createStars();
  scene.add(stars);
  const planet = createPlanet({ radius: o.planet.radius, sunDir, sunColor: o.sunColor });
  planet.position.copy(o.planet.position);
  planet.rotation.set(0.35, 0.8, 0.12);
  scene.add(planet);

  // ---------------------------------------------------------------- post chain
  const governor = createQualityGovernor({
    initial: o.quality === "auto" ? initialTier() : ["eco", "balanced", "high"].indexOf(o.quality),
    locked: o.quality !== "auto",
    onChange: (t) => applyTier(t),
  });
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(NAN_SCRUB));   // must precede bloom — see post.js
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.22, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());            // tone mapping + sRGB happen here
  const finish = new ShaderPass(FINISH);
  composer.addPass(finish);

  // ---------------------------------------------------------------- model
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(o.model, (e) => e.total && o.onProgress(e.loaded / e.total));
  const model = gltf.scene;

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = o.fitSize / maxDim;
  model.scale.setScalar(scale);
  model.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-scale));
  scene.add(model);
  // procedural detail scales with the model (in model units = Blender metres)
  patchUniforms.uPanel.value = options.panelSize ?? maxDim / 60;
  patchUniforms.uWinCell.value = options.roomSize ?? maxDim / 60;
  patchUniforms.uCell.value = options.cellSize ?? maxDim / 150;

  // animated nodes: JS rotors + every node an exported clip targets
  const pivots = [];
  model.traverse((n) => o.spin && o.spin.match.test(n.name) && pivots.push(n));
  const animatedNodes = new Set(pivots);
  const mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) {
    mixer.clipAction(clip).play();
    for (const t of clip.tracks) {
      const node = model.getObjectByName(PropertyBinding.parseTrackName(t.name).nodeName);
      if (node) animatedNodes.add(node);
    }
  }

  const batching = staticBatch(model, { animatedNodes: [...animatedNodes], cellSize: o.fitSize / 3 });
  const materials = applyPatches(model, o.patches);

  // one traverse of per-object polish
  model.traverse((n) => {
    if (!n.isMesh) return;
    const m = n.material;
    const glassy = m.transparent || m.transmission > 0;
    n.castShadow = !glassy;
    n.receiveShadow = !glassy;
    if (glassy) n.renderOrder = 2;
  });
  const strobes = [];
  for (const m of materials) {
    const rule = o.strobes.find((r) => r.match.test(m.name));
    if (rule) strobes.push({ m, base: m.emissiveIntensity, rule, phase: /Green/.test(m.name) ? 1.3 : 0 });
  }

  // ---------------------------------------------------------------- controls
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = o.fitSize * 0.35;
  controls.maxDistance = o.fitSize * 4;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  let idleTimer;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idleTimer); });
  controls.addEventListener("end", () => {
    idleTimer = setTimeout(() => (controls.autoRotate = !reducedMotion), 7000);
  });

  // ---------------------------------------------------------------- sizing + tiers
  let tierSettings = governor.settings;
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const pr = Math.min(window.devicePixelRatio, tierSettings.pixelRatio);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
    bloom.resolution.set(w * pr * 0.5, h * pr * 0.5); // half-res bloom: invisible difference, 4x cheaper
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    stars.material.uniforms.uPixelRatio.value = pr;
  }
  function applyTier(t) {
    tierSettings = t;
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
      if (rt.samples !== t.msaa) { rt.samples = t.msaa; rt.dispose(); } // realloc on next use
    }
    bloom.enabled = t.bloom;
    sun.castShadow = t.shadows;
    sun.shadow.needsUpdate = true;
    resize();
    governor.reset();
  }
  new ResizeObserver(resize).observe(canvas);
  applyTier(governor.settings);

  // Compile every program before the first visible frame — no shader hitch on reveal.
  await renderer.compileAsync(scene, camera);

  // ---------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  timer.connect(document);                       // pauses cleanly on hidden tabs
  let visible = true, running = true, frame = 0, elapsed = 0, lastNow = 0, revealT = 0;
  const introFrom = o.cameraStart.clone().multiplyScalar(reducedMotion ? 1 : 1.9);
  const introTo = o.cameraStart.clone();
  const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
  io.observe(canvas);

  const statsAcc = { frames: 0, t: 0 };
  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    if (!visible || document.hidden) { lastNow = 0; return; } // offscreen: spend nothing
    const interval = lastNow ? now - lastNow : 0;
    lastNow = now;
    governor.sample(interval);
    render(now);
    statsAcc.frames++;
    statsAcc.t += interval;
    if (statsAcc.t > 500) {
      o.onStats({
        fps: Math.round((statsAcc.frames * 1000) / statsAcc.t),
        calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        tier: tierSettings.name, batching,
      });
      statsAcc.frames = 0; statsAcc.t = 0;
    }
  }

  function render(now, fixedDt) {
    timer.update(now);
    const dt = fixedDt ?? Math.min(timer.getDelta(), 0.1);
    elapsed += dt;
    frame++;

    // intro: dolly in + fade from black (shader uniform, no DOM overlay)
    if (revealT < 1) {
      revealT = Math.min(1, revealT + dt / 2.6);
      const e = 1 - Math.pow(1 - revealT, 3);
      if (!reducedMotion) camera.position.lerpVectors(introFrom, introTo, e);
      finish.uniforms.uFade.value = 1 - Math.min(1, revealT * 1.8);
    }

    pivots.forEach((p, i) => (p.rotation[o.spin.axis] += dt * o.spin.speed * (i % 2 ? -1 : 1)));
    mixer.update(dt);
    for (const s of strobes) {
      const t = elapsed + s.phase;
      let k = 1;
      if (s.rule.mode === "nav") { const c = t % 2.6; k = c < 0.09 || (c > 0.27 && c < 0.36) ? s.rule.boost : 0.15; }
      else if (s.rule.mode === "pulse") k = 0.2 + (s.rule.boost - 0.2) * Math.exp(-((t % 3.4) * 7));
      else k = 1 + (s.rule.boost - 1) * Math.sin(t * 1.7);
      s.m.emissiveIntensity = s.base * k;
    }
    patchUniforms.uTime.value = elapsed;
    stars.material.uniforms.uTime.value = elapsed;
    planet.userData.uniforms.uTime.value = elapsed;
    planet.rotation.y += dt * 0.004;
    finish.uniforms.uTime.value = elapsed;

    // moving parts cast moving shadows; on lower tiers refresh the map every other frame
    if (sun.castShadow) sun.shadow.needsUpdate = tierSettings.msaa >= 4 || frame % 2 === 0;

    controls.update(dt);
    renderer.info.reset();
    composer.render(dt);
  }
  requestAnimationFrame(tick);

  const api = {
    renderer, scene, camera, composer, controls, model, governor, batching,
    /** Drive N frames synchronously — works even when rAF is throttled (occluded window).
     *  Fixed dt: a document-connected THREE.Timer reports 0 delta while the page is hidden. */
    frame(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) render(performance.now(), dt); },
    setQuality(name) { applyTier(TIERS[["eco", "balanced", "high"].indexOf(name)]); },
    dispose() {
      running = false;
      io.disconnect();
      controls.dispose();
      timer.dispose();
      composer.dispose();
      env.dispose();
      draco.dispose();
      ktx2.dispose();
      scene.traverse((n) => { n.geometry?.dispose(); (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m?.dispose()); });
      renderer.dispose();
    },
  };
  if (o.debug) window.__viewer = api;
  return api;
}
