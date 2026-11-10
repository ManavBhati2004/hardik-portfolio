"""Build the demo orbital station — a reference model for the whole pipeline.

    blender --background --factory-startup --python demo_station.py -- <out.blend>

Demonstrates the patterns the skill teaches, in one self-contained script:
- one bmesh per material  -> one object per material per animation root (low draw calls)
- lathe / sweep / oriented-box primitives with normals recalculated
- sharp-by-angle shading so hard-surface edges stay crisp in glTF
- driver-free rotation pivots (named *_Pivot, re-driven in JS)
- a keyframed action (dish sweep) that exports as a glTF animation clip
- material names that the web viewer keys shader patches and strobes on
- emissive light signatures per zone (warm habitat, green agri, cyan structure)

Everything is deterministic (hash jitter), idempotent, and validated before save.
"""
import bpy, bmesh, json, math, sys
from pathlib import Path
from mathutils import Matrix, Vector

OUT = Path(sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "demo-station-v001.blend").resolve()
TAU = math.tau


def h(*seeds):  # deterministic hash noise in [-1, 1]
    s = sum(v * w for v, w in zip(seeds, (12.9898, 78.233, 37.719, 4.581)))
    return (math.sin(s) * 43758.5453 % 1.0) * 2 - 1


# ------------------------------------------------------------------ materials
MATS = {
    #  name            base                 metal rough emission            strength
    "Hull":          ((0.62, 0.63, 0.65), 0.55, 0.34, None, 0),
    "HullDark":      ((0.045, 0.048, 0.055), 0.8, 0.42, None, 0),
    "Accent":        ((0.85, 0.28, 0.05), 0.0, 0.48, None, 0),
    "SolarPanel":    ((0.015, 0.03, 0.09), 0.85, 0.22, None, 0),
    "Radiator":      ((0.82, 0.82, 0.8), 0.0, 0.62, None, 0),
    "Window_Warm":   ((0.05, 0.04, 0.03), 0.0, 0.2, (1.0, 0.55, 0.24), 3.2),
    "Window_Garden": ((0.03, 0.05, 0.03), 0.0, 0.3, (0.4, 1.0, 0.45), 2.4),
    "Strip_Cool":    ((0.02, 0.03, 0.04), 0.0, 0.3, (0.3, 0.75, 1.0), 5.0),
    "Engine_Glow":   ((0.0, 0.0, 0.0), 0.0, 0.5, (0.35, 0.65, 1.0), 25.0),
    "Beacon_Red":    ((0.1, 0.0, 0.0), 0.0, 0.4, (1.0, 0.06, 0.04), 12.0),
    "Beacon_Green":  ((0.0, 0.1, 0.0), 0.0, 0.4, (0.1, 1.0, 0.25), 12.0),
    "Beacon_Dock":   ((0.1, 0.1, 0.1), 0.0, 0.4, (1.0, 0.95, 0.85), 12.0),
}


def make_material(name, base, metal, rough, emit, strength):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.node_tree is None:  # 5.x: materials always have nodes; use_nodes is deprecated
        m.use_nodes = True
    m["managed"] = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


# ------------------------------------------------------------------ primitives
def add_box(bm, center, size, rot=Matrix.Identity(3)):
    m = Matrix.Translation(center) @ rot.to_4x4() @ Matrix.Diagonal((*[s / 2 for s in size], 1))
    bmesh.ops.create_cube(bm, size=2.0, matrix=m)


def radial_frame(angle):
    """Rotation whose local Y points radially out at `angle` around the X axis."""
    return Matrix.Rotation(angle, 3, "X")


def add_ring_box(bm, x, r, angle, size):
    """Box sitting at radius r, angle around X; size = (along X, radial, tangential)."""
    rot = radial_frame(angle)
    center = Vector((x, 0, 0)) + rot @ Vector((0, r, 0))
    add_box(bm, center, (size[0], size[1], size[2]), rot)


def lathe(bm, profile, segments, a0=0.0, a1=TAU):
    """Revolve (x, r) profile points around X. r == 0 collapses to a pole vertex."""
    full = abs(a1 - a0 - TAU) < 1e-6
    cols = segments if full else segments + 1
    rows = []
    for x, r in profile:
        if r <= 1e-6:
            rows.append([bm.verts.new((x, 0, 0))] * cols)
            continue
        rows.append([bm.verts.new((x, r * math.cos(a0 + (a1 - a0) * i / segments),
                                   r * math.sin(a0 + (a1 - a0) * i / segments))) for i in range(cols)])
    for ra, rb in zip(rows, rows[1:]):
        for i in range(segments):
            j = (i + 1) % cols
            quad = [ra[i], ra[j], rb[j], rb[i]]
            uniq = list(dict.fromkeys(quad))
            if len(uniq) >= 3:
                bm.faces.new(uniq)
    return rows


def sweep_segment(bm, profile, a0, a1, steps):
    """Closed (x, r) profile swept from a0 to a1 around X, with end caps (a hull module)."""
    rows = lathe(bm, profile + [profile[0]], steps, a0, a1)
    rows = rows[:-1]
    for col in (0, steps):
        cap = [row[col] for row in rows]
        bm.faces.new(cap if col == 0 else list(reversed(cap)))


def add_rod(bm, a, b, radius, segs=10):
    a, b = Vector(a), Vector(b)
    axis = b - a
    rot = axis.to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((a + b) / 2) @ rot
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=radius, radius2=radius,
                          depth=axis.length, matrix=m)


def add_sphere(bm, c, r):
    bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=r, matrix=Matrix.Translation(c))


# ------------------------------------------------------------------ assembly
class Builder:
    """Collects one bmesh per (animation root, material); finishes into one object each."""

    def __init__(self):
        self.parts = {}

    def bm(self, root, mat):
        return self.parts.setdefault((root, mat), bmesh.new())

    def finish(self, roots):
        made = []
        for (root, mat), bm in self.parts.items():
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            me = bpy.data.meshes.new(f"{root}_{mat}")
            bm.to_mesh(me)
            bm.free()
            for p in me.polygons:
                p.use_smooth = True
            me.set_sharp_from_angle(angle=math.radians(38))
            me.materials.append(bpy.data.materials[mat])
            ob = bpy.data.objects.new(f"{root}_{mat}", me)
            ob["managed"] = True
            bpy.context.scene.collection.objects.link(ob)
            ob.parent = roots[root]
            made.append(ob.name)
        return made


def empty(name, parent=None, loc=(0, 0, 0)):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 5
    ob.location = loc
    ob["managed"] = True
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def build():
    for name, spec in MATS.items():
        make_material(name, *spec)

    station = empty("Station")
    roots = {
        "Core": station,
        "RingA": empty("Ring_Pivot_A", station, (14, 0, 0)),
        "RingB": empty("Ring_Pivot_B", station, (-14, 0, 0)),
        "Dish": empty("Dish_Gimbal", station, (32, 0, 9.5)),
    }
    B = Builder()

    # --- core spine: lathe with stepped collars; accent bands on the collars
    spine = [(-58, 0), (-58, 5.5), (-54, 6.5), (-40, 6.5), (-38, 8.5), (-30, 8.5), (-28, 7),
             (-4, 7), (-2, 9.5), (2, 9.5), (4, 7), (26, 7), (28, 8.5), (36, 8.5), (38, 5),
             (46, 5), (48, 3.2), (52, 3.2), (52, 0)]
    lathe(B.bm("Core", "Hull"), spine, 48)
    for x0 in (-38.4, 27.6, -2.4):
        lathe(B.bm("Core", "Accent"), [(x0, 0.1), (x0, 9.6), (x0 + 0.8, 9.6), (x0 + 0.8, 0.1)], 48)
    # docking port + dock beacons
    lathe(B.bm("Core", "HullDark"), [(52, 0), (52, 2.6), (54.5, 2.6), (54.5, 0)], 24)
    for k in range(4):
        a = TAU * k / 4 + TAU / 8
        add_sphere(B.bm("Core", "Beacon_Dock"), (54.6, 2.9 * math.cos(a), 2.9 * math.sin(a)), 0.35)
    # hull greebles: panels and conduits on the spine, deterministic jitter
    for i in range(140):
        x = -26 + 50 * (i / 140) + h(i, 1) * 0.6
        if abs(x) < 5:
            continue
        a = TAU * ((i * 0.618) % 1.0)
        sz = (1.2 + abs(h(i, 2)) * 3.0, 0.35 + abs(h(i, 3)) * 0.5, 0.8 + abs(h(i, 4)) * 2.2)
        mat = "HullDark" if h(i, 5) > 0.35 else "Hull"
        add_ring_box(B.bm("Core", mat), x, 7 + sz[1] / 2, a, sz)
    for k in range(6):  # axial conduits
        a = TAU * k / 6 + 0.2
        add_rod(B.bm("Core", "HullDark"), (-27, 7.4 * math.cos(a), 7.4 * math.sin(a)),
                (25, 7.4 * math.cos(a), 7.4 * math.sin(a)), 0.28, 8)
    # spine light strips (cool) between collars
    for k in range(4):
        a = TAU * k / 4
        add_ring_box(B.bm("Core", "Strip_Cool"), 15, 7.05, a, (20, 0.12, 0.35))
        add_ring_box(B.bm("Core", "Strip_Cool"), -16, 7.05, a, (20, 0.12, 0.35))

    # --- habitat rings (two, counter-rotating): octagonal hull modules with seams
    R_IN, R_OUT, W = 42.0, 50.0, 12.0
    prof = [(-W / 2, R_IN + 1.5), (-W / 2, R_OUT - 1.5), (-W / 2 + 1.5, R_OUT), (W / 2 - 1.5, R_OUT),
            (W / 2, R_OUT - 1.5), (W / 2, R_IN + 1.5), (W / 2 - 1.5, R_IN), (-W / 2 + 1.5, R_IN)]
    MODS, GAP = 32, 0.012
    for ring, zone in (("RingA", "Window_Warm"), ("RingB", "Window_Garden")):
        for m in range(MODS):
            a0 = TAU * m / MODS + GAP
            a1 = TAU * (m + 1) / MODS - GAP
            sweep_segment(B.bm(ring, "Hull"), prof, a0, a1, 4)
            am = (a0 + a1) / 2
            span = (a1 - a0) * R_OUT
            # window bands on both side walls, split into panes (mullions = gaps)
            for side in (-1, 1):
                for p in range(5):
                    ap = a0 + (a1 - a0) * (p + 0.5) / 5
                    add_ring_box(B.bm(ring, zone), side * (W / 2 + 0.05), 46, ap, (0.12, 3.2, span / 5 - 0.5))
                    add_ring_box(B.bm(ring, "HullDark"), side * (W / 2 + 0.06), 44.1, ap, (0.14, 0.5, span / 5 - 0.2))
            # rooftop skylight strip + accent seam caps
            for q in range(4):
                aq = a0 + (a1 - a0) * (q + 0.5) / 4
                add_ring_box(B.bm(ring, zone), 0, R_OUT + 0.04, aq, (W * 0.22, 0.1, span / 4 - 1.2))
            add_ring_box(B.bm(ring, "Accent"), 0, R_OUT + 0.08, a0 - GAP * 0.5, (W - 2.5, 0.2, 0.6))
            # inner-face radiator fins
            if m % 2 == 0:
                add_ring_box(B.bm(ring, "Radiator"), 0, R_IN - 0.9, am, (W * 0.7, 1.8, 0.25))
        # spokes (3 per ring) with strip lights, phase-offset between rings
        for s in range(3):
            a = TAU * s / 3 + (0.0 if ring == "RingA" else TAU / 6)
            dirv = Vector((0, math.cos(a), math.sin(a)))
            add_rod(B.bm(ring, "Hull"), dirv * 7.2, dirv * (R_IN + 0.5), 1.4, 12)
            for side in (-1, 1):
                add_ring_box(B.bm(ring, "Strip_Cool"), side * 1.3, 24, a, (0.14, 33, 0.35))
            add_rod(B.bm(ring, "HullDark"), dirv * 7.0 + Vector((2.2, 0, 0)), dirv * (R_IN + 0.5) + Vector((2.2, 0, 0)), 0.3, 6)
            add_rod(B.bm(ring, "HullDark"), dirv * 7.0 - Vector((2.2, 0, 0)), dirv * (R_IN + 0.5) - Vector((2.2, 0, 0)), 0.3, 6)
        lathe(B.bm(ring, "HullDark"), [(-3, 7.2), (-3, 10.5), (3, 10.5), (3, 7.2)], 40)  # bearing

    # --- solar array mast (along ±Y) and radiators (along ±Z) at the aft end
    for sgn in (-1, 1):
        add_box(B.bm("Core", "HullDark"), (-46, sgn * 36, 0), (1.2, 58, 1.2))
        for p in range(4):
            y = sgn * (14 + p * 13.5)
            add_box(B.bm("Core", "SolarPanel"), (-46, y, 0), (22, 12.6, 0.25))
            add_box(B.bm("Core", "Hull"), (-46, y, 0), (22.4, 0.3, 0.32))
        add_sphere(B.bm("Core", "Beacon_Red" if sgn < 0 else "Beacon_Green"), (-46, sgn * 65.5, 0), 0.6)
        for p in range(3):
            add_box(B.bm("Core", "Radiator"), (-33 - p * 0.1, 0, sgn * (14 + p * 9)), (13, 0.18, 8.2))
        add_box(B.bm("Core", "HullDark"), (-33, 0, sgn * 24), (0.8, 0.8, 34))

    # --- engines: three bells + glow discs
    for k in range(3):
        a = TAU * k / 3 + TAU / 12
        c = Vector((0, 3.6 * math.cos(a), 3.6 * math.sin(a)))
        bell = [(-58.2, 1.1), (-60, 1.6), (-63, 2.4), (-64.5, 2.8), (-64.5, 2.6), (-63, 2.2), (-60, 1.4), (-58.2, 0.9)]
        for mat, prof_pts in (("HullDark", bell),
                              ("Engine_Glow", [(-60.2, 0), (-60.2, 1.35), (-60.0, 1.35), (-60.0, 0)])):
            for row in lathe(B.bm("Core", mat), prof_pts, 24):
                for v in dict.fromkeys(row):
                    v.co += c

    # --- comms dish on a gimbal (keyframed action, exports as a clip)
    lathe(B.bm("Dish", "Hull"), [(0, 0), (0.6, 3), (1.6, 6), (1.9, 6.2), (0.9, 6.0), (0.1, 3), (-0.2, 0)], 36)
    add_rod(B.bm("Dish", "HullDark"), (0, 0, 0), (4, 0, 0), 0.18, 6)
    add_sphere(B.bm("Dish", "Beacon_Red"), (4.2, 0, 0), 0.3)
    add_rod(B.bm("Core", "HullDark"), (32, 0, 7), (32, 0, 9.5), 0.6, 10)
    dish = roots["Dish"]
    dish.rotation_mode = "XYZ"
    dish.rotation_euler = (0, math.radians(-20), 0)
    for f, z in ((1, -50), (120, 50), (240, -50)):
        dish.rotation_euler.z = math.radians(z)
        dish.keyframe_insert("rotation_euler", index=2, frame=f)
    act = dish.animation_data.action
    act.name = "DishSweep"

    objs = B.finish(roots)
    return station, objs


def validate(objs):
    report = {"objects": len(objs), "tris": 0, "materials": sorted(MATS)}
    for n in objs:
        ob = bpy.data.objects[n]
        assert ob.parent is not None, n
        me = ob.data
        assert len(me.polygons) > 0, f"empty mesh {n}"
        me.calc_loop_triangles()
        report["tris"] += len(me.loop_triangles)
    for p in ("Ring_Pivot_A", "Ring_Pivot_B", "Dish_Gimbal"):
        assert bpy.data.objects[p].children, f"{p} has no children"
    assert report["tris"] < 400_000, "demo should stay web-light"
    return report


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, 240
    station, objs = build()
    scene["demo_station_version"] = 1
    report = {"status": "built", "file": str(OUT), **validate(objs)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
    print(json.dumps(report, indent=2))


main()
