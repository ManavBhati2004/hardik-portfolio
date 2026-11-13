"""
Headless Blender script: builds the full cherry (sakura) tree that frames the hero.

  blender -b --factory-startup -P build_sakura.py -- <out_raw.glb> <preview.png> [seed] [out.blend]

Then compress like the other runtime models:
  npx @gltf-transform/cli optimize <out_raw.glb> public/models/sakura.glb
      --compress meshopt --texture-compress webp --texture-size 1536
      --simplify false --prune-attributes false   (keeps the file under ~2 MB)

Construction
  - A recursive branch skeleton (trunk → scaffold limbs → branches → twigs), each branch a
    POLY spline in a bevelled Curve object (per-point radius = taper), converted to mesh.
  - The "hero limb" is the exact bough of the previous hero branch
    (build_blossom_branch.py, same seed and growth rules), so the hero framing is unchanged:
    it starts at the origin, where it leaves the trunk. The trunk runs down (−Z) and back-left
    to the shore; the rest of the crown spreads up and to the left, outside the hero frame.
  - Fine flowering spurs (level 4, own random stream) along the outer twigs of the whole tree.
  - Bark: a procedural cherry-bark shader (seamless 4D noise / Voronoi on a torus: vertical
    fissured plates + horizontal lenticels + crustose lichen patches) baked with Cycles into tileable albedo, roughness
    and tangent-space normal maps, mapped with per-branch UVs (u around, v along the branch).

Output (glTF, Y-up after export): a single mesh "Bark" with
  COLOR_0 (float, linear) for the wind shader in three.js:
    R = sway weight: path distance past the trunk fork / hero-limb length (0 on the trunk)
    G = branch phase 0..1,  B = 0,  A = 0
  _TWIG_TIP (float 0..1) = how far out on a flowering twig the vertex is (blossom anchors).
    The same weights are stored in the vertex group "twig_tips" in the .blend.
"""
import sys
import math
import random
import os

import bpy
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])
PREVIEW = os.path.abspath(argv[1])
SEED = int(argv[2]) if len(argv) > 2 else 11
BLEND_OUT = os.path.abspath(argv[3]) if len(argv) > 3 else None
TEX_RES = 2048
rng = random.Random(SEED)          # hero limb: identical stream to build_blossom_branch.py
trng = random.Random(SEED * 7 + 3)  # rest of the tree

bpy.ops.wm.read_factory_settings(use_empty=True)

branches = []


def perp(v):
    a = Vector((0, 0, 1)) if abs(v.z) < 0.9 else Vector((1, 0, 0))
    return v.cross(a).normalized()


# ───────────────────────── Hero limb (verbatim growth rules) ─────────────────────────
# Kept identical to build_blossom_branch.py (including the random draws of its flower
# placement) so the same seed reproduces the exact bough that frames the hero.
H_MAX_LEVEL = 3
H_CHILDREN = {0: 6, 1: 3, 2: 2}
H_WANDER = {0: 0.06, 1: 0.12, 2: 0.16, 3: 0.2}
H_TROPISM = {
    0: (Vector((1.0, 0.0, -0.36)).normalized(), 0.9),
    1: (None, 0.0),
    2: (Vector((0.35, -0.1, 1.0)).normalized(), 0.35),
    3: (Vector((0.2, -0.1, 1.0)).normalized(), 0.5),
}


def h_flower_draws(bud=False):
    # consumes the same random numbers as the old add_flower()
    for _ in range(3):
        rng.uniform(-1, 1)
    rng.random()
    rng.uniform(0.8, 1.15)
    rng.uniform(0, 2 * math.pi)


def grow_hero(start, direction, length, r0, r1, level, dist0, phase):
    n = max(5, int(length / 0.05))
    seg = length / n
    d = direction.normalized()
    p = start.copy()
    pts, radii, dists = [p.copy()], [r0], [dist0]
    for i in range(1, n + 1):
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1) * 0.45, rng.uniform(-1, 1)))
        d = (d + jitter * H_WANDER[level]).normalized()
        pref, rate = H_TROPISM[level]
        if pref is not None:
            d = d.lerp(pref, min(1.0, rate * seg)).normalized()
        d.y -= p.y * 0.04
        d.normalize()
        p = p + d * seg
        t = i / n
        pts.append(p.copy())
        radii.append(r0 + (r1 - r0) * (t ** 0.85))
        dists.append(dist0 + i * seg)
    branches.append(dict(points=pts, radii=radii, dists=dists, phase=phase % 1.0, level=level, kind="hero"))

    if level < H_MAX_LEVEL:
        for _ in range(H_CHILDREN[level]):
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
            grow_hero(base, cdir, clen, cr0, max(0.0035, cr0 * 0.28), level + 1, dists[idx],
                      phase + rng.uniform(0.15, 0.6))

    if level >= 2 or (level == 1 and rng.random() < 0.6):
        cluster = rng.randint(2, 4) if level >= 2 else rng.randint(1, 3)
        for _ in range(cluster):
            for _ in range(3):
                rng.uniform(-1, 1)
            h_flower_draws()
        if rng.random() < 0.7:
            h_flower_draws(True)
        i = int(n * 0.35)
        while i < n - 1:
            if rng.random() < 0.3:
                rng.uniform(0, 2 * math.pi)
                rng.random()
                h_flower_draws()
            i += max(1, int(0.085 / seg))


grow_hero(Vector((0, 0, 0)), Vector((1.0, -0.05, -0.32)), 4.3, 0.105, 0.03, 0, 0.0, 0.0)
grow_hero(Vector((0.15, 0.05, 0.02)), Vector((0.9, 0.1, -0.05)), 2.6, 0.06, 0.018, 1, 0.15, 0.37)
HERO_MAX = max(max(b["dists"]) for b in branches)

# ───────────────────────── Trunk ─────────────────────────
# Blender axes: +X right, −Y toward the hero camera, +Z up. The hero limb leaves the trunk at
# the origin; the trunk leans down, left and toward the camera to the shore (well below the water line in
# the scene, so it reads as planted at any aspect) and continues up into the crown.
TRUNK_CTRL = [
    Vector((-3.0, -1.2, -9.6)),
    Vector((-2.3, -1.0, -7.0)),
    Vector((-1.35, -0.65, -4.2)),
    Vector((-0.55, -0.25, -1.9)),
    Vector((-0.1, 0.06, 0.0)),
    Vector((-0.55, 0.25, 1.35)),
    Vector((-1.05, 0.4, 2.3)),
]


def catmull(ctrl, step):
    pts = []
    ext = [ctrl[0] * 2 - ctrl[1]] + ctrl + [ctrl[-1] * 2 - ctrl[-2]]
    for k in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[k - 1], ext[k], ext[k + 1], ext[k + 2]
        m = max(2, int((p2 - p1).length / step))
        for i in range(m):
            t = i / m
            t2, t3 = t * t, t * t * t
            pts.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    pts.append(ctrl[-1].copy())
    return pts


trunk_pts = catmull(TRUNK_CTRL, 0.08)
trunk_d = [0.0]
for i in range(1, len(trunk_pts)):
    trunk_d.append(trunk_d[-1] + (trunk_pts[i] - trunk_pts[i - 1]).length)
fork_i = min(range(len(trunk_pts)), key=lambda i: trunk_pts[i].length)
FORK_D = trunk_d[fork_i]
TRUNK_LEN = trunk_d[-1]
trunk_r = []
for i, d in enumerate(trunk_d):
    s = d / TRUNK_LEN
    r = 0.36 - 0.2 * s + 0.22 * math.exp(-d / 0.9)  # taper + root flare at the shore
    trunk_r.append(r)
trunk_r[-1] *= 0.6
branches.append(dict(points=trunk_pts, radii=trunk_r, dists=trunk_d, phase=0.0, level=-1, kind="trunk"))

# the hero limb's path distance is measured from the fork
for b in branches:
    if b["kind"] == "hero":
        b["dists"] = [d + FORK_D for d in b["dists"]]

# ───────────────────────── Crown (scaffold limbs) ─────────────────────────
T_CHILDREN = {0: 7, 1: 4, 2: 3}
T_WANDER = {0: 0.05, 1: 0.11, 2: 0.15, 3: 0.2}


def grow_tree(start, direction, length, r0, r1, level, dist0, phase, outward):
    n = max(5, int(length / 0.06))
    seg = length / n
    d = direction.normalized()
    p = start.copy()
    out_h = Vector((outward.x, outward.y, 0.0))
    out_h = out_h.normalized() if out_h.length > 1e-4 else Vector((-1, 0, 0))
    if level == 0:
        pref, rate = (out_h + Vector((0, 0, 0.42))).normalized(), 0.3   # arch outward
    elif level == 1:
        pref, rate = (out_h + Vector((0, 0, 0.05))).normalized(), 0.22  # wide spreading
    else:
        pref, rate = (out_h * 0.45 + Vector((0, 0, 1))).normalized(), 0.4  # twigs turn up
    pts, radii, dists = [p.copy()], [r0], [dist0]
    for i in range(1, n + 1):
        jitter = Vector((trng.uniform(-1, 1), trng.uniform(-1, 1), trng.uniform(-1, 1) * 0.7))
        d = (d + jitter * T_WANDER[level]).normalized()
        d = d.lerp(pref, min(1.0, rate * seg)).normalized()
        p = p + d * seg
        t = i / n
        pts.append(p.copy())
        radii.append(r0 + (r1 - r0) * (t ** 0.85))
        dists.append(dist0 + i * seg)
    branches.append(dict(points=pts, radii=radii, dists=dists, phase=phase % 1.0, level=level, kind="crown"))
    if level < 3:
        for _ in range(T_CHILDREN[level]):
            t = trng.uniform(0.2, 0.95)
            idx = min(n - 1, max(1, int(t * n)))
            tangent = (pts[idx + 1] - pts[idx]).normalized()
            side = Quaternion(tangent, trng.uniform(0, 2 * math.pi)) @ perp(tangent)
            cdir = (Quaternion(side, math.radians(trng.uniform(28, 60))) @ tangent).normalized()
            clen = length * trng.uniform(0.34, 0.6) * (1.0 - t * 0.35)
            if level == 0:
                clen = max(clen, 0.7)
            cr0 = radii[idx] * trng.uniform(0.55, 0.72)
            c_out = (out_h * 0.6 + Vector((cdir.x, cdir.y, 0))).normalized() if level == 0 else out_h
            grow_tree(pts[idx], cdir, clen, cr0, max(0.0035, cr0 * 0.28), level + 1, dists[idx],
                      phase + trng.uniform(0.15, 0.6), c_out)


# (trunk fraction above the fork, initial direction, length, base radius). Every limb heads
# left, up or toward the camera: from the hero frame's top-left corner those all leave the
# frame, so the crown stays out of the hero composition and only the hero limb shows.
SCAFFOLDS = [
    (0.10, Vector((-1.0, -0.15, 0.25)), 5.6, 0.14),
    (0.25, Vector((-0.75, 0.75, 0.35)), 5.2, 0.13),
    (0.38, Vector((-0.6, -0.85, 0.4)), 5.0, 0.125),
    (0.52, Vector((-1.0, 0.35, 0.75)), 4.8, 0.12),
    (0.66, Vector((-0.15, 0.9, 1.0)), 4.4, 0.115),
    (0.80, Vector((0.1, -0.7, 1.0)), 4.2, 0.11),
    (1.00, Vector((-0.55, 0.1, 1.0)), 4.0, 0.1),
]
upper = list(range(fork_i, len(trunk_pts)))
for frac, cdir, length, r0 in SCAFFOLDS:
    i = upper[min(len(upper) - 1, int(frac * (len(upper) - 1)))]
    if i == len(trunk_pts) - 1:
        i -= 1
    grow_tree(trunk_pts[i], cdir, length, r0, 0.022, 0, trunk_d[i], trng.random(), cdir)

# ───────────────────────── Fine spurs (level 4) ─────────────────────────
# Short, thin flowering spurs along the outer twigs of the whole tree (hero limb included),
# like the knobbly short shoots cherries flower on. They use their own random stream, so the
# hero limb and crown above are bit-for-bit unchanged; they only add finer twigs.
srng = random.Random(SEED * 13 + 5)
spurs = []
for b in branches:
    if b["level"] < 2:
        continue
    pts, radii = b["points"], b["radii"]
    n = len(pts)
    for idx in range(max(1, int(n * 0.25)), n - 1):
        if srng.random() > (0.42 if b["level"] == 3 else 0.22):
            continue
        tangent = (pts[idx + 1] - pts[idx]).normalized()
        side = Quaternion(tangent, srng.uniform(0, 2 * math.pi)) @ perp(tangent)
        d = (Quaternion(side, math.radians(srng.uniform(35, 75))) @ tangent).normalized()
        d = (d + Vector((0, 0, 0.35))).normalized()  # spurs turn up a little
        length = srng.uniform(0.05, 0.16)
        r0 = min(radii[idx] * 0.7, 0.0032)
        steps = 3
        p = pts[idx].copy()
        sp, sr, sd = [p.copy()], [r0], [b["dists"][idx]]
        for k in range(1, steps + 1):
            d = (d + Vector((srng.uniform(-1, 1), srng.uniform(-1, 1), srng.uniform(-1, 1))) * 0.25).normalized()
            p = p + d * (length / steps)
            sp.append(p.copy())
            sr.append(r0 + (0.0011 - r0) * k / steps)
            sd.append(sd[-1] + length / steps)
        spurs.append(dict(points=sp, radii=sr, dists=sd, phase=b["phase"], level=4, kind=b["kind"]))
branches.extend(spurs)
print(f"[sakura] spurs={len(spurs)}")

print(f"[sakura] branches={len(branches)} hero_max={HERO_MAX:.3f} trunk_len={TRUNK_LEN:.2f} fork={FORK_D:.2f}")

# ───────────────────────── Curves → mesh ─────────────────────────
# ring resolution per level (round bevel: 4 + 2·res vertices around)
BEVEL_RES = {-1: 8, 0: 5, 1: 3, 2: 2, 3: 1, 4: 0}


def tip_weight(b, t):
    if b["level"] == 4:  # flowering spurs carry blossoms along most of their length
        return min(1.0, 0.45 + t * 0.55)
    if b["level"] >= 2:
        return min(1.0, max(0.0, (t - 0.3) / 0.7)) ** 1.2
    if b["level"] == 1:
        return min(1.0, max(0.0, (t - 0.78) / 0.22)) * 0.7
    return 0.0


def wind_weight(b, dist):
    if b["kind"] == "trunk":
        return 0.0
    return min(1.0, max(0.0, (dist - FORK_D) / HERO_MAX))


parts = []
for res in sorted(set(BEVEL_RES.values()), reverse=True):
    group = [b for b in branches if BEVEL_RES[b["level"]] == res]
    if not group:
        continue
    cu = bpy.data.curves.new(f"BarkCurve_{res}", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_mode = "ROUND"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = res
    cu.use_fill_caps = False
    cu.twist_mode = "MINIMUM"
    for b in group:
        sp = cu.splines.new("POLY")
        sp.points.add(len(b["points"]) - 1)
        last = len(b["points"]) - 1
        for i, (p, r, d) in enumerate(zip(b["points"], b["radii"], b["dists"])):
            if b["kind"] != "trunk":
                r *= 1.0 + 0.06 * math.sin(d * 23.0 + b["phase"] * 9.0)
                if i == last:
                    r *= 0.35
            sp.points[i].co = (p.x, p.y, p.z, 1.0)
            sp.points[i].radius = r
    ob = bpy.data.objects.new(f"BarkCurve_{res}", cu)
    bpy.context.scene.collection.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    me = ob.data
    total_pts = sum(len(b["points"]) for b in group)
    segs = len(me.vertices) // total_pts
    assert segs * total_pts == len(me.vertices), "unexpected curve→mesh layout"

    # per-vertex bookkeeping: rings are contiguous per spline, `segs` vertices per ring
    vinfo = []  # (branch, ring index, j)
    for b in group:
        for i in range(len(b["points"])):
            for j in range(segs):
                vinfo.append((b, i, j))

    cols = []
    tips = []
    for v, (b, i, j) in zip(me.vertices, vinfo):
        c = b["points"][i]
        a = 2 * math.pi * j / segs
        d = b["dists"][i]
        if b["kind"] == "trunk":
            # fluted, furrowed trunk with a broadening root collar
            s = d / TRUNK_LEN
            k = 1.0 + 0.07 * math.sin(a * 6 + d * 0.9) + 0.035 * math.sin(a * 13 + d * 3.1) \
                + 0.12 * math.exp(-d / 0.6) * max(0.0, math.sin(a * 4 + 0.7))
            k *= 1.0 + 0.02 * math.sin(s * 40.0)
        else:
            k = 1.0 + 0.05 * math.sin(a * 7 + d * 11.0)
        v.co = c + (v.co - c) * k
        cols.append((wind_weight(b, d), b["phase"], 0.0, 0.0))
        tips.append(tip_weight(b, i / (len(b["points"]) - 1)))

    ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(cols):
        ca.data[i].color = c
    me.color_attributes.active_color = ca
    ta = me.attributes.new("_twig_tip", "FLOAT", "POINT")
    ta.data.foreach_set("value", tips)
    vg = ob.vertex_groups.new(name="twig_tips")
    for i, w in enumerate(tips):
        if w > 0:
            vg.add([i], w, "REPLACE")

    # UVs: u around (tiled to keep texel density), v along the branch; fix the wrap seam
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name="UVMap")
    tiles = {}
    for b in group:
        tiles[id(b)] = max(1, round(2 * math.pi * b["radii"][0] / 0.35))
    for poly in me.polygons:
        js = [vinfo[me.loops[li].vertex_index][2] for li in poly.loop_indices]
        wrap = max(js) - min(js) > 1
        for li in poly.loop_indices:
            b, i, j = vinfo[me.loops[li].vertex_index]
            jj = segs if (wrap and j == 0) else j
            uv.data[li].uv = (tiles[id(b)] * jj / segs, b["dists"][i] / 0.45)
    me.shade_smooth()
    parts.append(ob)

bpy.ops.object.select_all(action="DESELECT")
for ob in parts:
    ob.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
bark = bpy.context.active_object
bark.name = "Bark"
bark.data.name = "Bark"
print(f"[sakura] bark verts={len(bark.data.vertices)} tris~{len(bark.data.polygons) * 2}")

# ───────────────────────── Procedural bark → baked maps ─────────────────────────
tex_dir = os.path.join(os.path.dirname(OUT), "sakura_tex")
os.makedirs(tex_dir, exist_ok=True)


def build_proc_bark(mat):
    nt = mat.node_tree
    nt.nodes.clear()
    N, L = nt.nodes, nt.links

    def mth(op, a, b=0.0, clamp=False):
        n = N.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        for k, x in enumerate((a, b)):
            if isinstance(x, (int, float)):
                n.inputs[k].default_value = x
            else:
                L.new(x, n.inputs[k])
        return n.outputs[0]

    def smooth(x, lo, hi, a=0.0, b=1.0):
        n = N.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        L.new(x, n.inputs["Value"])
        n.inputs["From Min"].default_value = lo
        n.inputs["From Max"].default_value = hi
        n.inputs["To Min"].default_value = a
        n.inputs["To Max"].default_value = b
        return n.outputs["Result"]

    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["UV"], sep.inputs[0])
    A = mth("MULTIPLY", sep.outputs[0], 2 * math.pi)
    B = mth("MULTIPLY", sep.outputs[1], 2 * math.pi)
    cA, sA, cB, sB = mth("COSINE", A), mth("SINE", A), mth("COSINE", B), mth("SINE", B)

    def torus(ru, rv, off):
        # (u, v) on a torus in 4D → seamless in both directions
        comb = N.new("ShaderNodeCombineXYZ")
        L.new(mth("MULTIPLY", cA, ru), comb.inputs[0])
        L.new(mth("MULTIPLY", sA, ru), comb.inputs[1])
        L.new(mth("ADD", mth("MULTIPLY", cB, rv), off), comb.inputs[2])
        return comb.outputs[0], mth("ADD", mth("MULTIPLY", sB, rv), off * 1.7)

    def noise(ru, rv, off, scale, detail, rough=0.55):
        n = N.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        vec, w = torus(ru, rv, off)
        L.new(vec, n.inputs["Vector"])
        L.new(w, n.inputs["W"])
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        return n

    def voronoi(ru, rv, off, feature, rand=1.0):
        n = N.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "4D"
        n.feature = feature
        vec, w = torus(ru, rv, off)
        # organic warp of the cell lattice
        warp = noise(ru * 1.3, rv * 1.3, off + 5.0, 1.0, 3).outputs["Fac"]
        warped = N.new("ShaderNodeVectorMath")
        warped.operation = "ADD"
        L.new(vec, warped.inputs[0])
        cw = N.new("ShaderNodeCombineXYZ")
        L.new(mth("MULTIPLY", mth("SUBTRACT", warp, 0.5), 0.5), cw.inputs[0])
        L.new(mth("MULTIPLY", mth("SUBTRACT", warp, 0.5), 0.5), cw.inputs[1])
        L.new(cw.outputs[0], warped.inputs[1])
        L.new(warped.outputs[0], n.inputs["Vector"])
        L.new(w, n.inputs["W"])
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Randomness"].default_value = rand
        return n

    # vertical fissures between bark plates (cells long along v)
    fiss = voronoi(1.05, 0.3, 0.0, "DISTANCE_TO_EDGE")
    crack = mth("MULTIPLY", smooth(fiss.outputs["Distance"], 0.0, 0.045, 1.0, 0.0), 0.75)
    # horizontal lenticels (cells long along u) — the cherry-bark signature
    lent = voronoi(0.42, 2.9, 11.0, "F1", 1.0)
    lsep = N.new("ShaderNodeSeparateColor")
    L.new(lent.outputs["Color"], lsep.inputs[0])
    lmask = mth("MULTIPLY", smooth(lent.outputs["Distance"], 0.31, 0.39, 1.0, 0.0),
                smooth(lsep.outputs[0], 0.08, 0.18))
    # horizontal growth bands (lighter, redder strips around the stem)
    bands = noise(0.12, 1.7, 61.0, 1.0, 3, 0.5).outputs["Fac"]
    fine = noise(1.4, 1.4, 23.0, 1.0, 10, 0.6).outputs["Fac"]
    broad = noise(0.35, 0.35, 41.0, 1.0, 4, 0.5).outputs["Fac"]

    height = mth("ADD", mth("MULTIPLY", fine, 0.6), mth("MULTIPLY", crack, -0.45))
    height = mth("ADD", height, mth("MULTIPLY", lmask, 0.22))
    height = mth("ADD", height, mth("MULTIPLY", bands, 0.15))

    # albedo (linear): grey-brown plates with a reddish cast, near-black fissures, tan lenticels
    ramp = N.new("ShaderNodeValToRGB")
    L.new(fine, ramp.inputs["Fac"])
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.32, (0.04, 0.03, 0.028, 1)
    els[1].position, els[1].color = 0.64, (0.17, 0.12, 0.105, 1)
    red = N.new("ShaderNodeMix")
    red.data_type = "RGBA"
    red.blend_type = "MULTIPLY"
    L.new(mth("ADD", smooth(broad, 0.35, 0.7, 0.0, 0.4), smooth(bands, 0.45, 0.7, 0.0, 0.45), clamp=True),
          red.inputs["Factor"])
    L.new(ramp.outputs["Color"], red.inputs["A"])
    red.inputs["B"].default_value = (1.25, 0.8, 0.72, 1)
    dark = N.new("ShaderNodeMix")
    dark.data_type = "RGBA"
    L.new(crack, dark.inputs["Factor"])
    L.new(red.outputs["Result"], dark.inputs["A"])
    dark.inputs["B"].default_value = (0.018, 0.013, 0.012, 1)
    lent_c = N.new("ShaderNodeMix")
    lent_c.data_type = "RGBA"
    L.new(lmask, lent_c.inputs["Factor"])
    L.new(dark.outputs["Result"], lent_c.inputs["A"])
    lent_c.inputs["B"].default_value = (0.24, 0.18, 0.14, 1)
    # crustose lichen: pale grey-green patches with a speckled edge
    lich_n = noise(0.5, 0.5, 77.0, 1.0, 6, 0.62).outputs["Fac"]
    lich = mth("MULTIPLY", smooth(mth("ADD", lich_n, mth("MULTIPLY", fine, 0.25)), 0.66, 0.74), 0.75)
    lich_c = N.new("ShaderNodeMix")
    lich_c.data_type = "RGBA"
    L.new(lich, lich_c.inputs["Factor"])
    L.new(lent_c.outputs["Result"], lich_c.inputs["A"])
    lich_c.inputs["B"].default_value = (0.2, 0.21, 0.17, 1)
    albedo = lich_c.outputs["Result"]
    height = mth("ADD", height, mth("MULTIPLY", lich, 0.12))

    rough = mth("ADD", mth("ADD", 0.58, mth("MULTIPLY", crack, 0.32)), mth("MULTIPLY", fine, 0.12), clamp=True)
    rough = mth("ADD", rough, mth("MULTIPLY", lich, 0.25), clamp=True)

    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.025
    L.new(height, bump.inputs["Height"])

    emit = N.new("ShaderNodeEmission")
    bsdf = N.new("ShaderNodeBsdfPrincipled")
    L.new(albedo, bsdf.inputs["Base Color"])
    L.new(rough, bsdf.inputs["Roughness"])
    L.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    out = N.new("ShaderNodeOutputMaterial")
    return dict(nt=nt, emit=emit, bsdf=bsdf, out=out, albedo=albedo, rough=rough)


def bake_maps():
    scn = bpy.context.scene
    try:
        bpy.ops.preferences.addon_enable(module="cycles")
    except Exception:
        pass
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    scn.cycles.samples = 8
    scn.render.bake.margin = 0
    bpy.ops.mesh.primitive_plane_add(size=2)
    plane = bpy.context.active_object
    mat = bpy.data.materials.new("BarkProcedural")
    plane.data.materials.append(mat)
    g = build_proc_bark(mat)
    nt = g["nt"]
    img_node = nt.nodes.new("ShaderNodeTexImage")
    imgs = {}

    def bake(name, kind, socket=None, non_color=False):
        img = bpy.data.images.new(name, TEX_RES, TEX_RES, alpha=False)
        if non_color:
            img.colorspace_settings.name = "Non-Color"
        img_node.image = img
        nt.nodes.active = img_node
        for l in list(g["out"].inputs["Surface"].links):
            nt.links.remove(l)
        if kind == "EMIT":
            for l in list(g["emit"].inputs["Color"].links):
                nt.links.remove(l)
            nt.links.new(socket, g["emit"].inputs["Color"])
            nt.links.new(g["emit"].outputs[0], g["out"].inputs["Surface"])
            bpy.ops.object.bake(type="EMIT")
        else:
            nt.links.new(g["bsdf"].outputs[0], g["out"].inputs["Surface"])
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
        img.filepath_raw = os.path.join(tex_dir, name + ".png")
        img.file_format = "PNG"
        img.save()
        imgs[name] = img
        print(f"[sakura] baked {name}")

    bpy.ops.object.select_all(action="DESELECT")
    plane.select_set(True)
    bpy.context.view_layer.objects.active = plane
    bake("sakura_bark_diff", "EMIT", g["albedo"])
    bake("sakura_bark_rough", "EMIT", g["rough"], non_color=True)
    bake("sakura_bark_nor", "NORMAL", non_color=True)
    bpy.data.objects.remove(plane, do_unlink=True)
    return imgs


imgs = bake_maps()

bark_mat = bpy.data.materials.new("Bark")
nt = bark_mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")


def tex(img):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    return n


d = tex(imgs["sakura_bark_diff"])
nt.links.new(d.outputs["Color"], bsdf.inputs["Base Color"])
r = tex(imgs["sakura_bark_rough"])
nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
nm = tex(imgs["sakura_bark_nor"])
nmap = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Metallic"].default_value = 0.0
bark.data.materials.clear()
bark.data.materials.append(bark_mat)

# ───────────────────────── Export ─────────────────────────
bpy.ops.object.select_all(action="DESELECT")
bark.select_set(True)
bpy.context.view_layer.objects.active = bark
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_image_quality=92,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_attributes=True,
    export_materials="EXPORT",
)
print(f"[sakura] wrote {OUT}")

# ───────────────────────── Preview render ─────────────────────────
# Look-dev only (not exported): simple blossoms on the twig tips so the crown reads.
prng = random.Random(5)
me = bark.data
tip_attr = me.attributes["_twig_tip"].data
cand = [i for i in range(len(me.vertices)) if tip_attr[i].value > 0.35]
fv, ff = [], []
for _ in range(min(5000, len(cand))):
    vi = prng.choice(cand)
    v = me.vertices[vi]
    s = prng.uniform(0.05, 0.09)
    n = (v.normal + Vector((prng.uniform(-1, 1), prng.uniform(-1, 1), prng.uniform(-1, 1))) * 0.5).normalized()
    t1 = perp(n)
    t2 = n.cross(t1)
    c = v.co + v.normal * s * 0.3
    base = len(fv)
    fv.append(c)
    for k in range(10):
        a = k / 10 * 2 * math.pi
        rr = s * (1.0 if k % 2 == 0 else 0.55)
        fv.append(c + (t1 * math.cos(a) + t2 * math.sin(a)) * rr + n * rr * 0.15)
    for k in range(10):
        ff.append((base, base + 1 + k, base + 1 + (k + 1) % 10))
pm = bpy.data.meshes.new("PreviewBlossoms")
pm.from_pydata([tuple(v) for v in fv], [], ff)
pob = bpy.data.objects.new("PreviewBlossoms", pm)
bpy.context.scene.collection.objects.link(pob)
pmat = bpy.data.materials.new("PreviewPetal")
pb = next(n for n in pmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
pb.inputs["Base Color"].default_value = (1.0, 0.62, 0.7, 1)
pb.inputs["Roughness"].default_value = 0.6
pm.materials.append(pmat)

scene = bpy.context.scene
mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for v in bark.data.vertices:
    if v.co.z < -5.4:
        continue
    mn = Vector((min(mn.x, v.co.x), min(mn.y, v.co.y), min(mn.z, v.co.z)))
    mx = Vector((max(mx.x, v.co.x), max(mx.y, v.co.y), max(mx.z, v.co.z)))
center = (mn + mx) / 2
size = max((mx - mn).x, (mx - mn).z)
print(f"[sakura] bounds min={tuple(round(c, 2) for c in mn)} max={tuple(round(c, 2) for c in mx)}")

cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
cam.location = center + Vector((0.0, -size * 1.45, size * 0.05))
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam


def area(name, energy, color, loc, sz):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    ld.size = sz
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    lo.rotation_euler = (center - lo.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(lo)


area("key", 60 * size * size, (1.0, 0.95, 0.9), center + Vector((size * 0.7, -size * 0.9, size * 0.8)), size * 0.6)
area("fill", 18 * size * size, (0.7, 0.75, 1.0), center + Vector((-size * 0.9, -size * 0.6, size * 0.2)), size)
area("rim", 40 * size * size, (1.0, 0.4, 0.4), center + Vector((-size * 0.2, size * 1.0, size * 0.6)), size)

world = bpy.data.worlds.new("w")
world.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
scene.world = world
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.filepath = PREVIEW
scene.view_settings.view_transform = "AgX"
bpy.ops.render.render(write_still=True)
print(f"[sakura] preview {PREVIEW}")

if BLEND_OUT:
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
