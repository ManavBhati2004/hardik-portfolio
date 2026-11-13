"""
Export the dark (KD_*) or light (KL_*) katana from its .blend file as a web GLB.

    blender --background "D:/Black Untitled.blend" --python scripts/blender/export_katanas.py -- KD out.glb [preview.png]
    blender --background "D:/Untitled.blend"       --python scripts/blender/export_katanas.py -- KL out.glb [preview.png]

- keeps only the katana collection (drops the demo objects in the file)
- the source textures (silk wrap, ray skin, blade) are linked to a folder that no longer
  exists: they are rebuilt here — the weave and the ray-skin nodules are generated in UV
  space, the blade's hamon and polish are baked from the blade's own geometry
- the saya is put on the sword (sheathed); the site animates it off
- orientation for the site: origin at the guard, blade along glTF +Y (Blender +Z)
- two named nodes: "Sword" and "Saya"
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Euler

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREFIX = argv[0] if argv else "KD"
OUT = os.path.abspath(argv[1] if len(argv) > 1 else f"{PREFIX.lower()}.glb")
PREVIEW = os.path.abspath(argv[2]) if len(argv) > 2 else None
DARK = PREFIX == "KD"
RES = 1024
rng = np.random.default_rng(7 if DARK else 11)

# ─── 1. keep only this katana ────────────────────────────────────────────────
scene = next(s for s in bpy.data.scenes if any(o.name == f"{PREFIX}_Root" for o in s.objects))
bpy.context.window.scene = scene
for o in list(bpy.data.objects):
    if not o.name.startswith(PREFIX + "_"):
        bpy.data.objects.remove(o, do_unlink=True)
for s in list(bpy.data.scenes):
    if s != scene:
        bpy.data.scenes.remove(s)

root = bpy.data.objects[f"{PREFIX}_Root"]
sword = bpy.data.objects[f"{PREFIX}_Sword"]
saya = bpy.data.objects[f"{PREFIX}_Saya"]
# sheathed: the saya's own frame lines up with the sword's (its mouth meets the habaki)
saya.location = (0.0, 0.0, 0.0)
saya.rotation_euler = (0.0, 0.0, 0.0)


# ─── 2. textures ─────────────────────────────────────────────────────────────
TEX_DIR = os.path.join(os.path.dirname(OUT), PREFIX.lower() + "_textures")
os.makedirs(TEX_DIR, exist_ok=True)


def to_image(name, rgb, non_color=False):
    """Write a generated texture to PNG and load it back (pixel buffers of new images
    do not survive packing/export reliably)."""
    h, w, _ = rgb.shape
    tmp = bpy.data.images.new(name + "_buf", w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    tmp.pixels.foreach_set(px.ravel())
    if not non_color:
        # pixels are linear; keep it simple: write them as display values via sRGB encode
        lin = px[..., :3]
        px[..., :3] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        tmp.pixels.foreach_set(px.ravel())
    path = os.path.join(TEX_DIR, name + ".png")
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    img.pack()
    return img


def normal_from_height(h, strength):
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * strength, -gy * strength, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


uv = (np.arange(RES) + 0.5) / RES
U, V = np.meshgrid(uv, uv)

# silk wrap (ito): tight diamond braid, each ribbon with fine fibres along it
N = 72
a = (U + V) * N
b = (U - V) * N
parity = (np.floor(a) + np.floor(b)) % 2
t = np.where(parity == 0, a % 1.0, b % 1.0)       # across the ribbon
along = np.where(parity == 0, b, a)                # along the ribbon
ribbon = np.sin(np.pi * t) ** 0.55
fibre = 0.5 + 0.5 * np.sin(along * 2 * np.pi * 9 + rng.random() * 6)
ito_h = ribbon * (0.85 + 0.15 * fibre)
ito_base = np.array([0.028, 0.026, 0.03]) if DARK else np.array([0.86, 0.85, 0.82])
ito_col = ito_base[None, None, :] * (0.55 + 0.45 * ito_h[..., None])
if DARK:  # black silk catches a faint sheen on the ribbon crowns
    ito_col += (ribbon[..., None] ** 6) * 0.035
ito_img = to_image(f"{PREFIX}_Ito_BaseColor", ito_col)
ito_nrm = to_image(f"{PREFIX}_Ito_Normal", normal_from_height(ito_h, 30.0), non_color=True)

# ray skin (samegawa): packed nodules of mixed size, larger "king" nodules in a row
same_h = np.zeros((RES, RES), dtype=np.float32)
def stamp(cx, cy, r, amp):
    x0, x1 = int(max(cx - r, 0)), int(min(cx + r + 1, RES))
    y0, y1 = int(max(cy - r, 0)), int(min(cy + r + 1, RES))
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    same_h[y0:y1, x0:x1] = np.maximum(same_h[y0:y1, x0:x1], amp * np.sqrt(np.clip(1 - d * d, 0, 1)))
for _ in range(8200):
    stamp(rng.random() * RES, rng.random() * RES, 3 + rng.random() * 6, 0.6 + rng.random() * 0.4)
for i in range(9):
    stamp(RES * (0.08 + i * 0.105), RES * 0.5 + rng.normal() * 6, 22 + rng.random() * 10, 1.0)
same_base = np.array([0.075, 0.072, 0.07]) if DARK else np.array([0.88, 0.86, 0.8])
pearl = np.array([0.04, 0.04, 0.045]) if DARK else np.array([0.06, 0.05, 0.03])
same_col = same_base[None, None, :] * (0.62 + 0.38 * same_h[..., None]) + pearl[None, None, :] * same_h[..., None] ** 3
same_img = to_image(f"{PREFIX}_Same_BaseColor", same_col)
same_nrm = to_image(f"{PREFIX}_Same_Normal", normal_from_height(same_h, 12.0), non_color=True)


def set_image(mat_name, label_match, img):
    m = bpy.data.materials.get(mat_name)
    if not m:
        return
    for n in m.node_tree.nodes:
        if n.type == "TEX_IMAGE" and label_match(n):
            n.image = img


def is_normal_tex(n):
    return any(l.to_node.type == "NORMAL_MAP" for l in n.outputs[0].links)


# silk sheen: the file's sheen is white, which turns black silk grey: tint it to the silk
for mname in (f"{PREFIX}_Ito_Silk",):
    m = bpy.data.materials.get(mname)
    if m:
        bs = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Sheen Weight"].default_value = 0.35
        bs.inputs["Sheen Tint"].default_value = (0.09, 0.09, 0.1, 1) if DARK else (1.0, 0.98, 0.94, 1)

set_image(f"{PREFIX}_Ito_Silk", lambda n: not is_normal_tex(n), ito_img)
set_image(f"{PREFIX}_Ito_Silk", is_normal_tex, ito_nrm)
set_image(f"{PREFIX}_Samegawa", lambda n: not is_normal_tex(n), same_img)
set_image(f"{PREFIX}_Samegawa", is_normal_tex, same_nrm)

# blade: per-vertex position across the blade (0 edge → 1 spine) and along it (0 guard → 1 tip),
# then bake colour (polished steel + misty hamon) and ORM (roughness / metal) into its UVs
blade = bpy.data.objects[f"{PREFIX}_Blade"]
me = blade.data
co = np.empty(len(me.vertices) * 3, dtype=np.float32)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
xs, zs = co[:, 0], co[:, 2]
x_min, x_max = xs.min(), xs.max()
bins = 120
idx = np.clip(((xs - x_min) / (x_max - x_min) * bins).astype(int), 0, bins - 1)
z_lo = np.full(bins, np.inf)
z_hi = np.full(bins, -np.inf)
np.minimum.at(z_lo, idx, zs)
np.maximum.at(z_hi, idx, zs)
for i in range(bins):  # fill empty slices from neighbours
    if not np.isfinite(z_lo[i]):
        j = i - 1 if i > 0 else i + 1
        z_lo[i], z_hi[i] = z_lo[j], z_hi[j]
across = (zs - z_lo[idx]) / np.maximum(z_hi[idx] - z_lo[idx], 1e-5)  # 0 edge (lower) → 1 spine
along_b = (xs - x_min) / (x_max - x_min)
attr = me.color_attributes.new("BladeCoord", "FLOAT_COLOR", "POINT")
cols = np.zeros((len(co), 4), dtype=np.float32)
cols[:, 0], cols[:, 1], cols[:, 3] = across, along_b, 1
attr.data.foreach_set("color", cols.ravel())

col_img = bpy.data.images.new("Blade_BaseColor_gen", RES, RES, alpha=False)
orm_img = bpy.data.images.new("Blade_ORM_gen", RES, RES, alpha=False)
orm_img.colorspace_settings.name = "Non-Color"

steel = bpy.data.materials["KL_Steel"]
nt = steel.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
img_nodes = [n for n in nt.nodes if n.type == "TEX_IMAGE"]
img_col = next(n for n in img_nodes if any(l.to_socket.name == "Base Color" for l in n.outputs[0].links))
img_orm = next(n for n in img_nodes if n is not img_col)
img_col.image = col_img
img_orm.image = orm_img
out_node = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")

# temporary emission graph: the hamon line wanders along the blade
a_node = nt.nodes.new("ShaderNodeAttribute"); a_node.attribute_name = "BladeCoord"
sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(a_node.outputs["Color"], sep.inputs[0])
noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 34.0; noise.inputs["Detail"].default_value = 9.0; noise.inputs["Roughness"].default_value = 0.62
comb = nt.nodes.new("ShaderNodeCombineXYZ")
nt.links.new(sep.outputs["Green"], comb.inputs["X"]); nt.links.new(sep.outputs["Red"], comb.inputs["Y"])
nt.links.new(comb.outputs[0], noise.inputs["Vector"])
math_wave = nt.nodes.new("ShaderNodeMath"); math_wave.operation = "MULTIPLY_ADD"
math_wave.inputs[1].default_value = 0.22; math_wave.inputs[2].default_value = 0.2  # line ≈ 0.31 ± 0.11 across
nt.links.new(noise.outputs["Fac"], math_wave.inputs[0])
diff = nt.nodes.new("ShaderNodeMath"); diff.operation = "SUBTRACT"
nt.links.new(sep.outputs["Red"], diff.inputs[0]); nt.links.new(math_wave.outputs[0], diff.inputs[1])
hamon = nt.nodes.new("ShaderNodeMapRange")  # 1 on the edge side (frosty hardened steel), 0 above
hamon.inputs["From Min"].default_value = 0.022; hamon.inputs["From Max"].default_value = -0.022  # crisper nioi line
nt.links.new(diff.outputs[0], hamon.inputs["Value"])
emit = nt.nodes.new("ShaderNodeEmission")
mix_col = nt.nodes.new("ShaderNodeMix"); mix_col.data_type = "RGBA"
mix_col.inputs[6].default_value = (0.5, 0.515, 0.55, 1)    # polished body (ji): a touch darker, mirror-like
mix_col.inputs[7].default_value = (0.86, 0.87, 0.88, 1)    # hamon: frosty white
nt.links.new(hamon.outputs[0], mix_col.inputs[0])
mix_orm = nt.nodes.new("ShaderNodeMix"); mix_orm.data_type = "RGBA"
mix_orm.inputs[6].default_value = (1.0, 0.055, 1.0, 1)     # R occlusion, G roughness, B metal
mix_orm.inputs[7].default_value = (1.0, 0.3, 1.0, 1)
nt.links.new(hamon.outputs[0], mix_orm.inputs[0])
old_surface = out_node.inputs["Surface"].links[0].from_socket

scene.render.engine = "CYCLES"
scene.cycles.samples = 4
scene.cycles.device = "CPU"
bpy.ops.object.select_all(action="DESELECT")
blade.select_set(True)
bpy.context.view_layer.objects.active = blade
for target, src in ((col_img, mix_col), (orm_img, mix_orm)):
    nt.links.new(src.outputs[2], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out_node.inputs["Surface"])
    nt.nodes.active = img_col if target is col_img else img_orm
    bpy.ops.object.bake(type="EMIT", margin=8)
    target.pack()
nt.links.new(old_surface, out_node.inputs["Surface"])
for n in (a_node, sep, noise, comb, math_wave, diff, hamon, emit, mix_col, mix_orm):
    nt.nodes.remove(n)
me.color_attributes.remove(me.color_attributes["BladeCoord"])

# ─── 3. names + orientation for the site ─────────────────────────────────────
sword.name = "Sword"
saya.name = "Saya"
root.location = (0, 0, 0)
root.rotation_euler = Euler((0.0, -math.pi / 2, 0.0))  # Blender +X (blade) → +Z → glTF +Y

# ─── 4. optional preview render ──────────────────────────────────────────────
if PREVIEW:
    import mathutils
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0.0, -2.1, 0.24)
    cam.rotation_euler = mathutils.Vector((0, 1.0, 0.0)).to_track_quat("-Z", "Y").to_euler()
    cam_data.lens = 38
    scene.camera = cam
    for name, loc, energy in (("K", (1.2, -1.4, 1.6), 600), ("F", (-1.5, -1.0, 0.4), 200), ("R", (0.4, 1.4, 1.0), 400)):
        ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.size = 1.0
        lo = bpy.data.objects.new(name, ld); lo.location = loc
        lo.rotation_euler = (mathutils.Vector((0, 0, 0.2)) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(lo)
    world = scene.world or bpy.data.worlds.new("W")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.055, 1)
    for vl in scene.view_layers:
        print("OVERRIDE", vl.name, vl.material_override)
        vl.material_override = None
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 900, 1300
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for name in ("K", "F", "R"):
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

# ─── 5. export ───────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_image_format="WEBP",
    export_texcoords=True,
    export_normals=True,
)
print("EXPORTED", OUT)
