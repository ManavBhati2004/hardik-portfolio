# Headless Blender scripting patterns

Blender's CLI (`blender --background file.blend --python script.py`) runs full
Python with `bpy`/`bmesh`. Scripts whose docstrings say "run in the GUI" often
run fine headless, because the guards usually only check `bpy.data.filepath`. Pass script
arguments after `--` and parse `sys.argv[sys.argv.index("--") + 1:]` with argparse.

A complete, runnable reference model lives in `assets/blender/demo_station.py`
(`blender --background --factory-startup --python demo_station.py -- out.blend`,
~1 s, 25 objects, ~33 k tris). Read it before building anything procedural. It
applies every pattern below.

## Blender 5.x API changes that break older scripts

| Was (≤4.x) | Now (5.x) |
|---|---|
| `render.engine = "BLENDER_EEVEE_NEXT"` | `"BLENDER_EEVEE"` |
| `scene.use_nodes` + `scene.node_tree` (compositor) | `scene.compositing_node_group = bpy.data.node_groups.new(..., "CompositorNodeTree")` with a `NodeGroupOutput` |
| Glare node `.glare_type = "BLOOM"` | `glare.inputs["Type"].default_value = "Bloom"` (settings are input sockets) |
| `material.use_nodes = True` | deprecated; materials always have nodes (guard `if m.node_tree is None`) |
| Auto Smooth mesh property | `mesh.set_sharp_from_angle(angle=radians(38))` after `use_smooth = True` |
| glTF export Draco only | also `export_meshopt_compression_enable`, `export_gpu_instances` |

## The managed-script pattern

Every edit script is self-guarding, idempotent, and self-validating. Skeleton:

```python
WORK_BLEND = Path(".../my-model-<change>-vNNN.blend")
VERSION = NNN
MARKER = "myproject_<change>_version"   # scene custom property

def require_working_copy():
    if Path(bpy.data.filepath).resolve() != WORK_BLEND.resolve():
        raise RuntimeError("wrong file")  # never edit the wrong version

def main():
    require_working_copy()
    scene = bpy.context.scene
    if scene.get(MARKER) == VERSION:
        print(json.dumps({"status": "already_applied"})); return
    report = {"status": "applied", "removed": remove_old(), "built": build_new()}
    scene[MARKER] = VERSION
    report["validation"] = validate_scene()   # raise on anything unexpected
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK_BLEND), compress=True)
    print(json.dumps(report, indent=2))
```

Rules that make this safe:
- Tag everything you create: `obj["managed"] = True` (and on materials). Refuse
  to delete or replace anything unmanaged — that guard has caught real mistakes.
- `validate_scene()` asserts object existence, parenting, non-empty meshes, and
  dimension sanity, and returns a dict that lands in the JSON report.
- Print one JSON report to stdout; grep it from the shell to confirm success.
- Remove-then-rebuild beats mutate: delete the previous pass's objects by name
  prefix and rebuild, so re-running after a partial failure is clean.

## Geometry construction with bmesh

Build one `bmesh` per material, then finish into one object per material —
this keeps draw calls low from the start. Useful primitives to write:

- `add_box(bm, origin, axis_x, axis_y, axis_z, half_extents)` — oriented box
  via a basis matrix: `Matrix((x,y,z)).transposed().to_4x4()` + translation,
  then `@= Matrix.Diagonal((*half_extents, 1))`, `bmesh.ops.create_cube`.
- `add_cylinder / add_rod(start, end, radius)` — `bmesh.ops.create_cone` with
  equal radii; build the frame from the axis with a cross-product basis.
- `add_arc_box(x_min, x_max, r_inner, r_outer, angle_start, angle_end, steps)`
  — a closed curved slab swept around an axis; the workhorse for anything
  ring-shaped (hull bands, collars, terraces, light strips).
- Swept-grid surfaces (e.g. a vault glazing): loop stations × arc steps, create
  verts at `profile_radius(x)`, quad faces between rows; smooth-shade it.

**Always finish with** `bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))`
before `to_mesh` — hand-rolled basis matrices easily come out left-handed, and
mirrored cubes have inward normals that vanish under backface culling.

Text labels: build a FONT curve, set body/size/extrude, then convert via
`bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), ...)` — works
headless where operators lacking a 3D-view context fail.

Deterministic "randomness" (planting jitter etc.): hash with
`frac(sin(dot(seeds, weights)) * 43758.5453) * 2 - 1` — re-runs reproduce.

## Materials

Plain Principled BSDF materials (constant values, no textures) need **no
baking** — glTF exports them natively. Set base color, metallic, roughness;
emissive via Emission Color/Strength; glass via Transmission Weight + IOR +
Alpha with `surface_render_method = "BLENDED"`. Give glass presence for web:
alpha ~0.45, slight green/blue emissive tint (strength ~0.2).

## Headless verification renders

`assets/blender/render_beauty.py` is the ready-made rig (EEVEE preview in ~1 s/view or
Cycles beauty, AgX, compositor bloom, render-only planet and stars, 3 framed views,
never saves the .blend). Minimal version:

```python
scene.render.engine = "BLENDER_EEVEE"        # 5.x id; works headless on macOS
# world background near-black, one SUN light (energy ~4.5)
# camera: cam.rotation_euler = (target - loc).to_track_quat("-Z", "Y").to_euler()
# set clip_end generously (20000 for km-scale scenes)
scene.render.filepath = str(out / "check.png"); bpy.ops.render.render(write_still=True)
```

Camera placement at large scale is the usual mistake: for a ~2 km model frame
from 1.5-2× the model's largest dimension away, lens 45-60 mm. Render 2-4
angles; read the PNGs as images and actually look at them. Detail shots need
the same discipline — first attempts almost always land too close; frame a
detail from 2-3× the size of the assembly you want readable.

## High-quality Cycles beauty renders (headless, Metal GPU)

Always set `view_settings.view_transform = "AgX"` (look `"AgX - Punchy"`). The web
viewer uses `AgXToneMapping`, so renders and browser frames match.

```python
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"; prefs.get_devices()
for d in prefs.devices: d.use = True
scene.cycles.device = "GPU"
scene.cycles.samples = 128
scene.cycles.use_adaptive_sampling = True; scene.cycles.adaptive_threshold = 0.015
scene.cycles.use_denoising = True
```

Lighting rig that flatters hardware in space scenes: warm key SUN (energy
~5.5, tight `angle` 0.012 for crisp shadows) + faint cool fill SUN from the
opposite hemisphere (energy ~0.7, wider angle) + near-black world with a hint
of blue. Emissive materials become real light sources in Cycles — lit windows
and grow-lights ground the model for free. Set `cycles.blur_glossy = 1.0` to kill
fireflies from small hot emitters. Background dressing objects
(planets, star cards) that live outside the export root render in Cycles but
never ship in the GLB, so keep them for beauty shots. ~1-2 min/frame at 1920-2200 px
and 128 samples on an M-series GPU (demo station: 1 m 45 s at 1920×1080).

## Probing a scene (before designing a change)

Dump per-object: world bounds (`obj.matrix_world @ Vector(corner)` over
`bound_box`), radius ranges, angular clusters (`atan2(z, y)` bucketed), poly
counts, materials, parents. Collapse numbered duplicates with a regex to see
structure (`_\d+` → `_N`). This turns "improve the ring" into exact radii,
angles, and collision constraints in one run.

## Cleaning up orphaned / floating parts (BVH proximity)

Leftover caps, markers, and rims that lost their parent hardware are found
geometrically, not by name:

1. Build one world-space BVH over every sibling mesh under the assembly root:
   `BVHTree.FromPolygons(verts, polys)` with verts transformed by
   `matrix_world`.
2. Split the suspect object into connected islands (flood-fill over
   `vert.link_edges`).
3. For each island, sample verts and `tree.find_nearest(co, max_dist)`. No
   contact within ~2 m (at metre scale) → orphan.
4. Either delete orphan islands, or **re-seat** whole objects: translate along
   `(nearest_point - centre)` so they touch (small 0.15 embed).

Sanity-guard: abort if the pass would classify *everything* as orphaned.

## Draw-call consolidation (do this once the model is stable)

Collection instances multiply node counts: a 495-object asset instanced 8×
puts ~4 000 mesh nodes in the GLB — that's the web performance killer. Merge
sibling meshes that share `(material, UV-layer signature, animation root)` into
one mesh per group (bmesh append with verts transformed into the target
parent's local space via composed `matrix_local` chains — `matrix_world` can be
stale for objects living only inside instanced collections).

Never merge:
- objects with their own action/NLA tracks, shape keys, or drivers;
- **objects with an ANIMATED ANCESTOR** — walk the parent chain; if any
  ancestor carries an action, the mesh must stay under it or it freezes at
  rest pose while its parent animates (this exact bug produced "detached
  antenna rims": dish rims baked static while gimbals swept);
- meshes with custom split normals (bmesh merge destroys them);
- multi-material objects, instancer empties, or hierarchy anchors with
  children.

Objects blocked only by modifiers can still be merged by baking the evaluated
mesh: `bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), ...)`.
Expect 3-5× node reduction (Aurora: 4 825 → ~1 180) with zero visual change.
