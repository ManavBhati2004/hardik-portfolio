# The Three.js viewer

**Start from the template**: `assets/viewer/` is a working Vite + three r186 project.
`createViewer(canvas, options)` in `src/viewer.js` owns renderer, scene, post chain,
model, animation and loop, and returns a `dispose()`. It's framework-agnostic:

```tsx
// Next.js client component
useEffect(() => {
  let v: Awaited<ReturnType<typeof createViewer>> | undefined;
  createViewer(canvasRef.current!, { model: "/models/model-v007.glb" }).then((x) => (v = x));
  return () => v?.dispose();
}, []);
```

Copy `src/` and `scripts/` into the app. Everything model-specific is an option:
`spin` (pivot name regex + axis), `patches` (material-name → shader patch), `strobes`
(material-name → nav/pulse/breathe), `sunDir`, `planet`, `fitSize`, `panelSize`/`roomSize`/
`cellSize`, `quality`. It ran Aurora v028 unmodified: it found the `*_Pivot*` rings,
patched the materials, and batched 2,091 → 330 meshes.

## Pipeline order inside createViewer

1. Renderer: `antialias: false` (MSAA is on the composer target), AgX, sRGB,
   `info.autoReset = false`, `preserveDrawingBuffer` only when `debug`.
2. Environment: bake sky → cubemap + PMREM **before** loading the model (see
   lookdev-and-shaders.md). One DirectionalLight with manual shadow updates.
3. Composer: `RenderPass → NaN-scrub → UnrealBloom (half-res) → OutputPass → Finish`.
4. Load GLB with Draco + KTX2 + meshopt all registered, so any codec works.
5. Fit the model to `fitSize` units (Blender stays 1 unit = 1 m; scale only in the app).
6. Collect animated nodes (pivots + clip targets) → static batching → shader patches →
   per-object polish (shadows off for glass, renderOrder) → strobe list.
7. `await renderer.compileAsync(scene, camera)` → reveal (camera dolly + `uFade`).

## Postprocessing: the NaN-scrub rule

`RenderPass → NaN-scrub ShaderPass → UnrealBloomPass → OutputPass`. The scrub is **not
optional**. Some light/material combinations emit isolated NaN fragments on Apple GPUs,
and bloom's separable blur smears a single NaN over the whole frame (black screen).
Without a composer, LDR output clamps it away, which is why it ambushes you the day
bloom goes in.

```glsl
vec4 c = texture2D(tDiffuse, vUv);
if (c.r != c.r || c.g != c.g || c.b != c.b || c.a != c.a) c = vec4(0.,0.,0.,1.);
gl_FragColor = clamp(c, vec4(0.), vec4(1000.));
```

Anything display-referred (grain, vignette, SMAA, CA) goes AFTER OutputPass.

## Motion

- JS-driven pivots: `rotation[axis] += dt * speed`, alternating sign for
  counter-rotating pairs. Exported actions: `AnimationMixer`, play every clip.
- Strobes on SHARED materials (a handful of uniform writes per frame): aircraft
  double-flash `c = t % 2.6; on = c < .09 || (.27 < c && c < .36)`, docking pulse
  `exp(-(t % 3.4) * 7)`, engine breathing `sin`. Snapshot the base
  `emissiveIntensity` first.
- OrbitControls with damping, slow autoRotate that stops on interaction and resumes
  after ~7 s idle. `prefers-reduced-motion` disables autoRotate and the intro dolly.

## The occluded-window trap (read before debugging "black canvas")

When the window or pane is hidden, `document.visibilityState === "hidden"`,
**requestAnimationFrame never fires**, and a document-connected `THREE.Timer` reports
**0 delta**. Screenshots of a hidden page show the last *presented* frame, which is black
or stale, even when rendering works. No errors anywhere. Check `visibilityState` FIRST.

The template's debug hook (`?debug` → `window.__viewer`):

```js
__viewer.frame(200);       // drive 200 frames synchronously with a FIXED dt (1/60)
```

Fixed dt is required: with Timer delta at 0, intro fades and animations never advance
and you'd capture a black frame again.

**Capturing frames from a hidden browser** (agent QA loop): with `preserveDrawingBuffer`
on (debug mode), `canvas.toDataURL("image/jpeg")` right after `frame(n)` returns the real
pixels. POST that to a tiny local Node server that writes the file, then look at the
JPEG. Pixel checks work too: `gl.readPixels` in the same task, or
`renderer.readRenderTargetPixels` on the composer's HalfFloat target to scan for NaN
(`(v & 0x7C00) === 0x7C00 && (v & 0x03FF) !== 0`).

## Debugging playbook

- **Model missing, draw calls normal** → bisect by removing scene features:
  background, environment, the light, `castShadow`. (Real case: a shadow map that was
  never drawn, see performance.md.) Render the model alone in a fresh `Scene` to prove
  the geometry is fine.
- **Black frame only with bloom** → NaN. Scan the HDR target, bisect lights /
  shadowMap. The scrub protects you regardless.
- **Shader patch compiles but shows nothing** → quantized positions; detail sized in
  metres is being evaluated in [-1, 1] space (lookdev-and-shaders.md).
- **A part floats detached while another moves** → it lost its animated parent (bad
  merge, `flatten()`, or batching into the wrong root). Check
  `getObjectByName(<animated node>).children`.
- **Invisible mesh** → inverted normals under backface culling, or all-black material
  with no env intensity.
- **Glass invisible** → alpha < 0.3 or missing BLENDED/transparent.
- **Dev server won't start from a sandboxed launcher** ("getcwd: Operation not
  permitted" under ~/Documents) → start Vite from the shell and point the browser at it.

## Page craft

- Loader: thin progress bar fed by `loadAsync(url, onProgress)`. It fades out, then the
  canvas fades in from black via the finish pass (no layout flash).
- HUD as fixed DOM over the canvas, with glass panels (`backdrop-filter: blur`) and
  mono telemetry (`S` toggles FPS / calls / triangles / tier). Brand block and hints fade
  in after the reveal. 16 px gutters on phones, and hide hints under 640 px.
- `canvas` gets `touch-action: none` and an `aria-label` describing the controls.
- Lead-gen overlay (when the demo is marketing): logo + one-line descriptor + CTA with
  UTM params, outside any hideable HUD state. Pull exact brand hexes from the brand's
  own repo.
