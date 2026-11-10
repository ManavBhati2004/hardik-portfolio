"""
Headless Blender script: builds the flowering (sakura-style) branch used in the hero.

  blender -b --factory-startup -P build_blossom_branch.py -- <bark_tex_dir> <out.glb> [seed]

Output (glTF, Y-up after export):
  - "Bark"      : swept, tapered limbs/twigs with UVs + Poly Haven bark_brown_02 PBR maps (CC0)
  - "Blossoms"  : modelled five-petal flowers (cupped, notched petals) + buds, generated petal texture
  - "Stamens"   : filaments + anthers for every open flower

Vertex colour COLOR_0 (float, linear) drives the wind shader in three.js:
  R = path distance from the branch root, normalised 0..1   (sway weight)
  G = branch phase 0..1                                     (de-synchronises branches)
  B = per-flower random 0..1                                (tint / flutter variation)
  A = distance from the flower centre 0..1 (petal flutter), 0 on bark
"""
import sys
import math
import random
import os

import bpy
import numpy as np
from mathutils import Vector, Quaternion, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
BARK_DIR = argv[0]
OUT = argv[1]
SEED = int(argv[2]) if len(argv) > 2 else 11
rng = random.Random(SEED)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ───────────────────────────── Branch skeleton ─────────────────────────────
MAX_LEVEL = 3
CHILDREN = {0: 6, 1: 3, 2: 2}
WANDER = {0: 0.06, 1: 0.12, 2: 0.16, 3: 0.2}
# (preferred direction, pull per unit length). Blender Z = up.
TROPISM = {
    0: (Vector((1.0, 0.0, -0.36)).normalized(), 0.9),
    1: (None, 0.0),
    2: (Vector((0.35, -0.1, 1.0)).normalized(), 0.35),
    3: (Vector((0.2, -0.1, 1.0)).normalized(), 0.5),
}
RINGS = {0: 14, 1: 10, 2: 7, 3: 6}

branches = []
flowers = []


def perp(v):
    a = Vector((0, 0, 1)) if abs(v.z) < 0.9 else Vector((1, 0, 0))
    return v.cross(a).normalized()


def grow(start, direction, length, r0, r1, level, dist0, phase):
    n = max(5, int(length / 0.05))
    seg = length / n
    d = direction.normalized()
    p = start.copy()
    pts, radii, dists = [p.copy()], [r0], [dist0]
    for i in range(1, n + 1):
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1) * 0.45, rng.uniform(-1, 1)))
        d = (d + jitter * WANDER[level]).normalized()
        # tropism: pull toward a preferred direction (bounded, does not accumulate into a droop)
        pref, rate = TROPISM[level]
        if pref is not None:
            d = d.lerp(pref, min(1.0, rate * seg)).normalized()
        d.y -= p.y * 0.04          # keep the bough fairly flat in depth
        d.normalize()
        p = p + d * seg
        t = i / n
        pts.append(p.copy())
        radii.append(r0 + (r1 - r0) * (t ** 0.85))
        dists.append(dist0 + i * seg)
    branches.append(dict(points=pts, radii=radii, dists=dists, phase=phase % 1.0, level=level))

    if level < MAX_LEVEL:
        for _ in range(CHILDREN[level]):
            t = rng.uniform(0.18, 0.95)
            idx = min(n - 1, max(1, int(t * n)))
            base = pts[idx]
            tangent = (pts[idx + 1] - pts[idx]).normalized()
            side = perp(tangent)
            side = Quaternion(tangent, rng.uniform(0, 2 * math.pi)) @ side
            ang = math.radians(rng.uniform(26, 58))
            cdir = (Quaternion(side, ang) @ tangent).normalized()
            clen = length * rng.uniform(0.32, 0.58) * (1.0 - t * 0.35)
            if level == 0:
                clen = max(clen, 0.55)
            cr0 = radii[idx] * rng.uniform(0.55, 0.72)
            grow(base, cdir, clen, cr0, max(0.0035, cr0 * 0.28), level + 1, dists[idx],
                 phase + rng.uniform(0.15, 0.6))

    # blossoms: on the finer branches, clustered at tips and spurs
    if level >= 2 or (level == 1 and rng.random() < 0.6):
        tip = pts[-1]
        tip_dir = (pts[-1] - pts[-2]).normalized()
        cluster = rng.randint(2, 4) if level >= 2 else rng.randint(1, 3)
        for _ in range(cluster):
            off = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.05
            add_flower(tip + off, tip_dir, dists[-1], phase)
        if rng.random() < 0.7:
            add_flower(tip + tip_dir * 0.03, tip_dir, dists[-1], phase, bud=True)
        # spurs along the twig
        i = int(n * 0.35)
        while i < n - 1:
            if rng.random() < 0.3:
                tangent = (pts[i + 1] - pts[i]).normalized()
                out = Quaternion(tangent, rng.uniform(0, 2 * math.pi)) @ perp(tangent)
                for _ in range(1):
                    add_flower(pts[i] + out * (radii[i] + 0.03), out, dists[i], phase,
                               bud=rng.random() < 0.18)
            i += max(1, int(0.085 / seg))


def add_flower(pos, out_dir, dist, phase, bud=False):
    # face outward from the twig, biased toward the camera (-Y) and slightly up
    facing = (out_dir.normalized() * 0.55 + Vector((0, -1, 0)) * 0.75 + Vector((0, 0, 0.25))
              + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.45).normalized()
    flowers.append(dict(pos=pos, n=facing, dist=dist, phase=phase % 1.0, rand=rng.random(),
                        scale=rng.uniform(0.8, 1.15) * (0.55 if bud else 1.0), bud=bud,
                        spin=rng.uniform(0, 2 * math.pi)))


# main bough: root at the origin, heading right and gently down (enters from the upper-left in scene)
grow(Vector((0, 0, 0)), Vector((1.0, -0.05, -0.32)), 4.3, 0.105, 0.03, 0, 0.0, 0.0)
# a second, thinner limb from the root for a fuller silhouette
grow(Vector((0.15, 0.05, 0.02)), Vector((0.9, 0.1, -0.05)), 2.6, 0.06, 0.018, 1, 0.15, 0.37)

max_dist = max(max(b["dists"]) for b in branches)
print(f"[blossom] branches={len(branches)} flowers={len(flowers)} max_dist={max_dist:.2f}")

# ───────────────────────────── Bark mesh (swept tubes) ─────────────────────────────
verts, faces, uvs, cols = [], [], [], []


def sweep(b):
    pts, radii, dists = b["points"], b["radii"], b["dists"]
    segs = RINGS[b["level"]]
    tiles_u = max(1, round(2 * math.pi * radii[0] / 0.35))
    # parallel transport frames
    t0 = (pts[1] - pts[0]).normalized()
    nrm = perp(t0)
    frames = []
    for i in range(len(pts)):
        if i < len(pts) - 1:
            t = (pts[i + 1] - pts[i]).normalized()
        else:
            t = (pts[i] - pts[i - 1]).normalized()
        if i > 0:
            prev_t = frames[-1][0]
            axis = prev_t.cross(t)
            if axis.length > 1e-6:
                ang = math.asin(min(1.0, axis.length))
                nrm = Quaternion(axis.normalized(), ang) @ nrm
        nrm = (nrm - t * nrm.dot(t)).normalized()
        frames.append((t, nrm, t.cross(nrm)))
    base = len(verts)
    ring_len = segs + 1
    for i, p in enumerate(pts):
        t, n1, n2 = frames[i]
        r = radii[i] * (1.0 + 0.06 * math.sin(dists[i] * 23.0 + b["phase"] * 9.0))
        if i == len(pts) - 1:
            r *= 0.35
        w = dists[i] / max_dist
        for j in range(ring_len):
            a = 2 * math.pi * j / segs
            ridge = 1.0 + 0.05 * math.sin(a * 7 + dists[i] * 11.0)
            off = (n1 * math.cos(a) + n2 * math.sin(a)) * r * ridge
            verts.append(p + off)
            uvs.append((tiles_u * j / segs, dists[i] / 0.45))
            cols.append((w, b["phase"], 0.0, 0.0))
    for i in range(len(pts) - 1):
        for j in range(segs):
            a = base + i * ring_len + j
            bb = a + ring_len
            faces.append((a, a + 1, bb + 1, bb))


for b in branches:
    sweep(b)


def make_mesh(name, verts, faces, uv_per_vert, cols_per_vert, mat_index=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uv.data[li].uv = uv_per_vert[vi]
    ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(cols_per_vert):
        ca.data[i].color = c
    me.color_attributes.active_color = ca
    if mat_index is not None:
        for poly, mi in zip(me.polygons, mat_index):
            poly.material_index = mi
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


bark_obj = make_mesh("Bark", verts, faces, uvs, cols)

# ───────────────────────────── Flower template ─────────────────────────────
# local frame: flower faces +Z, centre at origin, petal length 1 (scaled later)
PETAL_V, PETAL_U = 5, 4


def petal_template():
    pv, pf, puv, pd = [], [], [], []
    for i in range(PETAL_V + 1):
        v = i / PETAL_V
        for j in range(PETAL_U + 1):
            u = j / PETAL_U * 2 - 1
            width = 0.42 * math.sin(math.pi * min(1.0, 0.12 + v * 0.95)) ** 0.8 + 0.04
            notch = 0.13 * math.exp(-(u / 0.22) ** 2) * (v ** 3)
            y = v * (1.0 - notch)
            x = u * width
            z = 0.32 * (x * x) / 0.18 + 0.22 * v * v      # cupped across, curling up
            pv.append(Vector((x, y, z)))
            puv.append(((u + 1) * 0.5, v))
            pd.append(v)
    for i in range(PETAL_V):
        for j in range(PETAL_U):
            a = i * (PETAL_U + 1) + j
            b = a + PETAL_U + 1
            pf.append((a, a + 1, b + 1, b))
    return pv, pf, puv, pd


PV, PF, PUV, PD = petal_template()


def bud_template():
    bv, bf = [], []
    rings, segs = 5, 7
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(segs):
            ph = 2 * math.pi * j / segs
            bv.append(Vector((math.sin(th) * math.cos(ph) * 0.42, math.sin(th) * math.sin(ph) * 0.42,
                              -math.cos(th) * 0.62 + 0.3)))
    for i in range(rings):
        for j in range(segs):
            a = i * segs + j
            b = i * segs + (j + 1) % segs
            bf.append((a, b, b + segs, a + segs))
    return bv, bf


BV, BF = bud_template()

fv, ff, fuv, fcol, fmat = [], [], [], [], []
sv, sf, suv, scol = [], [], [], []
FLOWER_SIZE = 0.062

for f in flowers:
    q = Vector((0, 0, 1)).rotation_difference(f["n"])
    rot = q @ Quaternion(Vector((0, 0, 1)), f["spin"])
    s = FLOWER_SIZE * f["scale"]
    w = f["dist"] / max_dist
    if f["bud"]:
        base = len(fv)
        for v in BV:
            fv.append(f["pos"] + rot @ (v * s))
            fuv.append((0.5, 0.35 + max(0.0, v.z) * 0.6))
            fcol.append((w, f["phase"], f["rand"], 0.2))
        for face in BF:
            ff.append(tuple(base + k for k in face))
        continue
    open_amount = rng.uniform(0.75, 1.0)
    for k in range(5):
        pr = Quaternion(Vector((0, 0, 1)), k * 2 * math.pi / 5 + rng.uniform(-0.12, 0.12))
        tilt = Quaternion(Vector((1, 0, 0)), -(1.0 - open_amount) * 0.9 - rng.uniform(0.0, 0.18))
        base = len(fv)
        plen = rng.uniform(0.92, 1.06)
        for v, uvv, dv in zip(PV, PUV, PD):
            lv = Vector((v.x, v.y * plen + 0.08, v.z))
            lv = pr @ (tilt @ lv)
            fv.append(f["pos"] + rot @ (lv * s))
            fuv.append(uvv)
            fcol.append((w, f["phase"], f["rand"], dv))
        for face in PF:
            ff.append(tuple(base + k2 for k2 in face))
    # stamens: thin filaments with small anthers
    for k in range(5):
        a = k * 2 * math.pi / 5 + rng.uniform(-0.2, 0.2)
        tip = Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, rng.uniform(0.32, 0.42)))
        basev = Vector((0, 0, 0.04))
        side = Vector((-math.sin(a), math.cos(a), 0)) * 0.012
        b0 = len(sv)
        for p, vv in ((basev - side, 0.0), (basev + side, 0.0), (tip + side * 0.6, 1.0), (tip - side * 0.6, 1.0)):
            sv.append(f["pos"] + rot @ (p * s))
            suv.append((0.25, vv * 0.5))
            scol.append((w, f["phase"], f["rand"], 0.5))
        sf.append((b0, b0 + 1, b0 + 2, b0 + 3))
        # anther: small octahedron
        b1 = len(sv)
        r = 0.045
        for d in (Vector((r, 0, 0)), Vector((-r, 0, 0)), Vector((0, r, 0)), Vector((0, -r, 0)),
                  Vector((0, 0, r * 1.3)), Vector((0, 0, -r * 0.8))):
            sv.append(f["pos"] + rot @ ((tip + d) * s))
            suv.append((0.75, 0.75))
            scol.append((w, f["phase"], f["rand"], 0.55))
        for tri in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            sf.append(tuple(b1 + t for t in tri))

blossom_obj = make_mesh("Blossoms", fv, ff, fuv, fcol)
stamen_obj = make_mesh("Stamens", sv, sf, suv, scol)
print(f"[blossom] bark tris~{len(faces) * 2} petal tris~{len(ff) * 2} stamen tris~{len(sf) * 2}")

# ───────────────────────────── Textures ─────────────────────────────
tex_dir = os.path.join(bpy.app.tempdir or os.path.dirname(OUT), "blossom_tex")
os.makedirs(tex_dir, exist_ok=True)


def save_image(name, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=True)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    path = os.path.join(tex_dir, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return img


# petal colour texture (sRGB): deep crimson base → soft rose → pale tip, with fine veins
N = 512
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / (N - 1)   # yy = v (base→tip), xx = u
v = yy
u = xx * 2 - 1
base = np.array([0.42, 0.035, 0.06])
mid = np.array([0.86, 0.42, 0.47])
tip = np.array([0.95, 0.72, 0.74])
t1 = np.clip(v / 0.55, 0, 1)[..., None]
t2 = np.clip((v - 0.55) / 0.45, 0, 1)[..., None]
col = base * (1 - t1) + mid * t1
col = col * (1 - t2) + tip * t2
ang = np.arctan2(u * 0.9, v + 0.15)
veins = 0.5 + 0.5 * np.cos(ang * 26.0 + np.sin(v * 9.0) * 0.6)
veins = veins ** 6 * np.clip(v * 1.6, 0, 1) * (1 - v * 0.6)
col = col * (1.0 - 0.18 * veins[..., None])
edge = np.clip(1.0 - np.abs(u), 0, 1) ** 0.25
col = col * (0.82 + 0.18 * edge[..., None])
noise = np.random.default_rng(SEED).normal(0, 0.012, (N, N, 1))
col = np.clip(col + noise, 0, 1)
rgba = np.concatenate([col, np.ones((N, N, 1))], axis=2)
petal_img = save_image("petal_diffuse", rgba)

stamen = np.zeros((64, 64, 4), dtype=np.float32)
stamen[..., 3] = 1
stamen[:, :32, :3] = [0.85, 0.62, 0.6]     # filament (u<0.5)
stamen[:, 32:, :3] = [0.55, 0.16, 0.06]    # anther (u>0.5)
stamen_img = save_image("stamen_diffuse", stamen)

# ───────────────────────────── Materials ─────────────────────────────


def principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    return m, nt, bsdf


def tex_node(nt, path_or_img, non_color=False):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = path_or_img if isinstance(path_or_img, bpy.types.Image) else bpy.data.images.load(path_or_img)
    if non_color:
        n.image.colorspace_settings.name = "Non-Color"
    return n


bark_mat, nt, bsdf = principled("Bark")
d = tex_node(nt, os.path.join(BARK_DIR, "bark_brown_02_diff_1k.jpg"))
nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
r = tex_node(nt, os.path.join(BARK_DIR, "bark_brown_02_rough_1k.jpg"), True)
nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
nm = tex_node(nt, os.path.join(BARK_DIR, "bark_brown_02_nor_gl_1k.jpg"), True)
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Metallic"].default_value = 0.0
bark_obj.data.materials.append(bark_mat)

petal_mat, nt, bsdf = principled("Petal")
p = tex_node(nt, petal_img)
nt.links.new(p.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.62
bsdf.inputs["Metallic"].default_value = 0.0
petal_mat.use_backface_culling = False
blossom_obj.data.materials.append(petal_mat)

stamen_mat, nt, bsdf = principled("Stamen")
s_ = tex_node(nt, stamen_img)
nt.links.new(s_.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.55
stamen_obj.data.materials.append(stamen_mat)

# ───────────────────────────── Export ─────────────────────────────
for o in bpy.context.scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=90,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_materials="EXPORT",
    use_selection=False,
)
print(f"[blossom] wrote {OUT}")
