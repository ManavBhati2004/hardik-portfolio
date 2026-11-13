"""
Bake tileable ocean detail maps for the water shader (src/components/Water.tsx).

Uses Blender's Ocean modifier (FFT ocean, periodic over `spatial_size`, so every
map tiles seamlessly). For each of two scales ("swell" = long wind waves, "chop" =
short capillary chop) it evaluates two snapshots of the same sea a few seconds
apart; the shader scrolls both and crossfades between them, so the loop never
pops.

Each output is a lossless RGB WebP:
    R, G  tangent-space surface normal X / Y   (0.5 = flat)
    B     foam / crest mask (Jacobian folding of the choppy displacement)

Run headless:
    D:\\blender\\blender.exe -b --factory-startup -noaudio \
        --python scripts/blender/bake_ocean.py -- --out public/textures

Writes public/textures/ocean_{swell,chop}_{a,b}.webp
"""

import argparse
import os
import sys

import bpy
import numpy as np

# name, FFT resolution (grid = res^2), output px, spatial size (m), wind (m/s),
# choppiness, smallest wave (m), alignment, snapshot times (s), foam (J threshold,
# softness) and the mean slope the field is normalised to (keeps both scales calm)
SCALES = [
    dict(name="swell", res=32, px=512, size=40.0, wind=9.0, chop=1.15, min_wave=0.05,
         align=0.6, times=(11.0, 14.5), seed=7, foam=(0.55, 0.15), slope=0.16),
    dict(name="chop", res=16, px=256, size=6.0, wind=4.0, chop=0.9, min_wave=0.005,
         align=0.15, times=(3.0, 4.6), seed=21, foam=(0.62, 0.18), slope=0.13),
]


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/textures")
    return ap.parse_args(argv)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def evaluate(ob, mod, t):
    """Displacement field (rx, rx, 3) of the ocean at time t (periodic grid)."""
    mod.time = t
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    side = int(round(np.sqrt(n)))
    assert side * side == n, f"unexpected vertex count {n}"
    co = co.reshape(side, side, 3)[:-1, :-1]  # drop the duplicated periodic seam
    rx = side - 1
    S = mod.spatial_size * mod.size
    ax = -S / 2 + np.arange(rx) * (S / rx)
    gx, gy = np.meshgrid(ax, ax)
    d = co.copy()
    d[..., 0] -= gx
    d[..., 1] -= gy
    return d, S / rx


def maps(d, step, foam_thresh, foam_soft):
    """Normals + foam from the choppy displacement, all derivatives periodic."""
    def ddx(a):
        return (np.roll(a, -1, axis=1) - np.roll(a, 1, axis=1)) / (2 * step)

    def ddy(a):
        return (np.roll(a, -1, axis=0) - np.roll(a, 1, axis=0)) / (2 * step)

    dx, dy, h = d[..., 0], d[..., 1], d[..., 2]
    # surface P(u,v) = (u + dx, v + dy, h)
    Pu = np.stack([1 + ddx(dx), ddx(dy), ddx(h)], -1)
    Pv = np.stack([ddy(dx), 1 + ddy(dy), ddy(h)], -1)
    n = np.cross(Pu, Pv)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    # Jacobian of the horizontal map: < 1 where crests fold / compress → whitecaps
    J = (1 + ddx(dx)) * (1 + ddy(dy)) - ddx(dy) * ddy(dx)
    foam = smoothstep(foam_thresh + foam_soft, foam_thresh - foam_soft, J)
    return n, foam


def box_down(a, px):
    k = a.shape[0] // px
    if k <= 1:
        return a
    return a.reshape(px, k, px, k, *a.shape[2:]).mean(axis=(1, 3))


def save_webp(path, rgb):
    px = rgb.shape[0]
    img = bpy.data.images.new(os.path.basename(path), px, px, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((px, px, 4), np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "WEBP"
    # quality 100 = lossless WebP: no chroma subsampling on the packed data channels
    img.save(filepath=path, quality=100)
    bpy.data.images.remove(img)


def main():
    args = parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    for cfg in SCALES:
        me = bpy.data.meshes.new("ocean_" + cfg["name"])
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new("ocean", "OCEAN")
        mod.geometry_mode = "GENERATE"
        mod.resolution = cfg["res"]
        mod.viewport_resolution = cfg["res"]  # depsgraph evaluates at viewport res headless
        mod.spatial_size = int(cfg["size"])
        mod.size = 1.0
        mod.wind_velocity = cfg["wind"]
        mod.choppiness = cfg["chop"]
        mod.wave_scale = 1.0
        mod.wave_scale_min = cfg["min_wave"]
        mod.wave_alignment = cfg["align"]
        mod.wave_direction = 0.4
        mod.random_seed = cfg["seed"]
        mod.depth = 200.0
        mod.use_normals = False

        for tag, t in zip("ab", cfg["times"]):
            d, step = evaluate(ob, mod, t)
            # normalise amplitude so the mean surface slope matches the target
            # (same factor for both snapshots → identical statistics across the crossfade)
            if tag == "a":
                amp = 1.0
                for _ in range(4):
                    n, _f = maps(d * amp, step, *cfg["foam"])
                    amp *= cfg["slope"] / np.sqrt(n[..., 0] ** 2 + n[..., 1] ** 2).mean()
            n, foam = maps(d * amp, step, *cfg["foam"])
            n = box_down(n, cfg["px"])
            n /= np.linalg.norm(n, axis=-1, keepdims=True)
            foam = box_down(foam, cfg["px"])
            rgb = np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, foam], -1)
            # Blender images are bottom-up; flip so row 0 is v = 0 consistently
            rgb = rgb[::-1]
            path = os.path.join(out, f"ocean_{cfg['name']}_{tag}.webp")
            save_webp(path, rgb)
            slope = np.sqrt(n[..., 0] ** 2 + n[..., 1] ** 2)
            print(f"[bake_ocean] {path}: {rgb.shape[0]}px  slope mean {slope.mean():.3f} "
                  f"max {slope.max():.3f}  foam mean {foam.mean():.3f}")


if __name__ == "__main__":
    main()
