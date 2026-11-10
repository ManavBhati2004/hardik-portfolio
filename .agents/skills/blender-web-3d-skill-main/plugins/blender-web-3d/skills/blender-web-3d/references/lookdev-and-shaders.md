# Look-dev and custom shaders

What separates "okay" from "stunning" is rarely polygon count. It comes from light
that makes sense, a colour pipeline that matches between Blender and the browser, and
cheap procedural detail at the scale the camera actually sees. Everything here is
implemented in `assets/viewer/src/` — copy it rather than re-deriving it.

## The quality bar (check every deliverable against it)

1. **One sun, everywhere.** Key light direction, the sky's sun disc, the environment's
   warm side, and any planet terminator all use the SAME vector. Mismatched suns read as
   "fake" instantly, even to people who can't say why.
2. **AgX on both sides.** Blender `view_transform = "AgX"` (look "AgX - Punchy" for
   beauty renders) ↔ `renderer.toneMapping = THREE.AgXToneMapping`. Then a Cycles render
   and a browser frame of the same model look like the same object.
3. **Bloom only on real lights.** Threshold above the brightest sun-lit hull value
   (~1.1-1.2 in linear HDR with a 4 lux-ish key). Strength 0.25-0.35, radius ~0.2.
   A wide radius makes a hazy green/orange fog of the whole frame — the most common
   "looks amateur" failure.
4. **Contrast from environment ratio, not from exposure.** `environmentIntensity`
   ~0.4-0.5 against a key of ~4 gives readable shadow sides without flattening. At
   0.85 everything looks evenly grey and CG.
5. **Zone light signatures.** Give each functional area its own emissive colour
   (warm habitat, green agriculture, cyan structure). It makes the model legible at a
   glance and gives bloom something meaningful to do.
6. **Life at 3 frequencies.** Slow (rotating rings, ~0.07 rad/s), medium (beacon
   strobes 2-4 s), fast-but-rare (a window flickers). Stillness reads as a screenshot.
7. **Detail that fades before it aliases.** Procedural panels/cells use `fwidth`
   and fade out below ~3 px per feature (see `gridLines` in `patches.js`).
8. **A finish pass.** Subtle vignette + radial chromatic aberration + animated grain
   (display-referred, after OutputPass). The grain also dithers away the 8-bit banding
   that dark gradient skies otherwise show.

## Custom-shader rules (three.js r18x)

- **Raw `ShaderMaterial` must end with**
  `#include <tonemapping_fragment>` and `#include <colorspace_fragment>`. Then it
  respects the renderer's AgX + sRGB whether it renders straight to the screen or into a
  composer target, where three disables tone mapping automatically and OutputPass applies it.
- **Patch, don't replace, PBR materials**: `material.onBeforeCompile` + string-replace
  after a chunk (`#include <color_fragment>`, `<roughnessmap_fragment>`,
  `<emissivemap_fragment>`). You keep IBL, shadows and every glTF feature for free.
  Set `material.customProgramCacheKey = () => "patch:<kind>"` so all materials of that
  kind share ONE compiled program.
- **Quantized geometry trap** (meshopt / `KHR_mesh_quantization`): `position` is a
  normalized Int16 in [-1, 1] and the metres live in the node matrix. Object-space
  procedural detail sized in metres then covers the whole mesh: "the patch compiles
  but nothing shows". Compute detail in parent space instead:
  `vObjPos = (uLocal * vec4(transformed, 1.0)).xyz` with `uLocal = mesh.matrix`. That
  matrix is static (pivots rotate, not meshes), so clone the patched material per mesh
  with a constant uniform. The program stays shared and the cost is a few uniforms.
  (`material.uniformsNeedUpdate` only works on ShaderMaterial, so don't rely on
  per-draw uniform updates for standard materials.)
- **Don't compute detail in world space** on moving parts: it swims across the surface
  as the part rotates.
- **Anti-aliased procedural lines**:
  ```glsl
  float gridLines(vec2 g, float width) {         // 1 on the seam, 0 inside the panel
    vec2 f = abs(fract(g) - 0.5);                  // 0 at centre -> 0.5 at edge
    vec2 aa = fwidth(g) * 1.5;
    vec2 l = smoothstep(vec2(0.5 - width) - aa, vec2(0.5 - width), f);
    return max(l.x, l.y) * (1.0 - smoothstep(0.12, 0.35, max(aa.x, aa.y)));
  }
  ```
  If you get the smoothstep backwards, you get bright dashes and darkened panels. Look
  at a close-up render before you tune the numbers.
- **Dominant-axis projection** (`projUV` in `patches.js`) beats blended triplanar for
  hard-surface plating. It's cheaper, and the seams land on panel lines anyway.
- **Hash, not texture, for variation**: per-panel tint/roughness, per-room window
  occupancy, rare flicker — `hash(floor(cellCoord))`. Zero bytes shipped.
- **Upgrade materials in JS when glTF can't express the look**: e.g. solar panels →
  `MeshPhysicalMaterial` with `iridescence` 0.55 + clearcoat (thin-film sheen).

## Recipes in the template

| Effect | File | Idea |
|---|---|---|
| Nebula sky + sun disc | `space.js` `SKY_FRAG` | fbm band on a tilted great circle + dust lanes; baked ONCE into a 512² HalfFloat cubemap (`CubeCamera`) used as `scene.background` |
| Matching IBL | `space.js` `buildSpaceEnvironment` | PMREM from sky + a blue "planet-shine" card + a cool rim card. Reflections match the backdrop and no HDRI ships |
| Twinkling stars | `space.js` `createStars` | `Points`, magnitude `rnd^9`, colour temperature table, band-concentrated, `gl_Position.z = gl_Position.w` (pinned to far plane: never occludes, never clipped) |
| Planet | `space.js` `createPlanet` | fbm continents, clouds, ocean glint, night-side city lights, Fresnel limb, warm terminator band; back-face additive halo shell |
| Hull plating | `patches.js` `panels` | long offset plates, per-plate tint/roughness, 7% "replacement" plates |
| Living windows | `patches.js` `windows` | per-room occupancy (84% lit), level, colour temp, rare flicker |
| Solar cells | `patches.js` `cells` | cell grid + iridescent Physical upgrade |
| Film finish | `post.js` `FINISH` | CA ∝ r², vignette, grain, and `uFade` for the intro (no DOM overlay) |

## Blender side of look-dev (5.x)

- Engine ids: `BLENDER_EEVEE` (5.x; 4.2-4.4 used `BLENDER_EEVEE_NEXT`), `CYCLES`.
- Compositor: `scene.node_tree` is gone. Build a node group:
  `ng = bpy.data.node_groups.new("Comp", "CompositorNodeTree")`,
  `ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")`,
  wire into a `NodeGroupOutput`, then `scene.compositing_node_group = ng`.
- Glare node settings are now input sockets (menus): `glare.inputs["Type"].default_value = "Bloom"`.
- `Material.use_nodes` is deprecated (materials always have nodes). Guard with
  `if m.node_tree is None`.
- `mesh.set_sharp_from_angle(angle=radians(35-40))` after `use_smooth=True`: crisp
  hard-surface edges that survive glTF export (no Auto Smooth modifier needed).
- Beauty rig (`assets/blender/render_beauty.py`): warm key sun (angle 0.012), cool fill
  from below (planet-shine), rim sun from behind, voronoi star world, render-only
  planet, compositor Bloom (threshold 1.2) + 0.012 lens dispersion, AgX Punchy.
  `cycles.blur_glossy = 1.0` removes fireflies from small hot emitters.
- Emission strength tuning: ~3 for windows, ~5 for strips, 12+ for point beacons.
  Above ~7, AgX desaturates windows to white slabs and you lose the zone colour.
