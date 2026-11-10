---
name: blender-web-3d
description: Work with Blender from Claude — headless CLI or the Blender MCP — to build, modify, render, and publish any 3D model as a stunning, fast Three.js/Next.js web experience (gltf-transform meshopt/KTX2, AgX colour pipeline, custom GLSL shaders and material patches, procedural sky/planet, bloom, adaptive quality, runtime batching, baked lightmaps, Vercel deploy). Use whenever the user wants to create, improve, fix, render, or iterate on a Blender model or scene — "improve the model", "make it look stunning", "render this", "make a 3D web demo", "export to GLB", "use blender", "looks wrong in the browser", "optimize the 3D scene", "add shaders", "it's slow", or screenshot-driven feedback on a 3D asset. Also for debugging a Three.js viewer that renders black, glows wrong, or loses/detaches parts, and for choosing Blender MCP vs headless CLI. Ships a runnable demo model and viewer template.
license: MIT
compatibility: Requires Blender 4.x/5.x on PATH (5.x API notes included). Node.js 20+ for the viewer template and gltf-transform. Optional BlenderMCP addon + uvx blender-mcp for live GUI sessions; optional KTX-Software for KTX2 textures.
metadata:
  author: czlonkowski
  version: "2.0"
---

# Blender → Web 3D publishing pipeline

Build detailed 3D models with scripted, reproducible Blender edits, optimise them into
small GLBs, and serve them in a Three.js viewer that looks like a beauty render and
holds 60 fps. The whole loop runs headless, so every change is a reviewable script,
every state is a versioned file, and every result is verified by looking at pictures.

## Start from the assets, not from scratch

```
assets/
├── blender/
│   ├── demo_station.py     # complete procedural reference model (all modelling patterns)
│   ├── render_beauty.py    # EEVEE/Cycles rig: AgX, compositor bloom, planet, 3 framed views
│   └── export_glb.py       # scoped raw GLB export (root hierarchy only, no compression)
└── viewer/                 # Vite + three r186 template — `npm i && npm run dev`
    ├── scripts/optimize-glb.mjs   # raw -> runtime GLB (dedup, instance, meshopt, webp)
    └── src/
        ├── viewer.js       # createViewer(): renderer, env, post, load, animate, loop
        ├── quality.js      # adaptive tiers with asymmetric hysteresis
        ├── batching.js     # runtime static batching (animation-safe, dequantizing)
        └── shaders/        # space.js (sky/IBL/stars/planet), patches.js (hull/windows/
                            # solar), post.js (NaN-scrub, film finish), noise.glsl.js
```

For a new project: copy `assets/viewer` into the app, then point `model` at your GLB and
set the name-keyed options (`spin`, `patches`, `strobes`). The template ran the Aurora
GLB unmodified. Name Blender materials and pivots deliberately, because **names are
the contract between the model and the viewer** (`Hull*` gets plating, `Window_*`
living windows, `*Solar*` cells, `Beacon_Red/Green` nav strobes, `*_Pivot*` spins).

## Two ways to drive Blender: MCP vs headless CLI

- **Headless CLI** (`blender --background file.blend --python script.py -- args`):
  the default. Reproducible, versionable, no GUI, works in CI.
- **Blender MCP** (community BlenderMCP addon + `uvx blender-mcp`): socket server
  only inside a live GUI session (sidebar → "Connect to MCP server"). It's inert in
  `--background`. Use it when the user is watching the viewport and wants live iteration.
- Write scripts that work in both: guard on `bpy.data.filepath`, avoid operators
  needing a 3D-view context (`bpy.data.meshes.new_from_object(obj.evaluated_get(dg))`),
  and stay idempotent.

## The iteration loop (one model change, end to end)

1. **Copy forward**: `cp <prev>.blend <next>.blend`. Never edit a previous version.
2. **Write a versioned edit script** (managed-script pattern) → read
   `references/blender-scripting.md` first (it includes the Blender 5.x API table).
3. **Run headless**. The script validates itself, saves, and prints one JSON report.
4. **Verify with renders**: `render_beauty.py --engine EEVEE --samples 32` (seconds),
   2-3 views. Look at the PNGs. Geometry bugs are obvious in pictures and
   invisible in logs.
5. **Export raw** (`export_glb.py`) → **optimize** (`optimize-glb.mjs`) →
   `references/export-pipeline.md`. Read its trap list: `flatten`/`palette` silently
   break JS pivots and material names.
6. **Wire the app**: versioned GLB in `public/models/`, bump the path + preload link.
7. **Verify in the browser by pixels, not by vibes**: `?debug` exposes
   `window.__viewer`. Drive frames with `__viewer.frame(n)` and capture
   `canvas.toDataURL()`, which works even when the pane is hidden (see threejs-viewer.md).
   Check a hero view AND a close-up. Close-ups expose shader and shadow bugs that
   wide shots hide.
8. **Beauty render** for docs/marketing: `render_beauty.py --engine CYCLES`, then deploy
   (`npx vercel deploy --prod --yes`; hand the command to the user if blocked).

## Reference files — read before the relevant phase

- `references/blender-scripting.md`: managed-script pattern, Blender 5.x API
  changes, bmesh construction, verification/beauty renders, BVH orphan cleanup,
  draw-call consolidation with the animated-ancestor rule.
- `references/export-pipeline.md`: raw export + gltf-transform optimisation, the
  flatten/palette/instance/quantization traps, what needs baking.
- `references/lookdev-and-shaders.md`: **the quality bar**, AgX on both sides, custom
  ShaderMaterial and onBeforeCompile rules, the quantized-geometry trap, procedural
  detail that doesn't alias, and the shader recipes in the template.
- `references/performance.md`: draw calls → runtime batching → meshopt/KTX2 →
  adaptive tiers → shadow-on-demand (and its per-light trap), with measured numbers.
- `references/threejs-viewer.md`: template architecture, NaN-scrub rule, motion,
  occluded-window trap and hidden-pane frame capture, debugging playbook, page craft.
- `references/baked-lighting.md`: Cycles lightmap bakes → filtered RGBE HDR →
  `lightMap` on UV2, per-room reflection probes, GTAO with glass hidden.

## Design lessons that shape stunning results

- **Enclosed volumes beat skeletons.** Thin rods and hoops read as "cage". Structures
  read as solid when they enclose a lit volume: continuous hull bands, glazing with
  chunky mullions, interior light visible through it.
- **Attach everything.** Floating greebles read as bugs. Sweep for orphans after
  removals (BVH proximity).
- **Scale detail to the camera.** Geometry for the silhouette, shader patches for
  the surface. Panel seams, cells and room-lights cost zero bytes and scale to any size.
- **Zone light signatures** (warm habitat, green agriculture, cyan structure) make the
  model legible and give bloom something meaningful. Keep window emission ~3; above ~7
  AgX turns coloured windows into white slabs.
- **One sun** drives the key light, sky disc, IBL warmth and planet terminator.
- **Life at three tempos**: slow rotation, medium strobes, rare flicker.

## When the user reports a visual bug from a screenshot

Locate the object first. Don't guess. Headless probe scripts that dump object names,
world bounds, radii, and angular positions (grouped by name pattern) identify what the
user photographed in one run. Fix by script, re-render the same view, and compare. In the
browser, bisect by toggling scene features (background, environment, light, shadows)
and reading pixels. Render the model alone in a fresh Scene to separate geometry
bugs from scene-state bugs.
