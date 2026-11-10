# Baked lighting for the web (lightmaps)

Real-time lights can't give you bounce light, soft area shadows or colour bleeding
at 60 fps. Interiors, enclosed spaces and hero close-ups need it baked. Proven on
Aurora v032-v033 (interior rooms). Skip it for exteriors lit by one sun, where IBL plus
a shadowed directional light is enough.

## Blender: bake

- Per-room **isolated lighting scenes** beat one master rig: each room gets its own
  world (low-strength coloured background as bounce fill) plus curated AREA lights
  (e.g. warm grow strips 125 W, blue-white "earthlight" 3,400 W).
- Dedicated UV layer (`BakeUV`, becomes glTF TEXCOORD_1):
  `bpy.ops.uv.smart_project(angle_limit=1.2, island_margin=0.0006)`.
- Cycles bake: `type="DIFFUSE"`, `use_pass_direct = use_pass_indirect = True`,
  `use_pass_color = False` (lighting only — albedo stays in the material),
  ~64 samples, `bake.margin = 3`, 2048² float atlas per room.

## Encode: keep it HDR

- **Don't carry RGB lighting in the glTF occlusion slot.** It's a single-channel
  concept, the image passes through 8-bit caches, and three maps it to `aoMap`. Aurora
  v032 did this and hit stale packed data. v033 moved to dedicated HDR files.
- Normalise each atlas to ≤ 1.0 for any LDR preview, and store the scale as a node
  extra (`lightMapScale`) so the runtime can undo it.
- Filter the float bake before encoding: 3×3 **median** (kills Monte-Carlo fireflies),
  then 3×3 Gaussian (smooth irradiance). Keep both kernels inside the bake margin.
- Write Radiance RGBE `.hdr` (small, lossless enough for irradiance). Aurora's
  `encode-lightmaps-v033.mjs` does PNG16 → filter → RGBE with RLE in ~50 lines,
  with no native dependencies.

## Three.js: apply

```js
const lm = await new HDRLoader().loadAsync(`/lightmaps/${room}.hdr`); // RGBELoader was renamed
lm.channel = 1;          // second UV set (TEXCOORD_1)
lm.flipY = false;        // glTF convention; async HDR loads otherwise arrive flipped
for (const m of roomMaterials) {
  m.lightMap = lm;
  m.lightMapIntensity = Math.PI * node.userData.lightMapScale; // undo normalisation
}
```

- Per-room **reflection probes**: render an equirect EXR panorama per room in
  Blender, PMREM it on the client, and assign it as that room's materials' `envMap`
  (glass ~0.12, foliage ~0.85, rest ~0.3). This stops one global space environment from
  leaking starlight into interiors.
- GTAO for contact shadows on top of lightmaps: subclass `GTAOPass`, render at 0.55×
  resolution, and **hide glass meshes during the AO prepass** or transmissive panes
  occlude like walls.
- Interior camera on its own layer (`camera.layers.set(2)`, `near = 0.0005`) so the
  exterior hull never intersects the interior frustum.

Three bugs found only in browser QA on v033: stale occlusion data, async HDR
vertical flip, and the irradiance normalisation factor. Verify lightmaps by pixel
inspection in the browser, not just in Blender.
