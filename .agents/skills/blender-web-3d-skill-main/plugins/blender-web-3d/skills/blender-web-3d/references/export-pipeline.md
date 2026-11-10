# Exporting Blender scenes to web-ready GLB

Two stages, two tools. Blender exports an uncompressed **raw GLB** (an archive of
exactly what Blender produced), and gltf-transform turns it into the **runtime GLB** in
one reproducible, measured step. Keep versioned path constants and refuse to
overwrite previous versions.

```bash
blender --background model-v007.blend --python assets/blender/export_glb.py -- \
  --root Station --out build/model-raw-v007.glb
node scripts/optimize-glb.mjs build/model-raw-v007.glb public/models/model-v007.glb
```

## Stage 1 — raw export (`assets/blender/export_glb.py`)

Scope the export by selecting one root object's hierarchy. Never export the whole scene,
or lights, cameras, render-only dressing and helper junk leak in. Key settings:

```python
bpy.ops.export_scene.gltf(
    filepath=..., export_format="GLB", use_selection=True,
    export_apply=True,                      # bake modifiers (bevel / weighted normal)
    export_animations=True, export_nla_strips=True, export_optimize_animation_size=True,
    export_cameras=False, export_lights=False, export_extras=True,
    export_gpu_instances=True,              # linked duplicates -> EXT_mesh_gpu_instancing
    export_image_format="AUTO",             # lossless here; compress in stage 2
    export_draco_mesh_compression_enable=False)
```

Blender 5.x can also meshopt-compress natively (`export_meshopt_compression_enable`),
but doing it in gltf-transform keeps dedup, instancing, texture compression and codec
choice in one measurable place.

## Stage 2 — optimize (`assets/viewer/scripts/optimize-glb.mjs`)

Default chain: `dedup → instance → join(keepNamed) → weld → [simplify] → resample →
prune(keepLeaves) → sparse → textureCompress(webp) → meshopt`. It prints nodes,
meshes, vertices and KB before and after. Flags: `--draco`, `--simplify <ratio>`, `--tex <px>`,
`--palette`, `--flatten`.

**Traps that silently break the viewer** (each found the hard way):

- **`flatten()` kills JS-driven pivots.** It re-parents every mesh that isn't under
  a glTF *animation* to the root, including meshes under pivots you rotate from
  JavaScript (rings, rotors, turntables). `prune()` then deletes the empty pivot and
  the part stops moving, with no error. That's why flatten is opt-in and prune runs
  with `keepLeaves: true`.
- **`palette()` merges materials** into one palette-textured material, so the material
  NAMES your viewer keys strobes and shader patches on are gone. Opt-in only.
- **`instance()` is skipped entirely when the file has any animation.** Author
  repeated props as Blender linked duplicates + `export_gpu_instances` instead, or
  instance at runtime.
- **meshopt quantizes positions** (`KHR_mesh_quantization`): runtime geometry is
  normalized Int16 with the scale in the node matrix. Any code that transforms geometry
  or computes object-space detail must account for it (see performance.md and
  lookdev-and-shaders.md).
- Demo station: 1,470 KB raw → **332 KB** runtime (4.4×), all 29 nodes preserved.

Legacy one-step path (still valid for texture-heavy, static models): Blender-native
Draco + WebP (`export_draco_mesh_compression_enable=True`, level 6, position/normal/
texcoord quantization 14/10/12, `export_image_format="WEBP"`, quality 90).

## What needs baking, what doesn't

- **Procedural node materials** (noise, brick, colour ramps): bake once to
  basecolor/ORM/normal textures (Cycles EMIT bakes per channel), rebuild as
  image-textured Principled materials, reassign. Later versions reuse the baked set.
  Often you can instead name the material and add the detail at runtime with a shader
  patch (lookdev-and-shaders.md), which is zero bytes and resolution-independent.
- **Constant Principled materials** export natively. New geometry needs zero work.
- **Glass**: Transmission Weight + IOR → KHR_materials_transmission/ior; alpha +
  BLENDED → alpha BLEND.
- **Emission**: Emission Color/Strength → KHR_materials_emissive_strength ✓.
- **Lighting** (bounce, soft shadows) for interiors → `baked-lighting.md`.

## Export gotchas

- **Drivers don't export.** Keep a named pivot Empty (`*_Pivot*`) and re-drive the
  rotation in JS. Keyframed **actions** DO export. Play them via `AnimationMixer`.
- **Collection instances export as expanded node trees**, so draw calls multiply by
  instance count even though the file stays small. Consolidate the source collection first.
- **Normal Map chained through a Bump node** is unsupported: in WebP mode it produces
  a texture entry without a source and GLTFLoader refuses the whole file. Rewire the
  normal map directly for export, then restore it.
- Meshes with image-textured materials but **no UV layer** export broken UVs. Give
  them a deterministic box-projected UV0 first.

## Wiring into the app

- Runtime GLB → `public/models/<name>-vNNN.glb` (keep old versions for instant
  rollback), bump the path, and add a matching `<link rel="preload">`.
- Decoders: the template's `postinstall` copies three's Draco + Basis decoders into
  `public/draco` and `public/basis`. The meshopt decoder is an ES import.
- Deploy: `npx vercel deploy --prod --yes` from the app directory. Session permission
  classifiers may block deploys, in which case hand the exact command to the user.
