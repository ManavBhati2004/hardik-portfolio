"""
Renders a quick look-dev preview of a GLB.
  blender -b --factory-startup -P preview_model.py -- <in.glb> <out.png> [res_x res_y]
"""
import sys
import math
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
rx = int(argv[2]) if len(argv) > 2 else 1280
ry = int(argv[3]) if len(argv) > 3 else 800

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]

# data-only vertex colours (wind weights) must not tint the preview
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type in {"VERTEX_COLOR", "ATTRIBUTE"} or node.bl_idname == "ShaderNodeVertexColor":
            for out_sock in node.outputs:
                for link in list(out_sock.links):
                    nt.links.remove(link)

mn = Vector((1e9, 1e9, 1e9))
mx = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
center = (mn + mx) / 2
size = max((mx - mn).x, (mx - mn).z, 0.01)

scene = bpy.context.scene
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 50
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
dist = size * 1.25
cam.location = center + Vector((0, -dist, size * 0.08))
direction = center - cam.location
cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

key = bpy.data.lights.new("key", "AREA")
key.energy = 400 * size * size
key.size = size * 0.6
k = bpy.data.objects.new("key", key)
k.location = center + Vector((size * 0.6, -size * 0.8, size * 0.9))
k.rotation_euler = (center - k.location).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(k)
rim = bpy.data.lights.new("rim", "AREA")
rim.energy = 300 * size * size
rim.color = (1.0, 0.35, 0.35)
rim.size = size
r = bpy.data.objects.new("rim", rim)
r.location = center + Vector((-size * 0.4, size * 1.0, size * 0.5))
r.rotation_euler = (center - r.location).to_track_quat("-Z", "Y").to_euler()
scene.collection.objects.link(r)

world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.02, 0.025, 1)
scene.world = world

scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = rx
scene.render.resolution_y = ry
scene.render.filepath = out
scene.view_settings.view_transform = "AgX"
bpy.ops.render.render(write_still=True)
print("[preview] wrote", out)
