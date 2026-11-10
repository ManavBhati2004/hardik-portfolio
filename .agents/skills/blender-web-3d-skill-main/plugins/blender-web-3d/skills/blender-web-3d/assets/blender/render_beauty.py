"""Headless beauty render rig — Cycles/EEVEE, AgX, compositor bloom, background dressing.

    blender --background model.blend --python render_beauty.py -- \
        --out renders/ [--engine CYCLES|EEVEE] [--samples 128] [--res 1920x1080] \
        [--root Station] [--views hero,detail,top]

Never saves the .blend: dressing (planet, sun, stars, cameras) exists only for the render,
so nothing leaks into the GLB export. Written for Blender 5.x
(engine id BLENDER_EEVEE, compositor via scene.compositing_node_group).
"""
import bpy, json, math, sys, argparse
from pathlib import Path
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", default="renders")
ap.add_argument("--engine", default="CYCLES", choices=["CYCLES", "EEVEE"])
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--res", default="1920x1080")
ap.add_argument("--root", default="Station")
ap.add_argument("--views", default="hero,detail,top")
args = ap.parse_args(argv)

scene = bpy.context.scene
OUT = Path(args.out).resolve()
OUT.mkdir(parents=True, exist_ok=True)


def world_bounds(root):
    lo, hi = Vector((1e18,) * 3), Vector((-1e18,) * 3)
    stack = [root]
    while stack:
        ob = stack.pop()
        stack.extend(ob.children)
        if ob.type == "MESH":
            for c in ob.bound_box:
                w = ob.matrix_world @ Vector(c)
                lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
    return lo, hi


# ------------------------------------------------------------------ engine + color
def setup_engine():
    r = scene.render
    r.resolution_x, r.resolution_y = map(int, args.res.split("x"))
    r.resolution_percentage = 100
    if args.engine == "CYCLES":
        r.engine = "CYCLES"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev_type in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
            try:
                prefs.compute_device_type = dev_type
                prefs.get_devices()
                if any(d.type == dev_type for d in prefs.devices):
                    break
            except TypeError:
                continue
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU" if any(d.use and d.type != "CPU" for d in prefs.devices) else "CPU"
        scene.cycles.samples = args.samples
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.012
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 6
        scene.cycles.caustics_reflective = scene.cycles.caustics_refractive = False
        scene.cycles.blur_glossy = 1.0          # kills fireflies from small hot emitters
    else:
        r.engine = "BLENDER_EEVEE"               # 5.x id (4.2-4.4 used BLENDER_EEVEE_NEXT)
        scene.eevee.taa_render_samples = args.samples
        scene.eevee.use_raytracing = True
        scene.eevee.use_shadows = True
    vs = scene.view_settings
    vs.view_transform = "AgX"                    # filmic highlight roll-off; matches three's AgXToneMapping
    vs.look = "AgX - Punchy"
    vs.exposure = 0.0
    r.film_transparent = False


# ------------------------------------------------------------------ world + lights + dressing
def setup_world(radius):
    w = bpy.data.worlds.new("RenderSpace")
    scene.world = w
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    # stars: high-frequency voronoi thresholded through a ramp, plus a faint blue ambient
    tc = nt.nodes.new("ShaderNodeTexCoord")
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = "F1"
    vor.inputs["Scale"].default_value = 420
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[0].color = 0.0, (6, 6, 6.5, 1)
    ramp.color_ramp.elements[1].position, ramp.color_ramp.elements[1].color = 0.035, (0.0006, 0.0009, 0.002, 1)
    nt.links.new(tc.outputs["Generated"], vor.inputs["Vector"])
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    def sun(name, energy, color, rot, angle):
        d = bpy.data.lights.new(name, "SUN")
        d.energy, d.color, d.angle = energy, color, angle
        ob = bpy.data.objects.new(name, d)
        ob.rotation_euler = [math.radians(a) for a in rot]
        scene.collection.objects.link(ob)

    sun("Key", 5.5, (1.0, 0.93, 0.84), (38, -12, 128), 0.012)     # warm, crisp shadows
    sun("Fill", 0.5, (0.55, 0.7, 1.0), (-130, 20, -50), 0.2)      # cool planet-shine from below
    sun("Rim", 2.2, (0.8, 0.88, 1.0), (-35, 0, -60), 0.02)        # separates silhouette from space

    # planet: big sphere far below-behind, procedural bands + atmosphere shell (render-only)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=128, ring_count=64, radius=radius * 9,
                                         location=(radius * 2, radius * 14, -radius * 9.5))
    planet = bpy.context.object
    planet.name = "Dressing_Planet"
    m = bpy.data.materials.new("Dressing_Planet")
    pn = m.node_tree.nodes
    bsdf = pn["Principled BSDF"]
    noise = pn.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 3.0
    noise.inputs["Detail"].default_value = 12
    pr = pn.new("ShaderNodeValToRGB")
    pr.color_ramp.elements[0].color = (0.02, 0.07, 0.2, 1)
    pr.color_ramp.elements[1].position, pr.color_ramp.elements[1].color = 0.62, (0.28, 0.33, 0.24, 1)
    el = pr.color_ramp.elements.new(0.52)
    el.color = (0.05, 0.16, 0.35, 1)
    m.node_tree.links.new(noise.outputs["Fac"], pr.inputs["Fac"])
    m.node_tree.links.new(pr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Coat Weight"].default_value = 0.4
    planet.data.materials.append(m)
    for p in planet.data.polygons:
        p.use_smooth = True


# ------------------------------------------------------------------ compositor (5.x node-group API)
def setup_compositor():
    ng = bpy.data.node_groups.new("BeautyComp", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    n = ng.nodes
    rl = n.new("CompositorNodeRLayers")
    glare = n.new("CompositorNodeGlare")         # physically-motivated bloom on emissives only
    glare.inputs["Type"].default_value = "Bloom"
    glare.inputs["Quality"].default_value = "High"
    glare.inputs["Threshold"].default_value = 1.2
    glare.inputs["Strength"].default_value = 0.55
    glare.inputs["Size"].default_value = 0.6
    lens = n.new("CompositorNodeLensdist")        # a whisper of dispersion = "shot on a lens"
    lens.inputs["Distortion"].default_value = 0.0
    lens.inputs["Dispersion"].default_value = 0.012
    out = n.new("NodeGroupOutput")
    ng.links.new(rl.outputs["Image"], glare.inputs["Image"])
    ng.links.new(glare.outputs["Image"], lens.inputs["Image"])
    ng.links.new(lens.outputs["Image"], out.inputs[0])
    scene.compositing_node_group = ng
    scene.render.use_compositing = True


# ------------------------------------------------------------------ cameras
def camera(name, loc, target, lens, clip_end):
    cd = bpy.data.cameras.new(name)
    cd.lens, cd.clip_start, cd.clip_end = lens, 0.5, clip_end
    ob = bpy.data.objects.new(name, cd)
    scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


def main():
    root = bpy.data.objects[args.root]
    lo, hi = world_bounds(root)
    c, size = (lo + hi) / 2, (hi - lo).length
    setup_engine()
    setup_world(size / 2)
    setup_compositor()
    views = {  # framed from 1.3-2x the model size (first attempts always land too close)
        "hero":   (c + Vector((0.55, -1.05, 0.38)) * size, c, 50),
        "detail": (c + Vector((0.42, -0.36, 0.22)) * size, c + Vector((0.12, 0, 0.1)) * size, 55),
        "top":    (c + Vector((0.05, -0.2, 1.4)) * size, c, 45),
    }
    report = {"renders": [], "engine": args.engine, "size": round(size, 1)}
    for name in args.views.split(","):
        loc, tgt, lens = views[name]
        scene.camera = camera(f"Cam_{name}", loc, tgt, lens, size * 40)
        scene.render.filepath = str(OUT / f"{name}.png")
        bpy.ops.render.render(write_still=True)
        report["renders"].append(scene.render.filepath)
    print(json.dumps(report, indent=2))


main()
