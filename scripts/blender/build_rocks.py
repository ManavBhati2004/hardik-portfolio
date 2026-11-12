"""
Headless Blender script: builds the procedural shoreline rocks.

  blender -b --factory-startup -P build_rocks.py -- <raw_out_dir> <preview.png> [rock_name ...]

Then compress each raw GLB like the other runtime models (meshopt + webp):
  npx @gltf-transform/cli@4 optimize <raw>/<name>.glb public/models/rocks/<name>.opt.glb \
      --compress meshopt --texture-compress webp --texture-size 1024

Per rock:
  1. a few ellipsoid lumps, voxel-remeshed into one closed shell
  2. fracture facets: random planes shave the shell flat (sharp, planar faces)
  3. fine voxel remesh, then voronoi cracks, fbm noise and (for layered rock) strata grooves
     displaced along the normal -> high-poly sculpt (~200k faces)
  4. low-poly game mesh (decimated, underside removed), smart UVs
  5. Cycles bakes high -> low: tangent normal map, AO, albedo, roughness
     (AO in R and roughness in G of one ORM texture, glTF-style)
  6. moss mask in COLOR_0 (up-facing, sheltered crevices, noise breakup, never at the base)

Each rock is fitted to the bounding box of the scan it replaces, so the placements in
src/components/Environment.tsx keep the same footprint.
Blender is Z-up; the glTF exporter writes Y-up (gltf x, y, z = blender x, z, -y).
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_DIR = argv[0]
PREVIEW = argv[1]
ONLY = set(argv[2:])
os.makedirs(OUT_DIR, exist_ok=True)

# glTF bounds (min, max) of the scans being replaced -> blender box
def gbox(gmin, gmax):
    return (Vector((gmin[0], -gmax[2], gmin[1])), Vector((gmax[0], -gmin[2], gmax[1])))


# lumps: (centre, radii) in normalised box coords [-1, 1]; cuts: number of fracture planes
ROCKS = [
    # torii headland: broad layered mass with a flat bench where the torii stands
    dict(name="headland_a", box=gbox((-1.853, -0.25, -2.102), (2.188, 1.079, 1.646)), seed=11,
         lumps=[((0.0, 0.0, -0.3), (0.85, 0.8, 1.0)), ((-0.45, -0.35, -0.4), (0.55, 0.6, 0.9)),
                ((0.5, 0.45, -0.35), (0.5, 0.5, 0.8)), ((-0.35, 0.55, 0.0), (0.45, 0.4, 1.0))],
         cuts=14, strata=1.0, detail=0.42, tris=7000, flat_top=(0.172, 0.05, 0.98, 0.62)),
    dict(name="headland_b", box=gbox((-1.853, -0.25, -2.102), (2.188, 1.079, 1.646)), seed=23,
         lumps=[((0.1, 0.0, -0.3), (0.8, 0.75, 1.0)), ((-0.5, 0.3, -0.5), (0.5, 0.6, 0.8)),
                ((0.45, -0.5, -0.5), (0.5, 0.45, 0.7))],
         cuts=16, strata=0.8, detail=0.42, tris=6500),
    dict(name="headland_c", box=gbox((-1.853, -0.25, -2.102), (2.188, 1.079, 1.646)), seed=37,
         lumps=[((-0.15, 0.1, -0.25), (0.7, 0.85, 1.0)), ((0.55, -0.2, -0.5), (0.45, 0.6, 0.75)),
                ((-0.6, -0.55, -0.6), (0.4, 0.4, 0.6))],
         cuts=18, strata=0.6, detail=0.42, tris=6500),
    # low boulders / slabs for the foreground
    dict(name="boulder_a", box=gbox((-1.185, -0.059, -0.608), (1.348, 0.824, 0.626)), seed=5,
         lumps=[((0.0, 0.0, -0.35), (0.95, 0.9, 1.1)), ((-0.4, 0.2, -0.3), (0.55, 0.65, 0.9))],
         cuts=12, strata=0.25, detail=0.32, tris=5000),
    dict(name="boulder_b", box=gbox((-1.185, -0.059, -0.608), (1.348, 0.824, 0.626)), seed=71,
         lumps=[((0.05, 0.0, -0.3), (0.9, 0.95, 1.05)), ((0.5, -0.3, -0.5), (0.5, 0.55, 0.7))],
         cuts=15, strata=0.0, detail=0.32, tris=5000),
    # distant cliff wall behind the torii (mostly in fog)
    dict(name="cliff", box=gbox((-47.426, -0.644, -9.024), (39.344, 10.351, 15.214)), seed=91,
         lumps=[((-0.55, 0.0, -0.3), (0.5, 0.75, 1.1)), ((0.0, 0.1, -0.2), (0.45, 0.8, 1.15)),
                ((0.5, -0.05, -0.35), (0.5, 0.7, 1.0)), ((-0.2, 0.45, -0.5), (0.6, 0.45, 0.8)),
                ((0.8, 0.3, -0.6), (0.3, 0.5, 0.6)), ((-0.85, -0.3, -0.6), (0.2, 0.5, 0.6))],
         cuts=22, strata=1.2, detail=4.5, tris=9000),
    # distant low shoreline on the left: a spread of flat ledges
    dict(name="shoreline", box=gbox((-32.147, -1.98, -26.895), (27.349, 1.318, 15.626)), seed=53,
         lumps=[((-0.6, -0.4, -0.2), (0.35, 0.3, 1.0)), ((-0.1, -0.2, -0.1), (0.4, 0.35, 1.1)),
                ((0.45, -0.45, -0.3), (0.35, 0.3, 0.9)), ((0.2, 0.3, -0.2), (0.4, 0.35, 1.0)),
                ((-0.45, 0.45, -0.35), (0.35, 0.35, 0.8)), ((0.75, 0.2, -0.4), (0.25, 0.4, 0.8)),
                ((-0.85, 0.0, -0.5), (0.18, 0.4, 0.6)), ((0.05, 0.75, -0.5), (0.4, 0.22, 0.6))],
         cuts=18, strata=0.9, detail=3.2, tris=8000),
]
TEX = 1024


# ───────────────────────────── helpers ─────────────────────────────
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def norm01(a):
    a = np.asarray(a, dtype=np.float64)
    return (a - a.mean()) / (a.std() + 1e-9)


def fbm(P, scale, offset, octaves=4):
    return norm01([noise.fractal(Vector(p) * scale + offset, 1.0, 2.0, octaves, noise_basis="PERLIN_ORIGINAL") for p in P])


def mesh_arrays(me):
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    nr = np.empty(n * 3)
    me.vertices.foreach_get("normal", nr)
    return co.reshape(-1, 3), nr.reshape(-1, 3)


def set_co(me, co):
    me.vertices.foreach_set("co", co.reshape(-1))
    me.update()


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def eval_copy(obj, name):
    """apply all modifiers by evaluating into a new mesh"""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    me.name = name
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return obj


def remesh(obj, voxel):
    m = obj.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = voxel
    m.use_smooth_shade = True
    return eval_copy(obj, obj.name)


def surface_area(me):
    return sum(p.area for p in me.polygons)


def drop_islands(obj, keep_frac=0.02):
    """delete loose shells smaller than keep_frac of the vertex count (voxel-remesh crumbs)"""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    shells = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            c = stack.pop()
            comp.append(c)
            for e in c.link_edges:
                o = e.other_vert(c)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        shells.append(comp)
    small = [v for comp in shells if len(comp) < keep_frac * len(bm.verts) for v in comp]
    if small:
        bmesh.ops.delete(bm, geom=small, context="VERTS")
        bm.to_mesh(obj.data)
        obj.data.update()
    bm.free()
    return len(shells)


def select_only(*objs, active=None):
    for o in bpy.context.scene.objects:
        if o is not None:
            o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[-1]


# ───────────────────────────── cycles setup ─────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
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
                print(f"[rocks] baking on {dev_type}")
                break
        except TypeError:
            continue
except Exception as e:  # noqa: BLE001
    print("[rocks] GPU unavailable, baking on CPU:", e)
scene.cycles.samples = 64
scene.render.bake.margin = 8


# ───────────────────────────── build one rock ─────────────────────────────
def build(spec):
    name = spec["name"]
    rng = random.Random(spec["seed"])
    bmin, bmax = spec["box"]
    centre = (bmin + bmax) / 2
    half = (bmax - bmin) / 2
    s = spec["detail"]
    off = Vector((spec["seed"] * 7.13, spec["seed"] * 3.71, spec["seed"] * 1.93))
    print(f"[rocks] ── {name}")

    # 1. lumps -> one shell
    bm = bmesh.new()
    for (c, r) in spec["lumps"]:
        jitter = Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
        loc = Vector((centre.x + (c[0] + jitter.x) * half.x, centre.y + (c[1] + jitter.y) * half.y, bmin.z + (c[2] + 1) * half.z))
        mat = Matrix.Translation(loc) @ Matrix.Rotation(rng.uniform(-0.4, 0.4), 4, "Z") @ Matrix.Diagonal(
            (r[0] * half.x, r[1] * half.y, r[2] * half.z, 1.0))
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0, matrix=mat)
    me = bpy.data.meshes.new(name + "_high")
    bm.to_mesh(me)
    bm.free()
    high = link(bpy.data.objects.new(name + "_high", me))
    diag = (bmax - bmin).length
    high = remesh(high, diag / 120)

    # 2. fracture facets: shave the shell with random planes
    co, _ = mesh_arrays(high.data)
    rel = (co - np.array(centre)) / np.array(half)  # normalised coords for plane directions
    for i in range(spec["cuts"]):
        # mostly side / upper planes; the underside is hidden in the water
        theta = rng.uniform(0, 2 * math.pi)
        elev = rng.uniform(-0.15, 0.85)
        n = np.array([math.cos(theta) * math.cos(elev), math.sin(theta) * math.cos(elev), math.sin(elev)])
        n_real = n / np.array(half)  # plane in normalised space -> real space normal
        n_real /= np.linalg.norm(n_real)
        d = co @ n_real
        cut = np.quantile(d, rng.uniform(0.74, 0.94))
        over = d > cut
        co[over] -= np.outer(d[over] - cut, n_real)
    if "flat_top" in spec:
        fx, fy, fz, fr = spec["flat_top"]
        # a level bench (where the torii stands): clamp everything above fz near (fx, fy)
        dist = np.hypot(co[:, 0] - fx, co[:, 1] - fy)
        bench = (dist < fr * 1.6) & (co[:, 2] > fz)
        co[bench, 2] = fz + (co[bench, 2] - fz) * smoothstep(fr, fr * 1.6, dist[bench])
    set_co(high.data, co)
    del rel

    # 3. fine remesh + displacement
    area = surface_area(high.data)
    high = remesh(high, math.sqrt(area / 220000))
    drop_islands(high)
    co, nr = mesh_arrays(high.data)
    P = co / s
    print(f"[rocks] {name}: {len(co)} high verts")
    base = fbm(P, 0.9, off, 4)
    fine = fbm(P, 2.6, off + Vector((9, 1, 3)), 3)
    # domain-warped voronoi: F2-F1 gives fracture lines, a per-cell random gives stepped plates
    edge = np.empty(len(P))
    plate = np.empty(len(P))
    for i, p in enumerate(P):
        v = Vector(p)
        q = v * 1.1 + off + noise.noise_vector(v * 0.8 + off) * 0.45
        d, pts = noise.voronoi(q, distance_metric="DISTANCE")
        edge[i] = d[1] - d[0]
        plate[i] = noise.cell(pts[0])
    plate = norm01(plate)
    crack_mask = smoothstep(0.1, 1.1, fbm(P, 0.4, off + Vector((2, 7, 5)), 2))
    crack = (1.0 - smoothstep(0.0, 0.05, edge)) * crack_mask
    plate_k = smoothstep(-0.4, 0.8, fbm(P, 0.3, off + Vector((6, 1, 2)), 2))
    groove = np.zeros(len(co))
    if spec["strata"] > 0:
        layer = co[:, 2] / (s * 0.38) + 0.9 * fbm(P, 0.35, off + Vector((4, 4, 4)), 2)
        w = np.abs(layer - np.round(layer))
        groove = (1.0 - smoothstep(0.0, 0.11, w)) * spec["strata"]
    # sideways faces carry the strata, up-facing ones stay as weathered benches
    side = 1.0 - smoothstep(0.3, 0.6, np.abs(nr[:, 2]))
    disp = s * (0.05 * base + 0.007 * fine + 0.03 * plate * plate_k - 0.04 * crack - 0.05 * groove * side)
    co += nr * disp[:, None]
    set_co(high.data, co)

    # fit exactly to the target box
    co, nr = mesh_arrays(high.data)
    lo, hi = co.min(0), co.max(0)
    co = np.array(bmin) + (co - lo) / (hi - lo) * np.array(bmax - bmin)
    set_co(high.data, co)
    co, nr = mesh_arrays(high.data)

    # per-vertex albedo / roughness for the bake (linear values)
    tone = fbm(P, 0.6, off + Vector((5, 2, 8)), 3)
    hue = fbm(P, 0.25, off + Vector((1, 9, 4)), 2)
    grey = np.array([0.30, 0.295, 0.285])
    warm = np.array([0.33, 0.30, 0.265])
    cool = np.array([0.265, 0.275, 0.285])
    t_h = smoothstep(-1.2, 1.2, hue)[:, None]
    # cool grey -> grey -> warm grey, by a slow patch noise
    col = np.where(t_h > 0.5, grey + (warm - grey) * (t_h - 0.5) * 2, cool + (grey - cool) * t_h * 2)
    col = col * (1 + 0.28 * np.clip(tone, -2, 2))[:, None]
    col *= (1 - 0.22 * crack)[:, None]
    col *= (1 - 0.15 * groove * side)[:, None]
    col *= (1 + 0.1 * np.clip(nr[:, 2], 0, 1))[:, None]
    rough = np.clip(0.8 + 0.06 * np.clip(fine, -2, 2) + 0.12 * crack - 0.05 * np.clip(nr[:, 2], 0, 1), 0.55, 1.0)
    attr = high.data.color_attributes.new("rockdata", "FLOAT_COLOR", "POINT")
    data = np.concatenate([np.clip(col, 0, 1), rough[:, None]], axis=1)
    attr.data.foreach_set("color", data.reshape(-1).astype(np.float32))
    for p in high.data.polygons:
        p.use_smooth = True

    # 4. low poly
    low_me = high.data.copy()
    low_me.name = name
    low = link(bpy.data.objects.new(name, low_me))
    low.data.color_attributes.remove(low.data.color_attributes["rockdata"])
    tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
    m = low.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = min(1.0, spec["tris"] / tris)
    m.use_collapse_triangulate = True
    low = eval_copy(low, name)
    # drop the flat underside (always under water) so it does not take texture space
    bm = bmesh.new()
    bm.from_mesh(low.data)
    zmin = min(v.co.z for v in bm.verts)
    hgt = bmax.z - bmin.z
    under = [f for f in bm.faces if f.normal.z < -0.6 and all(v.co.z < zmin + hgt * 0.04 for v in f.verts)]
    bmesh.ops.delete(bm, geom=under, context="FACES")
    bm.to_mesh(low.data)
    bm.free()
    drop_islands(low)
    for p in low.data.polygons:
        p.use_smooth = True
    print(f"[rocks] {name}: low {sum(len(p.vertices) - 2 for p in low.data.polygons)} tris")

    select_only(low)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, area_weight=0.6)
    bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    # 5. bake
    hmat = bpy.data.materials.new(name + "_bake_src")
    nt = hmat.node_tree
    bsdf = nt.nodes.get("Principled BSDF") or nt.nodes.new("ShaderNodeBsdfPrincipled")
    att = nt.nodes.new("ShaderNodeAttribute")
    att.attribute_name = "rockdata"
    tc = nt.nodes.new("ShaderNodeTexCoord")
    speck = nt.nodes.new("ShaderNodeTexNoise")
    speck.inputs["Scale"].default_value = 9.0 / s
    speck.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], speck.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.35
    ramp.inputs["From Max"].default_value = 0.65
    ramp.inputs["To Min"].default_value = 0.94
    ramp.inputs["To Max"].default_value = 1.06
    nt.links.new(speck.outputs["Fac"], ramp.inputs["Value"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(att.outputs["Color"], mul.inputs["A"])
    nt.links.new(ramp.outputs["Result"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(att.outputs["Alpha"], bsdf.inputs["Roughness"])
    high.data.materials.append(hmat)

    lmat = bpy.data.materials.new(name)
    lnt = lmat.node_tree
    low.data.materials.append(lmat)

    def new_img(kind, colour):
        img = bpy.data.images.new(f"{name}_{kind}", TEX, TEX, alpha=False, float_buffer=False)
        img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
        return img

    def bake(kind, img, **kw):
        node = lnt.nodes.new("ShaderNodeTexImage")
        node.image = img
        lnt.nodes.active = node
        select_only(high, low, active=low)
        ext = diag * 0.012
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=ext,
                            max_ray_distance=ext * 2.5, margin=8, **kw)
        lnt.nodes.remove(node)
        print(f"[rocks] {name}: baked {kind}")

    img_col = new_img("albedo", True)
    img_nrm = new_img("normal", False)
    img_ao = new_img("ao", False)
    img_rgh = new_img("rough", False)
    bake("DIFFUSE", img_col, pass_filter={"COLOR"})
    bake("NORMAL", img_nrm, normal_space="TANGENT")
    scene.cycles.samples = 96
    bake("AO", img_ao)
    scene.cycles.samples = 64
    bake("ROUGHNESS", img_rgh)

    # pack ORM: R = AO, G = roughness, B = metal (0)
    ao = np.empty(TEX * TEX * 4, dtype=np.float32)
    img_ao.pixels.foreach_get(ao)
    rg = np.empty(TEX * TEX * 4, dtype=np.float32)
    img_rgh.pixels.foreach_get(rg)
    orm = np.zeros((TEX * TEX, 4), dtype=np.float32)
    orm[:, 0] = 0.25 + 0.75 * ao.reshape(-1, 4)[:, 0]  # keep crevices dark but never black
    orm[:, 1] = rg.reshape(-1, 4)[:, 0]
    orm[:, 3] = 1
    img_orm = new_img("orm", False)
    img_orm.pixels.foreach_set(orm.reshape(-1))
    img_orm.update()
    for img in (img_col, img_nrm, img_orm):
        img.pack()
    bpy.data.images.remove(img_ao)
    bpy.data.images.remove(img_rgh)

    # export material: base colour, normal, ORM (glTF occlusion via the glTF Material Output group)
    lnt.nodes.clear()
    out = lnt.nodes.new("ShaderNodeOutputMaterial")
    bs = lnt.nodes.new("ShaderNodeBsdfPrincipled")
    lnt.links.new(bs.outputs[0], out.inputs[0])
    t_col = lnt.nodes.new("ShaderNodeTexImage")
    t_col.image = img_col
    lnt.links.new(t_col.outputs["Color"], bs.inputs["Base Color"])
    t_nrm = lnt.nodes.new("ShaderNodeTexImage")
    t_nrm.image = img_nrm
    nmap = lnt.nodes.new("ShaderNodeNormalMap")
    lnt.links.new(t_nrm.outputs["Color"], nmap.inputs["Color"])
    lnt.links.new(nmap.outputs["Normal"], bs.inputs["Normal"])
    t_orm = lnt.nodes.new("ShaderNodeTexImage")
    t_orm.image = img_orm
    sep = lnt.nodes.new("ShaderNodeSeparateColor")
    lnt.links.new(t_orm.outputs["Color"], sep.inputs["Color"])
    lnt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
    bs.inputs["Metallic"].default_value = 0.0
    grp = bpy.data.node_groups.get("glTF Material Output")
    if grp is None:
        grp = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    gnode = lnt.nodes.new("ShaderNodeGroup")
    gnode.node_tree = grp
    lnt.links.new(sep.outputs["Red"], gnode.inputs["Occlusion"])

    # 6. moss mask (COLOR_0): up-facing, sheltered hollows, noise patches, clear of the base
    co, nr = mesh_arrays(low.data)
    nv = len(co)
    acc = np.zeros((nv, 3))
    cnt = np.zeros(nv)
    ev = np.empty(len(low.data.edges) * 2, dtype=np.int64)
    low.data.edges.foreach_get("vertices", ev)
    ev = ev.reshape(-1, 2)
    np.add.at(acc, ev[:, 0], co[ev[:, 1]])
    np.add.at(acc, ev[:, 1], co[ev[:, 0]])
    np.add.at(cnt, ev[:, 0], 1)
    np.add.at(cnt, ev[:, 1], 1)
    avg = acc / np.maximum(cnt, 1)[:, None]
    elen = np.linalg.norm(co[ev[:, 0]] - co[ev[:, 1]], axis=1).mean()
    concave = smoothstep(0.02, 0.25, np.einsum("ij,ij->i", nr, avg - co) / elen)
    up = smoothstep(0.25, 0.85, nr[:, 2])
    patch = smoothstep(-0.3, 1.0, fbm(co / s, 0.7, off + Vector((3, 3, 9)), 3))
    hfac = smoothstep(bmin.z + hgt * 0.3, bmin.z + hgt * 0.6, co[:, 2])
    moss = np.clip((up * patch + 0.45 * concave * smoothstep(-0.2, 0.4, nr[:, 2])) * hfac, 0, 1)
    cattr = low.data.color_attributes.new("moss", "BYTE_COLOR", "POINT")
    cdata = np.repeat(moss[:, None], 4, axis=1)
    cdata[:, 3] = 1
    cattr.data.foreach_set("color", cdata.reshape(-1).astype(np.float32))
    low.data.color_attributes.active_color = cattr

    # export
    bpy.data.objects.remove(high)
    select_only(low)
    path = os.path.join(OUT_DIR, name + ".glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_image_format="AUTO",
        export_yup=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_vertex_color="NAME", export_vertex_color_name="moss", export_all_vertex_colors=False,
        export_materials="EXPORT")
    print(f"[rocks] wrote {path}")
    # also report the bench height under the torii (glTF y)
    if "flat_top" in spec:
        dg = bpy.context.evaluated_depsgraph_get()
        fx, fy = spec["flat_top"][:2]
        hits = []
        for dx in (-0.16, 0, 0.16):
            r = scene.ray_cast(dg, Vector((fx + dx, fy, 50)), Vector((0, 0, -1)))
            hits.append(round(r[1].z, 3) if r[0] else None)
        print(f"[rocks] {name}: bench heights under torii {hits}")
    bpy.data.objects.remove(low)


for spec in ROCKS:
    if ONLY and spec["name"] not in ONLY:
        continue
    build(spec)


# ───────────────────────────── preview contact sheet ─────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
names = [r["name"] for r in ROCKS if not ONLY or r["name"] in ONLY]
COLS = 4
for i, n in enumerate(names):
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT_DIR, n + ".glb"))
    for o in [o for o in bpy.context.selected_objects if o.type == "MESH"]:
        dims = o.dimensions
        k = 2.2 / max(dims.x, dims.y)
        o.scale = (k, k, k)
        o.location = (0, 0, 0)
        bpy.context.view_layer.update()
        bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mid = sum(bb, Vector()) / 8
        o.location = (i % COLS * 2.7 - mid.x, -mid.y, -(i // COLS) * 2.0 - min(v.z for v in bb))
cols = min(COLS, len(names))
rows = (len(names) + COLS - 1) // COLS
target = Vector(((cols - 1) * 2.7 / 2, 0, -(rows - 1) * 1.0 + 0.4))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = cols * 2.7 + 0.3
cam.location = target + Vector((0, -12, 3.6))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
scene.collection.objects.link(sun)
world = bpy.data.worlds.new("w")
world.color = (0.05, 0.05, 0.06)
scene.world = world
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 2000
scene.render.resolution_y = 560 * rows + 120
scene.render.filepath = PREVIEW
scene.view_settings.view_transform = "AgX"
bpy.ops.render.render(write_still=True)
print("[rocks] preview", PREVIEW)
