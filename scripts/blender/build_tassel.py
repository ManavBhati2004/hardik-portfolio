"""
Headless Blender script: builds the silk sword tassel (sageo-style cord + fringe).

  blender -b --factory-startup -P build_tassel.py -- <out.glb>

Units are metres; the attach point is the origin and the tassel hangs along -Z (Blender),
i.e. -Y after glTF export. Vertex colour COLOR_0:
  R = hang weight 0..1 (0 at the attach point, 1 at the fringe tips)
  G = per-strand random 0..1
"""
import sys
import os
import math
import random

import bpy
import numpy as np
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
rng = random.Random(5)

bpy.ops.wm.read_factory_settings(use_empty=True)

TOTAL = 0.36
verts, faces, uvs, cols = [], [], [], []


def perp(v):
    a = Vector((0, 0, 1)) if abs(v.z) < 0.9 else Vector((1, 0, 0))
    return v.cross(a).normalized()


def tube(path, radius_fn, segs, uv_scale, rand_g, twist=0.0):
    base = len(verts)
    n = len(path)
    nrm = perp((path[1] - path[0]).normalized())
    prev_t = None
    total = 0.0
    for i, p in enumerate(path):
        t = (path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized()
        if prev_t is not None:
            ax = prev_t.cross(t)
            if ax.length > 1e-7:
                nrm = Quaternion(ax.normalized(), math.asin(min(1.0, ax.length))) @ nrm
        nrm = (nrm - t * nrm.dot(t)).normalized()
        b = t.cross(nrm)
        prev_t = t
        if i > 0:
            total += (path[i] - path[i - 1]).length
        r = radius_fn(i / (n - 1))
        for j in range(segs + 1):
            a = 2 * math.pi * j / segs + twist * total
            off = (nrm * math.cos(a) + b * math.sin(a)) * r
            v = p + off
            verts.append(v)
            uvs.append((j / segs, total * uv_scale))
            cols.append((min(1.0, max(0.0, -v.z / TOTAL)), rand_g, 0.0, 1.0))
    for i in range(n - 1):
        for j in range(segs):
            a = base + i * (segs + 1) + j
            c = a + segs + 1
            faces.append((a, a + 1, c + 1, c))


def bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(p0 * (1 - t) ** 3 + p1 * 3 * (1 - t) ** 2 * t + p2 * 3 * (1 - t) * t * t + p3 * t ** 3)
    return out


# 1. cord: two twisted plies following a gentle hanging curve
cord_path = bezier(Vector((0, 0, 0)), Vector((0.012, 0.004, -0.07)), Vector((0.03, -0.004, -0.15)),
                   Vector((0.03, 0, -0.205)), 48)
for ply in range(2):
    ph = ply * math.pi
    path = []
    for i, p in enumerate(cord_path):
        a = ph + i * 0.55
        t = (cord_path[min(i + 1, 48)] - cord_path[max(i - 1, 0)]).normalized()
        n1 = perp(t)
        n2 = t.cross(n1)
        path.append(p + (n1 * math.cos(a) + n2 * math.sin(a)) * 0.0021)
    tube(path, lambda s: 0.0026, 8, 60.0, 0.1 * ply)

# 2. knot (head of the tassel): a slightly squashed bulb
head_c = Vector((0.03, 0, -0.218))
hb = len(verts)
rings, segs = 10, 16
for i in range(rings + 1):
    th = math.pi * i / rings
    for j in range(segs + 1):
        ph = 2 * math.pi * j / segs
        rr = 0.0125 * (1.0 + 0.08 * math.sin(ph * 6))
        v = head_c + Vector((math.sin(th) * math.cos(ph) * rr, math.sin(th) * math.sin(ph) * rr,
                             math.cos(th) * 0.014))
        verts.append(v)
        uvs.append((j / segs * 2, i / rings))
        cols.append((min(1.0, -v.z / TOTAL), 0.3, 0.0, 1.0))
for i in range(rings):
    for j in range(segs):
        a = hb + i * (segs + 1) + j
        c = a + segs + 1
        faces.append((a, a + 1, c + 1, c))

# 3. binding band below the head
band = [head_c + Vector((0, 0, -0.012 - 0.0012 * k)) for k in range(12)]
tube(band, lambda s: 0.0118 + 0.0006 * math.sin(s * math.pi * 6), 20, 8.0, 0.5)

# 4. fringe: bundles of fine silk strands flaring slightly and hanging down
top_z = head_c.z - 0.026
for k in range(96):
    a = rng.uniform(0, 2 * math.pi)
    rr = math.sqrt(rng.random()) * 0.0105
    start = Vector((head_c.x + math.cos(a) * rr, head_c.y + math.sin(a) * rr, top_z))
    length = rng.uniform(0.105, 0.125)
    flare = 0.012 + rr * 0.6
    end = start + Vector((math.cos(a) * flare, math.sin(a) * flare, -length))
    mid1 = start + Vector((math.cos(a) * flare * 0.4, math.sin(a) * flare * 0.4, -length * 0.33))
    mid2 = start + Vector((math.cos(a) * flare * 0.85, math.sin(a) * flare * 0.85, -length * 0.7))
    tube(bezier(start, mid1, mid2, end, 7), lambda s: 0.00105 * (1 - s * 0.45), 4, 40.0, rng.random())

me = bpy.data.meshes.new("Tassel")
me.from_pydata([tuple(v) for v in verts], [], faces)
me.update()
uv = me.uv_layers.new(name="UVMap")
for poly in me.polygons:
    poly.use_smooth = True
    for li in poly.loop_indices:
        uv.data[li].uv = uvs[me.loops[li].vertex_index]
ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
for i, c in enumerate(cols):
    ca.data[i].color = c
me.color_attributes.active_color = ca
obj = bpy.data.objects.new("Tassel", me)
bpy.context.scene.collection.objects.link(obj)
print(f"[tassel] verts={len(verts)} tris~{len(faces) * 2}")

# silk texture: fine twisted-thread pattern (colour + matching normal map)
N = 256
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
threads = 0.5 + 0.5 * np.sin((xx * 12 + yy * 24) * 2 * math.pi)
fibres = 0.5 + 0.5 * np.sin((xx * 96 + yy * 6) * 2 * math.pi)
height = threads * 0.75 + fibres * 0.25
base = np.array([0.42, 0.018, 0.028])
col = base[None, None, :] * (0.72 + 0.4 * height[..., None])
rgba = np.concatenate([np.clip(col, 0, 1), np.ones((N, N, 1))], axis=2)
gy, gx = np.gradient(height)
nx, ny = -gx * 6.0, -gy * 6.0
nz = np.ones_like(nx)
ln = np.sqrt(nx * nx + ny * ny + nz * nz)
nmap = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, np.ones_like(nx)], axis=2)

tex_dir = os.path.join(bpy.app.tempdir or os.path.dirname(OUT), "tassel_tex")
os.makedirs(tex_dir, exist_ok=True)


def save(name, arr, non_color=False):
    img = bpy.data.images.new(name, width=N, height=N, alpha=True)
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.filepath_raw = os.path.join(tex_dir, name + ".png")
    img.file_format = "PNG"
    img.save()
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


mat = bpy.data.materials.new("Silk")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
tc = nt.nodes.new("ShaderNodeTexImage")
tc.image = save("silk_diffuse", rgba)
nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
tn = nt.nodes.new("ShaderNodeTexImage")
tn.image = save("silk_normal", nmap, True)
nm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Roughness"].default_value = 0.48
bsdf.inputs["Metallic"].default_value = 0.0
obj.data.materials.append(mat)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_image_format="AUTO",
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_vertex_color="ACTIVE",
    export_all_vertex_colors=False,
    export_materials="EXPORT",
)
print(f"[tassel] wrote {OUT}")
