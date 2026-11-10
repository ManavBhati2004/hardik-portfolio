"""Export one root hierarchy as an uncompressed "raw" GLB — the input to optimize-glb.mjs.

    blender --background model.blend --python export_glb.py -- --root Station --out model-raw-v001.glb

Compression is deliberately NOT done here: gltf-transform (assets/pipeline/optimize-glb.mjs)
does dedup + GPU instancing + meshopt + KTX2/WebP in one reproducible, measurable step,
and the raw file stays an archive of exactly what Blender produced.
"""
import bpy, json, sys, argparse
from pathlib import Path

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--allow-overwrite", action="store_true")
args = ap.parse_args(argv)

out = Path(args.out).resolve()
if out.exists() and not args.allow_overwrite:
    raise SystemExit(f"refusing to overwrite {out} (bump the version or pass --allow-overwrite)")

root = bpy.data.objects[args.root]
bpy.ops.object.select_all(action="DESELECT")
stack, n = [root], 0
while stack:
    ob = stack.pop()
    stack.extend(ob.children)
    ob.hide_set(False)
    ob.select_set(True)
    n += 1
bpy.context.view_layer.objects.active = root

out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format="GLB", use_selection=True,
    export_apply=True,                 # bake modifiers (bevel / weighted normal) into the mesh
    export_animations=True, export_nla_strips=True, export_optimize_animation_size=True,
    export_cameras=False, export_lights=False, export_extras=True,
    export_gpu_instances=True,         # linked duplicates -> EXT_mesh_gpu_instancing
    export_image_format="AUTO",        # keep lossless; optimize-glb.mjs picks KTX2/WebP
    export_draco_mesh_compression_enable=False,
)
print(json.dumps({"status": "exported", "file": str(out), "nodes": n,
                  "bytes": out.stat().st_size}, indent=2))
