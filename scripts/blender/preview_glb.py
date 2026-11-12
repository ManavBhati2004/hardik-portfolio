"""
Render a quick preview of an exported GLB in a clean scene.

    blender --background --python scripts/blender/preview_glb.py -- model.glb out.png [cam_dist] [target_y] [bg]
"""
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
dist = float(argv[2]) if len(argv) > 2 else 2.2
ty = float(argv[3]) if len(argv) > 3 else 0.25
bg = float(argv[4]) if len(argv) > 4 else 0.35

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
# glTF +Y up becomes Blender +Z up: the target height is along Z
cam_data = bpy.data.cameras.new("C")
cam = bpy.data.objects.new("C", cam_data)
scene.collection.objects.link(cam)
cam.location = (0.0, -dist, ty)
cam.rotation_euler = Vector((0, 1, 0)).to_track_quat("-Z", "Y").to_euler()
cam_data.lens = 40
cam_data.clip_end = 2000
scene.camera = cam
for name, loc, energy, size in (
    ("K", (2.0, -2.5, 3.0), 900, 2.0),
    ("F", (-2.5, -1.5, 0.6), 250, 2.0),
    ("R", (0.6, 2.5, 1.6), 700, 1.5),
):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy * dist * dist / 4
    ld.size = size
    lo = bpy.data.objects.new(name, ld)
    lo.location = Vector(loc) * (dist / 2.2) + Vector((0, 0, ty))
    lo.rotation_euler = (Vector((0, 0, ty)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(lo)
world = bpy.data.worlds.new("W")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (bg, bg, bg * 1.04, 1)
scene.world = world
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 900, 1200
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDERED", out)
