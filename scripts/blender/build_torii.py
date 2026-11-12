"""
Headless Blender script: builds the myōjin torii for the shrine headland.

  blender -b --factory-startup -P build_torii.py -- <raw_out.glb> <preview.png>

Then compress like the other runtime models:
  npx @gltf-transform/cli@4 optimize <raw_out.glb> public/models/torii.opt.glb \
      --compress meshopt --texture-compress webp --texture-size 1024

Parts (myōjin style):
  kasagi    upswept top lintel: vermilion body under a black cap, ends cut on a slant
  shimaki   second lintel directly under the kasagi, gentler sori
  daiwa     rings where the pillars meet the shimaki
  hashira   two round pillars, tapered, leaning slightly inward (uchi-korobi)
  nuki      tie beam passing through the pillars and projecting beyond them
  kusabi    wedges driven beside each pillar, through the nuki
  gakuzuka  short central post between nuki and shimaki, carrying a blank framed plaque
  nemaki    black sleeves at the pillar bases
  kamebara  stone footings

Footprint and proportions match the previous torii.opt.glb so Environment.tsx keeps the same
position / rotation / scale (and its +1.82 lift): ground at z = -1.829, overall height
3.86, kasagi span ~4.76, centred on x = -0.15, y = -0.25 (Blender Z-up; glTF Y-up after export).
Material names drive the runtime grading in Environment.tsx: "...Roofing" = black lacquer,
"Stone Feet" = stone, "Plaque..." = dark wood, anything else = vermilion.
An AO map (with a temporary ground plane for contact shadow) is baked into one shared atlas.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, PREVIEW = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

XC, YC = -0.15, -0.25
Z0 = -1.829                  # ground
STONE_TOP = Z0 + 0.25
SHIMAKI_Z = 1.20             # underside of the shimaki
KASAGI_TIP = 2.032           # top of the upswept kasagi ends (matches the old bounds)
HALF_SPAN = 2.38             # half length of the kasagi top
FOOT_HALF = 1.255            # pillar centres at the base
LEAN = 0.0775                # inward lean (x per unit height)
R_BOT, R_TOP = 0.152, 0.125  # pillar radius
NUKI_Z0, NUKI_Z1 = 0.55, 0.75
SORI_P = 2.6


def material(name, rgb, rough):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


M_RED = material("Vermilion Lacquer", (0.42, 0.035, 0.02), 0.5)
M_BLACK = material("Black Roofing", (0.012, 0.012, 0.014), 0.45)
M_STONE = material("Stone Feet", (0.16, 0.16, 0.17), 0.9)
M_PLAQUE = material("Plaque Wood", (0.05, 0.035, 0.025), 0.7)
MATS = [M_RED, M_BLACK, M_STONE, M_PLAQUE]

parts = []  # (bmesh, material index)


def pillar_x(z, side):
    return XC + side * (FOOT_HALF - LEAN * (z - STONE_TOP))


def sori(x, amount):
    return amount * (min(abs(x - XC) / HALF_SPAN, 1.0) ** SORI_P)


# ───────────── swept beam (lintels): profile (y, zrel) in [0..1] height, slanted end cuts ─────────────
def beam(profile, z_base, height, half_bot, half_top, sori_amt, mat, n=56, depth_scale=1.0):
    bm = bmesh.new()
    rings = []
    for i in range(n + 1):
        u = -1 + 2 * i / n
        ring = []
        for (py, pz) in profile:
            half = half_bot + (half_top - half_bot) * pz
            x = XC + u * half
            z = z_base + pz * height + sori(x, sori_amt)
            ring.append(bm.verts.new((x, YC + py * depth_scale, z)))
        rings.append(ring)
    k = len(profile)
    for i in range(n):
        for j in range(k):
            a, b = rings[i][j], rings[i][(j + 1) % k]
            c, d = rings[i + 1][(j + 1) % k], rings[i + 1][j]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts.append((bm, mat))


def box(cx, cy, cz, sx, sy, sz, mat, taper_top=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)  # unit half-extents: sx, sy, sz are half sizes
    for v in bm.verts:
        k = taper_top if v.co.z > 0 else 1.0
        v.co = Vector((cx + v.co.x * sx * k, cy + v.co.y * sy, cz + v.co.z * sz))
    parts.append((bm, mat))
    return bm


def tube(p0, p1, r0, r1, mat, segs=40, rings=6, cap=True):
    """tapered cylinder from p0 to p1"""
    bm = bmesh.new()
    axis = (p1 - p0)
    ln = axis.length
    rot = axis.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    loops = []
    for i in range(rings + 1):
        t = i / rings
        r = r0 + (r1 - r0) * t
        loop = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            local = Vector((math.cos(a) * r, math.sin(a) * r, t * ln))
            loop.append(bm.verts.new(p0 + (rot @ local)))
        loops.append(loop)
    for i in range(rings):
        for j in range(segs):
            bm.faces.new((loops[i][j], loops[i][(j + 1) % segs], loops[i + 1][(j + 1) % segs], loops[i + 1][j]))
    if cap:
        bm.faces.new(list(reversed(loops[0])))
        bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    parts.append((bm, mat))


# ───────────── kasagi + shimaki ─────────────
# kasagi body (vermilion), slightly wider at the top; ends cut on a slant (top longer)
kas_body = [(-0.16, 0.0), (0.16, 0.0), (0.185, 1.0), (-0.185, 1.0)]
beam(kas_body, 1.42, 0.21, 2.18, 2.27, 0.25, 0)
# black cap: overhanging, with a low rounded crown
cap = [(-0.205, 0.0), (0.205, 0.0), (0.215, 0.38), (0.19, 0.72), (0.11, 0.93), (0.0, 1.0),
       (-0.11, 0.93), (-0.19, 0.72), (-0.215, 0.38)]
cap_h = KASAGI_TIP - 0.255 - 1.63
beam(cap, 1.63, cap_h, 2.27, HALF_SPAN, 0.255, 1)
# shimaki (vermilion): straight-cut ends, following the kasagi's sori so the two stay joined
shim = [(-0.115, 0.0), (0.115, 0.0), (0.115, 1.0), (-0.115, 1.0)]
beam(shim, SHIMAKI_Z, 0.22, 2.04, 2.04, 0.25, 0, n=40)

# ───────────── pillars, daiwa, nemaki, stones ─────────────
for side in (-1, 1):
    zb, zt = STONE_TOP - 0.02, SHIMAKI_Z + 0.08
    p0 = Vector((pillar_x(zb, side), YC, zb))
    p1 = Vector((pillar_x(zt, side), YC, zt))
    r_at = lambda z: R_BOT + (R_TOP - R_BOT) * (z - zb) / (zt - zb)  # noqa: E731
    tube(p0, p1, R_BOT, R_TOP, 0, rings=8)
    # daiwa ring just under the shimaki
    za, zb2 = SHIMAKI_Z - 0.085, SHIMAKI_Z
    tube(Vector((pillar_x(za, side), YC, za)), Vector((pillar_x(zb2, side), YC, zb2)),
         r_at(za) + 0.028, r_at(zb2) + 0.028, 0, rings=1)
    # nemaki: black sleeve with a thin lip at the top
    zn0, zn1 = STONE_TOP - 0.01, STONE_TOP + 0.30
    tube(Vector((pillar_x(zn0, side), YC, zn0)), Vector((pillar_x(zn1, side), YC, zn1)),
         r_at(zn0) + 0.022, r_at(zn1) + 0.02, 1, rings=2)
    zl = zn1 - 0.03
    tube(Vector((pillar_x(zl, side), YC, zl)), Vector((pillar_x(zn1 + 0.01, side), YC, zn1 + 0.01)),
         r_at(zl) + 0.034, r_at(zl) + 0.03, 1, rings=1)
    # kamebara stone footing: a low dome (rounded shoulder) on a short plinth
    sx = pillar_x(STONE_TOP, side)
    prof = [(0.0, 0.31), (0.06, 0.325), (0.12, 0.322), (0.17, 0.305), (0.205, 0.278), (0.23, 0.245), (0.25, 0.2)]
    for (z_a, r_a), (z_b, r_b) in zip(prof, prof[1:]):
        tube(Vector((sx, YC, Z0 + z_a)), Vector((sx, YC, Z0 + z_b)), r_a, r_b, 2, segs=40, rings=1)

    # kusabi: tapered wedge through the nuki, just outside the pillar
    zk = (NUKI_Z0 + NUKI_Z1) / 2
    px = pillar_x(zk, side) + side * (r_at(zk) + 0.045)
    box(px, YC, zk + 0.02, 0.035, 0.065, 0.19, 1, taper_top=1.35)

# ───────────── nuki ─────────────
nuki_half = 1.92
nuki = [(-0.085, 0.0), (0.085, 0.0), (0.085, 1.0), (-0.085, 1.0)]
beam(nuki, NUKI_Z0, NUKI_Z1 - NUKI_Z0, nuki_half, nuki_half, 0.0, 0, n=24)

# ───────────── gakuzuka + plaque ─────────────
box(XC, YC, (NUKI_Z1 + SHIMAKI_Z) / 2, 0.07, 0.07, (SHIMAKI_Z - NUKI_Z1) / 2 + 0.01, 0)
plaque_z = (NUKI_Z1 + SHIMAKI_Z) / 2 + 0.01
tilt = Matrix.Rotation(math.radians(-6), 4, "X")
front = YC - 0.105


def plaque_part(sx, sy, sz, dy, mat):
    bm = box(0, 0, 0, sx, sy, sz, mat)
    m = Matrix.Translation((XC, front + dy, plaque_z)) @ tilt
    for v in bm.verts:
        v.co = m @ v.co


plaque_part(0.155, 0.022, 0.205, 0.0, 1)      # black frame
plaque_part(0.12, 0.012, 0.168, -0.016, 3)     # blank board, set into the frame


# ───────────── assemble ─────────────
obj_bm = bmesh.new()
me = bpy.data.meshes.new("Torii")
for m in MATS:
    me.materials.append(m)
for bm, mi in parts:
    tmp = bpy.data.meshes.new("tmp")
    bm.to_mesh(tmp)
    for p in tmp.polygons:
        p.material_index = mi
    obj_bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    bm.free()
obj_bm.to_mesh(me)
obj_bm.free()
torii = bpy.data.objects.new("Torii", me)
scene.collection.objects.link(torii)
bpy.context.view_layer.objects.active = torii
torii.select_set(True)

bev = torii.modifiers.new("bevel", "BEVEL")
bev.width = 0.012
bev.segments = 2
bev.limit_method = "ANGLE"
bev.angle_limit = math.radians(40)
bev.harden_normals = True
bpy.ops.object.modifier_apply(modifier=bev.name)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
print("[torii] tris", sum(len(p.vertices) - 2 for p in me.polygons))

# UV atlas + AO bake
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004)
bpy.ops.uv.pack_islands(margin=0.003, rotate=True)
bpy.ops.object.mode_set(mode="OBJECT")

scene.render.engine = "CYCLES"
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev_type in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            if any(d.type == dev_type for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == dev_type
                scene.cycles.device = "GPU"
                break
        except TypeError:
            continue
except Exception as e:  # noqa: BLE001
    print("[torii] CPU bake:", e)
scene.cycles.samples = 128

bpy.ops.mesh.primitive_plane_add(size=12, location=(XC, YC, Z0))
ground = bpy.context.active_object

TEX = 1024
ao_img = bpy.data.images.new("torii_ao", TEX, TEX, alpha=False)
ao_img.colorspace_settings.name = "Non-Color"
for m in MATS:
    n = m.node_tree.nodes.new("ShaderNodeTexImage")
    n.image = ao_img
    m.node_tree.nodes.active = n
for o in scene.objects:
    o.select_set(o == torii)
bpy.context.view_layer.objects.active = torii
bpy.ops.object.bake(type="AO", margin=8)
bpy.data.objects.remove(ground)
# lift the floor of the AO so lacquer never goes fully black, then pack
px = list(ao_img.pixels)
for i in range(0, len(px), 4):
    v = 0.2 + 0.8 * px[i]
    px[i] = px[i + 1] = px[i + 2] = v
ao_img.pixels = px
ao_img.pack()

grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
for m in MATS:
    nt = m.node_tree
    tex = nt.nodes.active
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    g = nt.nodes.new("ShaderNodeGroup")
    g.node_tree = grp
    nt.links.new(sep.outputs["Red"], g.inputs["Occlusion"])

for o in scene.objects:
    o.select_set(o == torii)
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_image_format="AUTO",
    export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials="EXPORT")
print("[torii] wrote", OUT)
bb = [torii.matrix_world @ Vector(c) for c in torii.bound_box]
print("[torii] bounds x", round(min(v.x for v in bb), 3), round(max(v.x for v in bb), 3),
      "y", round(min(v.y for v in bb), 3), round(max(v.y for v in bb), 3),
      "z", round(min(v.z for v in bb), 3), round(max(v.z for v in bb), 3))

# ───────────── preview ─────────────
scene.render.engine = "BLENDER_EEVEE"
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.data.lens = 45
target = Vector((XC, YC, 0.15))
cam.location = target + Vector((2.6, -7.0, 0.6))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
key = bpy.data.objects.new("key", bpy.data.lights.new("key", "SUN"))
key.data.energy = 4.0
key.rotation_euler = (math.radians(55), 0, math.radians(-30))
scene.collection.objects.link(key)
rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "SUN"))
rim.data.energy = 2.0
rim.data.color = (1.0, 0.45, 0.4)
rim.rotation_euler = (math.radians(70), 0, math.radians(160))
scene.collection.objects.link(rim)
bpy.ops.mesh.primitive_plane_add(size=14, location=(XC, YC, Z0))
world = bpy.data.worlds.new("w")
world.color = (0.06, 0.06, 0.07)
scene.world = world
scene.render.resolution_x = 1200
scene.render.resolution_y = 1000
scene.view_settings.view_transform = "AgX"
scene.render.filepath = PREVIEW
bpy.ops.render.render(write_still=True)
print("[torii] preview", PREVIEW)
