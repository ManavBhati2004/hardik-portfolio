"""
Headless Blender script: builds the myōjin torii for the shrine headland.

  blender -b --factory-startup -P build_torii.py -- <raw_out.glb> <preview.png>

Then compress like the other runtime models:
  npx @gltf-transform/cli@4 optimize <raw_out.glb> public/models/torii.opt.glb \
      --compress meshopt --texture-compress webp --texture-size 2048

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
Surfaces are procedural Cycles shaders baked into one shared 2048 atlas (albedo, tangent normal,
ORM = AO with a temporary ground plane for contact shadow + roughness):
  vermilion  lacquer with tone variation, sun-faded tops, rain streaks, corner grime; worn
             through at the edges (bevel-normal wear mask) and flaked in patches, showing a
             primer rim and grey weathered wood whose grain follows each part's axis
  black      caps / sleeves / wedges: black lacquer, brown undercoat at worn edges, dust on tops
  stone      speckled granite footings with lichen
  plaque     dark weathered board
The albedo is baked ~2.9x brighter than it renders; Environment.tsx scales textured materials down.
"""
import math
import sys

import bmesh
import bpy
import numpy as np
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

parts = []  # (bmesh, material index, grain axis: 0 = wood fibres along X, 1 = along the part's height)


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
    parts.append((bm, mat, 0))


def box(cx, cy, cz, sx, sy, sz, mat, taper_top=1.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)  # unit half-extents: sx, sy, sz are half sizes
    for v in bm.verts:
        k = taper_top if v.co.z > 0 else 1.0
        v.co = Vector((cx + v.co.x * sx * k, cy + v.co.y * sy, cz + v.co.z * sz))
    parts.append((bm, mat, 1))
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
    parts.append((bm, mat, 1))


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
    tube(p0, p1, R_BOT, R_TOP, 0, rings=8, cap=False)  # both ends are buried (stone / shimaki)
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
        # stacked rings with no caps: the ends are hidden (ground below, pillar on top) and
        # would only waste atlas space
        tube(Vector((sx, YC, Z0 + z_a)), Vector((sx, YC, Z0 + z_b)), r_a, r_b, 2, segs=40, rings=1, cap=False)

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
grain_axis = []
for bm, mi, axis in parts:
    tmp = bpy.data.meshes.new("tmp")
    bm.to_mesh(tmp)
    for p in tmp.polygons:
        p.material_index = mi
    grain_axis.extend([float(axis)] * len(tmp.polygons))
    obj_bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
    bm.free()
obj_bm.to_mesh(me)
obj_bm.free()
me.attributes.new("grain", "FLOAT", "FACE").data.foreach_set("value", grain_axis)
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

# ───────────── UV atlas ─────────────
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.006)
bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
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


# ───────────── procedural surfaces (baked below) ─────────────
# Albedo is baked at ~2.9x the runtime brightness (8-bit headroom for the dark lacquers);
# Environment.tsx multiplies textured materials back down (TEX_GAIN there).
class NB:
    """tiny node-building helper"""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.N, self.L = self.nt.nodes, self.nt.links

    def new(self, kind, **inputs):
        n = self.N.new(kind)
        for k, v in inputs.items():
            self.inp(n.inputs[k], v)
        return n

    def inp(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.L.new(v, sock)
        else:
            sock.default_value = v

    def math(self, op, a, b=0.0, clamp=False):
        n = self.N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self.inp(n.inputs[0], a)
        self.inp(n.inputs[1], b)
        return n.outputs[0]

    def ss(self, x, lo, hi, a=0.0, b=1.0):
        n = self.N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        self.inp(n.inputs["Value"], x)
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        n.inputs["To Min"].default_value = a
        n.inputs["To Max"].default_value = b
        return n.outputs["Result"]

    def mix(self, fac, a, b, blend="MIX"):
        n = self.N.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.blend_type = blend
        self.inp(n.inputs["Factor"], fac)
        self.inp(n.inputs["A"], (*a, 1) if isinstance(a, tuple) else a)
        self.inp(n.inputs["B"], (*b, 1) if isinstance(b, tuple) else b)
        return n.outputs["Result"]

    def noise(self, vec, scale, detail=4.0, rough=0.55, dist=0.0):
        n = self.N.new("ShaderNodeTexNoise")
        self.inp(n.inputs["Vector"], vec)
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = dist
        return n.outputs["Fac"]

    def vmul(self, vec, s):
        n = self.N.new("ShaderNodeVectorMath")
        n.operation = "MULTIPLY"
        self.inp(n.inputs[0], vec)
        n.inputs[1].default_value = s
        return n.outputs[0]


def surface(mat, kind):
    """returns (albedo, roughness, height) sockets for one torii material"""
    b = NB(mat)
    b.N.clear()
    P = b.new("ShaderNodeTexCoord").outputs["Object"]
    geo = b.new("ShaderNodeNewGeometry")
    up = b.new("ShaderNodeSeparateXYZ", Vector=geo.outputs["Normal"]).outputs["Z"]
    # wood fibres: noise stretched along the part's grain axis
    gattr = b.new("ShaderNodeAttribute")
    gattr.attribute_type = "GEOMETRY"
    gattr.attribute_name = "grain"
    along_x = b.vmul(P, (0.06, 1.0, 1.0))
    along_z = b.vmul(P, (1.0, 1.0, 0.06))
    gmix = b.N.new("ShaderNodeMix")
    gmix.data_type = "VECTOR"
    b.inp(gmix.inputs["Factor"], gattr.outputs["Fac"])
    b.inp(gmix.inputs[4], along_x)
    b.inp(gmix.inputs[5], along_z)
    gvec = gmix.outputs[1]
    fibre = b.noise(gvec, 55.0, 8.0, 0.6)
    rings = b.new("ShaderNodeTexWave", Vector=gvec)
    rings.wave_type = "RINGS"
    rings.rings_direction = "Z"
    rings.inputs["Scale"].default_value = 9.0
    rings.inputs["Distortion"].default_value = 7.0
    rings.inputs["Detail"].default_value = 3.0
    grain = b.math("ADD", b.math("MULTIPLY", fibre, 0.6), b.math("MULTIPLY", rings.outputs["Fac"], 0.4))
    # edge wear: where the rounded (bevel) normal departs from the shading normal
    bev = b.new("ShaderNodeBevel")
    bev.samples = 8
    bev.inputs["Radius"].default_value = 0.03
    dot = b.N.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    b.inp(dot.inputs[0], bev.outputs["Normal"])
    b.inp(dot.inputs[1], geo.outputs["Normal"])
    edge = b.ss(b.math("SUBTRACT", 1.0, dot.outputs["Value"]), 0.003, 0.03)
    brk = b.noise(P, 9.0, 6.0, 0.62)
    brk2 = b.noise(P, 34.0, 3.0, 0.5)
    ao = b.new("ShaderNodeAmbientOcclusion", Distance=0.25)
    ao.samples = 16
    occl = b.ss(ao.outputs["AO"], 0.35, 0.95, 1.0, 0.0)  # 1 in tight corners
    # rain streaks running down the vertical faces
    streak = b.ss(b.noise(b.vmul(P, (14.0, 14.0, 0.9)), 1.0, 4.0, 0.6), 0.45, 0.7)

    if kind == "red":
        wear = b.ss(b.math("ADD", b.math("MULTIPLY", edge, 1.3), b.math("MULTIPLY", b.math("SUBTRACT", brk, 0.5), 1.6)), 0.42, 0.62)
        # lacquer flaked off in patches, mostly on the weather side (tops)
        flake_zone = b.ss(up, 0.4, 0.9, 0.15, 0.75)
        flake = b.ss(b.math("ADD", b.math("MULTIPLY", brk2, 0.5), b.math("MULTIPLY", brk, 0.7)), 0.6, 0.64)
        flake = b.math("MULTIPLY", flake, flake_zone)
        bare = b.math("MAXIMUM", wear, flake, clamp=True)
        tone = b.noise(P, 2.2, 3.0, 0.5)
        lac = b.mix(b.ss(tone, 0.3, 0.7), (0.36, 0.016, 0.010), (0.45, 0.026, 0.014))
        # sun-faded, chalky lacquer on the up-facing surfaces
        lac = b.mix(b.math("MULTIPLY", b.ss(up, 0.3, 0.95), b.ss(brk, 0.3, 0.7, 0.35, 0.8)), lac, (0.5, 0.07, 0.045))
        wood = b.mix(grain, (0.15, 0.115, 0.085), (0.07, 0.05, 0.036))
        under = b.mix(b.ss(bare, 0.5, 1.0), (0.11, 0.022, 0.012), wood)  # rim of primer around bare wood
        col = b.mix(b.ss(bare, 0.15, 0.4), lac, under)
        col = b.mix(b.math("MULTIPLY", streak, 0.35), col, (0.55, 0.55, 0.55), "MULTIPLY")
        col = b.mix(b.math("MULTIPLY", occl, 0.55), col, (0.35, 0.33, 0.33), "MULTIPLY")
        rough = b.math("ADD", b.math("ADD", 0.42, b.math("MULTIPLY", bare, 0.4)), b.math("MULTIPLY", b.ss(up, 0.3, 0.95), 0.12), clamp=True)
        height = b.math("ADD", b.math("MULTIPLY", b.math("SUBTRACT", 1.0, bare), 0.6),
                        b.math("MULTIPLY", b.math("MULTIPLY", grain, bare), 0.5))
        height = b.math("ADD", height, b.math("MULTIPLY", b.noise(P, 160.0, 2.0, 0.5), 0.06))  # orange-peel
    elif kind == "black":
        wear = b.ss(b.math("ADD", b.math("MULTIPLY", edge, 1.2), b.math("MULTIPLY", b.math("SUBTRACT", brk, 0.5), 1.4)), 0.5, 0.72)
        base = b.mix(b.ss(b.noise(P, 3.0, 3.0), 0.3, 0.7), (0.008, 0.008, 0.009), (0.013, 0.012, 0.013))
        col = b.mix(b.math("MULTIPLY", wear, 0.85), base, (0.06, 0.042, 0.03))  # worn to brown undercoat
        dust = b.math("MULTIPLY", b.ss(up, 0.5, 0.95), b.ss(brk2, 0.35, 0.75, 0.2, 0.75))
        col = b.mix(dust, col, (0.045, 0.043, 0.04))
        col = b.mix(b.math("MULTIPLY", streak, 0.4), col, (0.028, 0.027, 0.027))
        rough = b.math("ADD", b.math("ADD", 0.4, b.math("MULTIPLY", dust, 0.35)), b.math("MULTIPLY", wear, 0.25), clamp=True)
        height = b.math("ADD", b.math("MULTIPLY", b.math("SUBTRACT", 1.0, wear), 0.4), b.math("MULTIPLY", b.noise(P, 140.0, 2.0), 0.08))
    elif kind == "stone":
        sp = b.noise(P, 90.0, 2.0, 0.4)
        col = b.mix(b.ss(sp, 0.35, 0.68), (0.07, 0.07, 0.072), (0.17, 0.168, 0.16))
        col = b.mix(b.ss(b.noise(P, 4.0, 4.0), 0.4, 0.7, 0.0, 0.5), col, (0.09, 0.085, 0.075))
        lichen = b.math("MULTIPLY", b.ss(b.noise(P, 6.0, 6.0, 0.6), 0.58, 0.66), b.ss(up, -0.2, 0.6))
        col = b.mix(b.math("MULTIPLY", lichen, 0.7), col, (0.2, 0.2, 0.16))
        col = b.mix(b.math("MULTIPLY", occl, 0.6), col, (0.4, 0.4, 0.4), "MULTIPLY")
        rough = b.math("ADD", 0.82, b.math("MULTIPLY", sp, 0.15), clamp=True)
        height = b.math("ADD", b.math("MULTIPLY", sp, 0.5), b.math("MULTIPLY", b.noise(P, 18.0, 5.0), 0.5))
    else:  # plaque: dark weathered board
        col = b.mix(grain, (0.04, 0.03, 0.022), (0.018, 0.013, 0.01))
        col = b.mix(b.math("MULTIPLY", streak, 0.4), col, (0.6, 0.6, 0.6), "MULTIPLY")
        rough = b.math("ADD", 0.7, b.math("MULTIPLY", grain, 0.15), clamp=True)
        height = grain
    return b, col, rough, height


KIND = {M_RED.name: "red", M_BLACK.name: "black", M_STONE.name: "stone", M_PLAQUE.name: "plaque"}
rig = {}
for m in MATS:
    b, col, rough, height = surface(m, KIND[m.name])
    bsdf = b.N.new("ShaderNodeBsdfPrincipled")
    bump = b.new("ShaderNodeBump", Strength=1.0, Distance=0.0035)
    b.inp(bump.inputs["Height"], height)
    b.inp(bsdf.inputs["Base Color"], col)
    b.inp(bsdf.inputs["Roughness"], rough)
    b.inp(bsdf.inputs["Normal"], bump.outputs["Normal"])
    emit = b.N.new("ShaderNodeEmission")
    out = b.N.new("ShaderNodeOutputMaterial")
    rig[m.name] = dict(b=b, col=col, rough=rough, bsdf=bsdf, emit=emit, out=out)


def route(mode):
    for r in rig.values():
        L = r["b"].L
        for lk in list(r["out"].inputs["Surface"].links) + list(r["emit"].inputs["Color"].links):
            L.remove(lk)
        if mode == "bsdf":
            L.new(r["bsdf"].outputs[0], r["out"].inputs["Surface"])
        else:
            L.new(r[mode], r["emit"].inputs["Color"])
            L.new(r["emit"].outputs[0], r["out"].inputs["Surface"])


TEX = 2048


def target(name, colour):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    for m in MATS:
        n = m.node_tree.nodes.new("ShaderNodeTexImage")
        n.image = img
        m.node_tree.nodes.active = n
    return img


def bake(kind, img, **kw):
    for o in scene.objects:
        o.select_set(o == torii)
    bpy.context.view_layer.objects.active = torii
    bpy.ops.object.bake(type=kind, margin=12, **kw)
    print("[torii] baked", img.name)


scene.cycles.samples = 64
route("col")
img_col = target("torii_albedo", True)
bake("EMIT", img_col)
route("rough")
img_rgh = target("torii_rough", False)
bake("EMIT", img_rgh)
route("bsdf")
img_nrm = target("torii_normal", False)
bake("NORMAL", img_nrm, normal_space="TANGENT")
# AO with a temporary ground plane for the contact shadow
bpy.ops.mesh.primitive_plane_add(size=12, location=(XC, YC, Z0))
ground = bpy.context.active_object
scene.cycles.samples = 128
img_ao = target("torii_ao", False)
bake("AO", img_ao)
bpy.data.objects.remove(ground)

# ORM: R = AO (floor lifted so the lacquer never goes fully black), G = roughness
a = np.empty(TEX * TEX * 4, dtype=np.float32)
img_ao.pixels.foreach_get(a)
r = np.empty(TEX * TEX * 4, dtype=np.float32)
img_rgh.pixels.foreach_get(r)
orm = np.zeros((TEX * TEX, 4), dtype=np.float32)
orm[:, 0] = 0.2 + 0.8 * a.reshape(-1, 4)[:, 0]
orm[:, 1] = r.reshape(-1, 4)[:, 0]
orm[:, 3] = 1
img_orm = bpy.data.images.new("torii_orm", TEX, TEX, alpha=False)
img_orm.colorspace_settings.name = "Non-Color"
img_orm.pixels.foreach_set(orm.reshape(-1))
img_orm.update()
for img in (img_col, img_nrm, img_orm):
    img.pack()
bpy.data.images.remove(img_ao)
bpy.data.images.remove(img_rgh)

# export materials: the baked maps only (names unchanged: Environment.tsx grades by name)
grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
for m in MATS:
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bs.outputs[0], out.inputs[0])
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = img_col
    nt.links.new(tc.outputs["Color"], bs.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = img_nrm
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = img_orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    bs.inputs["Metallic"].default_value = 0.0
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
