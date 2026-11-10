"""
Headless Blender script: prepares Poly Haven (CC0) scanned rock models for the web.

  blender -b --factory-startup -P process_rocks.py -- <in.gltf> <out.glb> <target_tris> <tex_size>

- imports the scanned glTF (keeps its PBR maps: diffuse, ARM, normal)
- decimates the scan to roughly <target_tris> triangles (shape preserved, normal map keeps fine detail)
- rescales textures to <tex_size> px and exports a single binary .glb with JPEG textures
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, target_tris, tex_size = argv[0], argv[1], int(argv[2]), int(argv[3])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for obj in meshes:
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    ratio = min(1.0, target_tris / max(tris, 1))
    print(f"[rocks] {obj.name}: {tris} tris -> ratio {ratio:.4f}")
    if ratio < 1.0:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # smooth shading so the decimated surface does not facet
    for p in obj.data.polygons:
        p.use_smooth = True
    after = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f"[rocks] {obj.name}: now {after} tris")

for img in bpy.data.images:
    if img.size[0] > tex_size:
        img.scale(tex_size, tex_size)
        print(f"[rocks] scaled {img.name} -> {tex_size}")

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials="EXPORT",
)
print(f"[rocks] wrote {dst}")
