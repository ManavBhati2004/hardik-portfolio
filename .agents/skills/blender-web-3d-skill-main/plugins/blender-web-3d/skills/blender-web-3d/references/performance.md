# Performance playbook

Levers in order of payoff. Measure before and after each one (`?stats` in the template,
or `renderer.info.render` with `info.autoReset = false` + a manual `info.reset()` per
frame, so every composer pass counts rather than just the last one).

## 1. Draw calls (the #1 lever)

- **Blender-side consolidation first**: one object per (material, animation root).
  The demo station builds that way from the start: 25 objects for the whole model.
  For existing models use the merge pass in `blender-scripting.md` (Aurora: 4,825 →
  ~1,180 nodes).
- **Runtime static batching second** (`assets/viewer/src/batching.js`): merge static
  meshes by (nearest animated ancestor, material, attribute layout, spatial cell).
  Aurora v028 in the template: **2,091 → 330 static meshes**. Rules:
  - the merge root is the NEAREST animated ancestor. Merging into an outer root
    freezes parts at rest pose while their parent moves;
  - "animated" = JS-driven pivots + every node an `AnimationClip` track targets
    (`PropertyBinding.parseTrackName(track.name).nodeName`);
  - skip transparent/transmissive (need sorting), skinned, morph, instanced;
  - **dequantize before `applyMatrix4`**: meshopt geometry is normalized Int16;
    transforming it in place truncates to integers. Use `getX/getY/getZ` (they
    denormalize), not `getComponent` (it does not);
  - spatial cells (~model size / 3) keep frustum culling useful.
- **Repeated props → `InstancedMesh`** (or `EXT_mesh_gpu_instancing` from
  gltf-transform `instance()`). Near/mid/far LOD pools with asymmetric hysteresis
  distances (Aurora greenhouse: 10/8 and 27/30 units) avoid boundary flicker.

## 2. Asset size and decode time

- **meshopt > Draco for most scenes**: decodes 5-10× faster (off the critical path),
  compresses animation, and gzip/brotli on the CDN squeezes it further. Draco only when
  raw bytes dominate (huge static scans). Demo station: 1.47 MB raw → 332 KB meshopt.
- Textures: WebP for colour (smallest download), **KTX2 (ETC1S colour / UASTC normals)
  when VRAM matters**. WebP decodes to full RGBA8 in VRAM, while KTX2 stays GPU-compressed
  (4-8× less). Needs the `ktx` CLI (KTX-Software) and `npx @gltf-transform/cli etc1s|uastc`.
- `<link rel="preload" href="/models/x.glb" as="fetch" crossorigin>` lets the model
  download in parallel with the JS bundle. It's the biggest time-to-first-frame win.
- Put three in its own chunk (long cache): Vite 8 needs `manualChunks` as a FUNCTION.

## 3. Frame cost

- **Adaptive quality** (`quality.js`): Eco / Balanced / High tiers control pixel ratio
  (0.85 / 1.15 / 1.75), MSAA samples (0 / 2 / 4), bloom and shadows. Downgrade
  immediately when p75 frame time > 23 ms over a 90-frame window. Upgrade only after
  5 consecutive healthy windows (p75 < 18 ms). Symmetric thresholds flap, and the
  resolution change itself causes the next stutter. Start mobile/≤4-core at Balanced.
- MSAA on the composer's HalfFloat target (`samples`) instead of `antialias: true`
  on the canvas, which is wasted when a composer is in use. To change samples: set
  `rt.samples = n; rt.dispose()` on both composer targets. They reallocate on next use.
- **Half-resolution bloom**: `bloom.resolution.set(w*pr*0.5, h*pr*0.5)`. It looks the
  same and costs about a quarter.
- **Shadow map on demand**: `light.shadow.autoUpdate = false` and set
  `light.shadow.needsUpdate` per frame (every frame on High, every other on lower tiers).
  ⚠ The flag is per LIGHT. `renderer.shadowMap.needsUpdate` does nothing once
  `shadow.autoUpdate` is false: the map is never drawn, and receivers sample
  uninitialised memory. Symptom: **the whole model silently disappears** while
  draw-call counts look normal.
- Bake the sky into a cubemap once rather than running fbm per pixel per frame.
- `await renderer.compileAsync(scene, camera)` before the reveal. It removes the
  first-frame shader-compile hitch (dozens of ms with patched materials).
- Pause completely when the tab is hidden **or the canvas is offscreen**
  (IntersectionObserver). A marketing page scrolled past should cost 0%.
- `preserveDrawingBuffer: true` only in debug/QA builds. It costs a copy per frame.

## Measured reference points

| Scene | Calls (all passes) | Triangles (all passes) | Notes |
|---|---:|---:|---|
| Demo station, High | 69 | 91 k | 25 objects, 332 KB GLB |
| Aurora v028 in template, High | 1,074 | 7.2 M | shadows + MSAA 4 |
| Aurora v028 in template, Eco | 738 | 4.9 M | no shadow pass |
| Aurora app v027 → v028 | 4,460 → 1,288 | 3.96 M → 2.79 M | p50 32.6 → 16.7 ms |

All local single-machine samples (Apple Silicon); treat as ratios, not guarantees.
