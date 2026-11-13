"""
Headless Blender script: builds a Himeji-style Japanese castle (shiro) on a wooded hill.

  blender -b --factory-startup -P build_shiro.py -- <out.glb> [preview.png] [--preview-only]

Reference: a Himeji-jo photo (five-tier white keep on a battered stone base, two smaller
connected towers, white connecting halls and walls, wooded hill).

Units: metres-ish (the site scales the model down). Blender Z-up, the castle front faces -Y
(=> +Z in three.js after glTF export). The origin sits on the main keep axis at water level.

Materials (by name, the site maps them): plaster, roof, stone, window, wood, foliage, ground.
Vertex colour COLOR_0:
  R = baked ambient occlusion 0..1
  G = window glow mask (1 on the few windows lit at night)
  B = per-part random 0..1 (tone variation)
"""
import sys
import math
import random

import bpy
import bmesh
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW_ONLY = "--preview-only" in argv
argv = [a for a in argv if not a.startswith("--")]
OUT = argv[0] if argv else None
PREVIEW = argv[1] if len(argv) > 1 else None

rng = random.Random(11)
Z = Vector((0, 0, 1))
WATER_Z = -7.0

MATS = ["plaster", "roof", "stone", "window", "wood", "foliage", "ground"]


# ─────────────────────────────────────────────────────────────────────────────
# Geometry accumulator. Every face carries an orientation rule so winding is
# fixed afterwards (outward normals matter for the AO bake).
# ─────────────────────────────────────────────────────────────────────────────
class Geo:
    def __init__(self):
        self.v = []
        self.f = []
        self.m = []
        self.glow = []
        self.rnd = []
        self.smooth = []
        self.orient = []
        self.mode = ("up",)

    def add(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, mat, glow=0.0, rnd=None, smooth=False, mode=None):
        self.f.append(list(idx))
        self.m.append(MATS.index(mat))
        self.glow.append(glow)
        self.rnd.append(rng.random() if rnd is None else rnd)
        self.smooth.append(smooth)
        self.orient.append(mode or self.mode)

    def poly(self, pts, mat, **kw):
        self.face([self.add(p) for p in pts], mat, **kw)

    def grid(self, fn, nu, nv, mat, **kw):
        ids = [[self.add(fn(i / nu, j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
        r = kw.pop("rnd", None)
        r = rng.random() if r is None else r
        for i in range(nu):
            for j in range(nv):
                self.face([ids[i][j], ids[i + 1][j], ids[i + 1][j + 1], ids[i][j + 1]], mat, rnd=r, **kw)
        return ids

    def loft(self, rings, mat, closed=True, **kw):
        ids = [[self.add(p) for p in ring] for ring in rings]
        r = kw.pop("rnd", None)
        r = rng.random() if r is None else r
        n = len(rings[0])
        last = n if closed else n - 1
        for k in range(len(rings) - 1):
            for i in range(last):
                j = (i + 1) % n
                self.face([ids[k][i], ids[k][j], ids[k + 1][j], ids[k + 1][i]], mat, rnd=r, **kw)
        return ids

    def box(self, c, ax, ay, az, mat, glow=0.0, rnd=None, skip_bottom=False):
        c = Vector(c)
        corners = {}
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    corners[(sx, sy, sz)] = self.add(c + ax * sx + ay * sy + az * sz)
        faces = [
            [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)],
            [(-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)],
            [(-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)],
            [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)],
            [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)],
        ]
        if not skip_bottom:
            faces.append([(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)])
        r = rng.random() if rnd is None else rnd
        for fc in faces:
            self.face([corners[k] for k in fc], mat, glow=glow, rnd=r, mode=("pt", c.copy()))


G = Geo()


def newell(pts):
    n = Vector((0, 0, 0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def fix_winding():
    for fi, idx in enumerate(G.f):
        pts = [G.v[i] for i in idx]
        n = newell(pts)
        if n.length < 1e-12:
            continue
        c = sum(pts, Vector()) / len(pts)
        mode = G.orient[fi]
        if mode[0] == "up":
            want = n.z
        elif mode[0] == "down":
            want = -n.z
        elif mode[0] == "pt":
            want = n.dot(c - mode[1])
        else:  # axis
            want = n.x * (c.x - mode[1]) + n.y * (c.y - mode[2])
        if want < 0:
            G.f[fi] = idx[::-1]


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ─────────────────────────────────────────────────────────────────────────────
# Rectangle perimeter parameterisation: (fx, fy, corner_factor) with fx, fy in -1..1
# ─────────────────────────────────────────────────────────────────────────────
def cfac(s, L, Lc):
    d = min(s, 1 - s) * L
    return max(0.0, 1 - d / Lc)


def rect_param(nx, ny, Lx=1.0, Ly=1.0, Lc=1.0):
    pts = []
    for i in range(nx):
        s = i / nx
        pts.append((-1 + 2 * s, -1, cfac(s, Lx, Lc)))
    for i in range(ny):
        s = i / ny
        pts.append((1, -1 + 2 * s, cfac(s, Ly, Lc)))
    for i in range(nx):
        s = i / nx
        pts.append((1 - 2 * s, 1, cfac(s, Lx, Lc)))
    for i in range(ny):
        s = i / ny
        pts.append((-1, 1 - 2 * s, cfac(s, Ly, Lc)))
    return pts


def segs(length, cell):
    return max(1, int(math.ceil(length / cell)))


# ─────────────────────────────────────────────────────────────────────────────
# Building parts
# ─────────────────────────────────────────────────────────────────────────────
def ishigaki(cx, cy, z0, z1, w, d, b, cell=0.6, K=9):
    """Battered stone base: flares out concavely toward the bottom (sori)."""
    P = rect_param(segs(w + 2 * b, cell), segs(d + 2 * b, cell))
    rings = []
    for k in range(K + 1):
        t = k / K
        off = b * (1 - t) ** 2
        hx, hy = w / 2 + off, d / 2 + off
        ring = []
        for fx, fy, _ in P:
            p = Vector((cx + fx * hx, cy + fy * hy, lerp(z0, z1, t)))
            if k < K:
                # rough-dressed stones: the battered face bulges and sinks block by block
                out = Vector((fx * (abs(fx) > 0.999), fy * (abs(fy) > 0.999), 0))
                if out.length > 0:
                    p += out.normalized() * 0.07 * noise.noise(p * 1.3 + Vector((3.1, 7.7, 1.9)))
            ring.append(p)
        rings.append(ring)
    G.loft(rings, "stone", mode=("axis", cx, cy))
    G.poly(rings[-1], "stone", mode=("up",))


def walls(cx, cy, z0, z1, w, d, cell=0.45, mat="plaster"):
    P = rect_param(segs(w, cell), segs(d, cell))
    nv = segs(z1 - z0, cell)
    rings = [[Vector((cx + fx * w / 2, cy + fy * d / 2, lerp(z0, z1, k / nv))) for fx, fy, _ in P] for k in range(nv + 1)]
    G.loft(rings, mat, mode=("axis", cx, cy))


def windows(cx, cy, w, d, zc, spacing=0.95, size=(0.13, 0.15), glow_p=0.12, double=False):
    sides = [
        (Vector((1, 0, 0)), Vector((0, -1, 0)), w, d),
        (Vector((1, 0, 0)), Vector((0, 1, 0)), w, d),
        (Vector((0, 1, 0)), Vector((-1, 0, 0)), d, w),
        (Vector((0, 1, 0)), Vector((1, 0, 0)), d, w),
    ]
    for t, n, length, depth in sides:
        count = max(1, int((length - 0.8) / spacing))
        for i in range(count):
            a = (i - (count - 1) / 2) * spacing
            if rng.random() < 0.12:
                continue
            c = Vector((cx, cy, zc)) + t * a + n * (depth / 2 + 0.02)
            glow = 1.0 if rng.random() < glow_p else 0.0
            hw = size[0] * (1.8 if double and rng.random() < 0.35 else 1.0)
            G.box(c, t * hw, n * 0.04, Z * size[1], "window", glow=glow)


def skirt(cx, cy, zE, Ew, Ed, Iw, Id, zI, Ww, Wd, lift=0.35, ext=0.25, K=5, cell=0.55, th=0.12):
    """Hipped roof skirt from the eave rectangle E up to the inner rectangle I (concave, lifted corners)."""
    P = rect_param(segs(Ew, cell), segs(Ed, cell), Ew, Ed, min(Ew, Ed) * 0.24)
    rings = []
    for k in range(K + 1):
        t = k / K
        hx, hy = lerp(Ew / 2, Iw / 2, t), lerp(Ed / 2, Id / 2, t)
        zt = zE + (zI - zE) * t ** 1.35
        ring = []
        for fx, fy, cf in P:
            dv = Vector((fx, fy)).normalized()
            e = ext * cf * cf * (1 - t)
            ring.append(Vector((cx + fx * hx + dv.x * e, cy + fy * hy + dv.y * e, zt + lift * cf * cf * (1 - t) ** 1.5)))
        rings.append(ring)
    G.loft(rings, "roof", mode=("up",))
    # eave fascia and white plastered soffit back to the wall
    low = [p - Z * th for p in rings[0]]
    G.loft([low, rings[0]], "roof", mode=("axis", cx, cy))
    wall = [Vector((cx + fx * Ww / 2, cy + fy * Wd / 2, zE - th - 0.25)) for fx, fy, _ in P]
    G.loft([wall, low], "plaster", mode=("down",))


def frame(o, t, n):
    o, t, n = Vector(o), Vector(t), Vector(n)
    return lambda a, b, c: o + t * a + n * b + Z * c


def chidori(o, t, n, w, hh, depth, ov=0.2):
    """Triangular chidori-hafu gable sitting on a roof slope; front faces +n."""
    L = frame(o, t, n)
    behind = L(0, -1.0, hh * 0.3)
    G.poly([L(-w / 2, 0, 0), L(w / 2, 0, 0), L(0, 0, hh)], "plaster", mode=("pt", behind))
    G.poly([L(-w / 2, 0.01, 0), L(w / 2, 0.01, 0), L(w / 2, 0.01, 0.1), L(-w / 2, 0.01, 0.1)], "wood", mode=("pt", behind))
    for s in (-1, 1):
        q = [L(s * (w / 2 + ov), ov, -0.04 + 0.08), L(0, ov, hh + 0.08), L(0, -depth, hh + 0.08), L(s * (w / 2 + ov), -depth, -0.04)]
        G.grid(lambda u, v, q=q: lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v), 3, 2, "roof", mode=("up",))
        # bargeboard below the front edge
        G.poly([q[0], q[1], q[1] - Z * 0.12, q[0] - Z * 0.12], "roof", mode=("pt", behind))
    G.box(L(0, (ov - depth) / 2, hh + 0.14), n * ((ov + depth) / 2), t * 0.07, Z * 0.07, "roof")


def kara(o, t, n, w, hh, depth, ov=0.14, N=16):
    """Kara-hafu: undulating bell-curved gable on the eave; front faces +n."""
    L = frame(o, t, n)
    behind = L(0, -1.0, hh * 0.3)
    A = w / 2 + ov

    def zc(a):
        s = a / A
        return hh * (0.5 * (1 + math.cos(math.pi * s))) ** 0.9 + 0.12 * s ** 8

    G.grid(lambda u, v: L(lerp(-A, A, u), lerp(ov, -depth, v), zc(lerp(-A, A, u)) + 0.08 + 0.3 * hh * v), N, 2, "roof", mode=("up",))
    front = [L(lerp(-A, A, i / N), ov, zc(lerp(-A, A, i / N)) + 0.08) for i in range(N + 1)]
    G.loft([[p - Z * 0.14 for p in front], front], "roof", closed=False, mode=("pt", behind))
    fill = [L(-w / 2, 0, 0), L(w / 2, 0, 0)] + [L(a, 0, zc(a) - 0.04) for a in [lerp(w / 2, -w / 2, i / N) for i in range(N + 1)]]
    G.poly(fill, "plaster", mode=("pt", behind))


def shachi(c, out, size=1.0):
    """Ridge-end shachihoko: a curled fin leaning outward."""
    tilt = (out * 0.45 + Z).normalized()
    side = Z.cross(out).normalized()
    G.box(c + tilt * 0.24 * size, side * 0.06 * size, out.cross(side).normalized() * 0.09 * size, tilt * 0.26 * size, "roof")
    tip = c + tilt * 0.5 * size + out * -0.08 * size
    G.box(tip, side * 0.05 * size, out * 0.12 * size, Z * 0.05 * size, "roof")


def irimoya_top(cx, cy, zI, Iw, Id, ridge="x", pitch=0.95, ov=0.28, shachi_size=1.0, cell=0.5):
    """Upper part of an irimoya roof: gable planes to the ridge, plaster gable triangles, ridge + shachihoko."""
    if ridge == "x":
        A, B = Iw / 2, Id / 2

        def P(a, b, c):
            return Vector((cx + a, cy + b, c))
        along, across = Vector((1, 0, 0)), Vector((0, 1, 0))
    else:
        A, B = Id / 2, Iw / 2

        def P(a, b, c):
            return Vector((cx + b, cy + a, c))
        along, across = Vector((0, 1, 0)), Vector((1, 0, 0))
    zR = zI + B * pitch
    AL = A + ov
    for sgn in (-1, 1):
        def fn(u, v, sgn=sgn):
            a = lerp(-AL, AL, u)
            z = zI - 0.05 + (zR - zI + 0.05) * v ** 1.2
            lf = max(0.0, (abs(a) - (AL - 0.7)) / 0.7) ** 2 * (1 - v) ** 2 * 0.22
            return P(a, sgn * (B + 0.08) * (1 - v), z + lf)
        ids = G.grid(fn, segs(2 * AL, cell), 3, "roof", mode=("up",))
        # bargeboards on the gable edges
        for end in (0, len(ids) - 1):
            edge = [G.v[i] for i in ids[end]]
            G.loft([[p - Z * 0.14 for p in edge], edge], "roof", closed=False, mode=("axis", cx, cy))
    for se in (-1, 1):
        a = se * (A - 0.06)
        G.poly([P(a, -B, zI - 0.1), P(a, B, zI - 0.1), P(a, 0, zR - 0.06)], "plaster", mode=("axis", cx, cy))
        G.poly([P(a + se * 0.01, -B * 0.55, zI + B * pitch * 0.42), P(a + se * 0.01, B * 0.55, zI + B * pitch * 0.42),
                P(a + se * 0.01, B * 0.55, zI + B * pitch * 0.42 + 0.09), P(a + se * 0.01, -B * 0.55, zI + B * pitch * 0.42 + 0.09)],
               "wood", mode=("axis", cx, cy))
    G.box(P(0, 0, zR + 0.06), along * (AL + 0.08), across * 0.13, Z * 0.12, "roof")
    for se in (-1, 1):
        shachi(P(se * (AL + 0.02), 0, zR + 0.16), along * se, shachi_size)
    return zR


def hafu_frame(cx, cy, E, I, zE, zI, side, off, s_frac=0.32):
    """Origin/tangent/normal on a skirt side for placing a gable, plus the local skirt run."""
    Ew, Ed = E
    Iw, Id = I
    if side in ("front", "back"):
        run = (Ed - Id) / 2
        s_in = run * s_frac
        sg = -1 if side == "front" else 1
        o = Vector((cx + off, cy + sg * (Ed / 2 - s_in), 0))
        t, n = Vector((1, 0, 0)), Vector((0, sg, 0))
    else:
        run = (Ew - Iw) / 2
        s_in = run * s_frac
        sg = -1 if side == "left" else 1
        o = Vector((cx + sg * (Ew / 2 - s_in), cy + off, 0))
        t, n = Vector((0, 1, 0)), Vector((sg, 0, 0))
    o.z = zE + (zI - zE) * s_frac ** 1.35 + 0.02
    return o, t, n, run


def tower(cx, cy, zb, base, tiers, top_ridge="x", ov=0.8, slope=0.62, lift=0.35, hafu=None, win_glow=0.12, shachi_size=1.0, cell=0.45):
    """Ishigaki base + stacked tiers with skirts, ending in an irimoya top."""
    hafu = hafu or {}
    bw, bd, bh, bb = base
    if bh > 0:
        ishigaki(cx, cy, zb, zb + bh, bw, bd, bb)
    zv = zb + bh
    first = True
    zR = zv
    for i, (w, d, hv) in enumerate(tiers):
        walls(cx, cy, zv - (0 if first else 0.35), zv + hv, w, d, cell)
        windows(cx, cy, w, d, zv + hv * 0.52, glow_p=win_glow, double=i == len(tiers) - 1)
        if hv > 1.7:
            windows(cx, cy, w, d, zv + hv * 0.2, spacing=1.4, glow_p=win_glow * 0.5)
        first = False
        zE = zv + hv
        Ew, Ed = w + 2 * ov, d + 2 * ov
        last = i == len(tiers) - 1
        if not last:
            Iw, Id = tiers[i + 1][0], tiers[i + 1][1]
            run = ((Ew - Iw) + (Ed - Id)) / 4
            zI = zE + slope * run
        else:
            r = min(Ew, Ed) * 0.2
            Iw, Id = Ew - 2 * r, Ed - 2 * r
            zI = zE + slope * r
        skirt(cx, cy, zE, Ew, Ed, Iw, Id, zI, w, d, lift=lift, cell=cell)
        for kind, side, off, gw in hafu.get(i, []):
            o, t, n, run = hafu_frame(cx, cy, (Ew, Ed), (Iw, Id), zE, zI, side, off)
            if kind == "chidori":
                chidori(o, t, n, gw, gw * 0.42, run * 1.1 + 0.3)
            else:
                kara(o, t, n, gw, gw * 0.3, run * 0.9)
        if last:
            zR = irimoya_top(cx, cy, zI, Iw, Id, ridge=top_ridge, shachi_size=shachi_size)
        zv = zI
    return zR


def hall(cx, cy, zb, w, d, base_h, wall_h, ridge="x", glow_p=0.06):
    """Low white connecting building (watari-yagura / tamon-yagura)."""
    return tower(cx, cy, zb, (w, d, base_h, base_h * 0.35), [(w, d, wall_h)], top_ridge=ridge, ov=0.5, lift=0.18, win_glow=glow_p, shachi_size=0.6)


def dobei(points, h=0.85, th=0.13):
    """White earthen wall with a little tile cap, following the ground."""
    for a, b in zip(points[:-1], points[1:]):
        a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
        dvec = b - a
        L = dvec.length
        n = max(1, int(L / 2.5))
        dirv = dvec.normalized()
        perp = Vector((-dirv.y, dirv.x, 0))
        for k in range(n):
            p0 = a + dvec * (k / n)
            p1 = a + dvec * ((k + 1) / n)
            m = (p0 + p1) / 2
            gz = hill_z(m.x, m.y)
            G.box(Vector((m.x, m.y, gz + h / 2 - 0.25)), dirv * (L / n / 2 + 0.02), perp * th, Z * (h / 2 + 0.25), "plaster", skip_bottom=True)
            G.box(Vector((m.x, m.y, gz + h + 0.02)), dirv * (L / n / 2 + 0.06), perp * (th + 0.13), Z * 0.07, "roof")


# ─────────────────────────────────────────────────────────────────────────────
# Wooded hill
# ─────────────────────────────────────────────────────────────────────────────
PLATEAU = (-29.0, 8.8, -8.2, 10.5)   # x0, x1, y0, y1  (z = 0)
TERRACE = (-6.5, 10.0, -12.4, -8.0)  # z = -2.6


def sd_rect(x, y, r, rad=2.0):
    x0, x1, y0, y1 = r
    cxr, cyr = (x0 + x1) / 2, (y0 + y1) / 2
    hx, hy = (x1 - x0) / 2 - rad, (y1 - y0) / 2 - rad
    qx, qy = abs(x - cxr) - hx, abs(y - cyr) - hy
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - rad


def hill_z(x, y):
    d1 = sd_rect(x, y, PLATEAU)
    d2 = sd_rect(x, y, TERRACE, 1.0)
    nz = noise.noise(Vector((x * 0.13, y * 0.13, 0.7)))
    d1n = d1 + nz * 2.2
    h1 = 0.0 - (0.0 - WATER_Z + 0.6) * smoothstep(0, 12, d1n)
    h2 = -2.6 - (-2.6 - WATER_Z + 0.6) * smoothstep(0, 7, d2 + nz * 1.5)
    h = max(h1, h2)
    s = smoothstep(0, 4, min(d1, d2 + 2))
    h += s * noise.noise(Vector((x * 0.31, y * 0.31, 3.1))) * 0.8
    return h


def build_hill():
    x0, x1, y0, y1 = -42.0, 24.0, -26.0, 22.0
    nx, ny = 60, 44
    G.grid(lambda u, v: Vector((lerp(x0, x1, u), lerp(y0, y1, v), hill_z(lerp(x0, x1, u), lerp(y0, y1, v)))), nx, ny, "ground", smooth=True, mode=("up",), rnd=0.5)


def ico_template():
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


ICO = ico_template()


def blob(c, r, squash, rnd):
    verts, faces = ICO
    seed = Vector((rng.random() * 50, rng.random() * 50, rng.random() * 50))
    ids = []
    for v in verts:
        jit = 1 + 0.22 * noise.noise(v * 1.7 + seed)
        ids.append(G.add(c + Vector((v.x * r * jit, v.y * r * jit, v.z * r * squash * jit))))
    for f in faces:
        G.face([ids[i] for i in f], "foliage", rnd=rnd, smooth=True, mode=("pt", c.copy()))


def build_trees(target=230):
    placed = []
    tries = 0
    while len(placed) < target and tries < 20000:
        tries += 1
        x = rng.uniform(-41, 23)
        y = rng.uniform(-25, 21)
        d1 = sd_rect(x, y, PLATEAU)
        d2 = sd_rect(x, y, TERRACE, 1.0)
        if d1 < 0.6 or d2 < 0.4:
            continue
        z = hill_z(x, y)
        if z < WATER_Z + 0.5:
            continue
        r = rng.uniform(1.2, 2.3)
        if any((x - px) ** 2 + (y - py) ** 2 < (r + pr) ** 2 * 0.28 for px, py, pr in placed):
            continue
        placed.append((x, y, r))
        rnd = rng.random()
        c = Vector((x, y, z + r * 0.75))
        blob(c, r, 0.82, rnd)
        off = Vector((rng.uniform(-0.6, 0.6), rng.uniform(-0.6, 0.6), r * 0.45))
        blob(c + off, r * 0.7, 0.85, rnd)
    return len(placed)


# ─────────────────────────────────────────────────────────────────────────────
# Assemble the castle
# ─────────────────────────────────────────────────────────────────────────────
build_hill()

# Main keep: battered base + five tiers, gables per the reference
MAIN_TIERS = [(12.0, 8.8, 2.1), (10.2, 7.4, 1.6), (8.6, 6.3, 1.5), (7.0, 5.2, 1.35), (5.2, 4.0, 1.5)]
tower(0, 0, 0, (12.0, 8.8, 2.7, 1.5), MAIN_TIERS, top_ridge="y", ov=1.0, hafu={
    0: [("kara", "front", 0.0, 2.2), ("chidori", "front", -3.4, 2.6), ("chidori", "front", 3.4, 2.6),
        ("chidori", "left", 0.0, 3.0), ("chidori", "right", 0.0, 3.0), ("chidori", "back", 0.0, 3.4)],
    1: [("chidori", "front", -1.9, 3.0), ("chidori", "front", 1.9, 3.0), ("chidori", "back", 0.0, 3.2),
        ("chidori", "left", 0.0, 2.6), ("chidori", "right", 0.0, 2.6)],
    2: [("chidori", "front", 0.0, 3.6), ("kara", "back", 0.0, 2.0), ("chidori", "left", 0.0, 2.2), ("chidori", "right", 0.0, 2.2)],
    3: [("kara", "front", 0.0, 1.9), ("chidori", "left", 0.0, 1.8), ("chidori", "right", 0.0, 1.8)],
}, shachi_size=1.3)

# West small keep (connected) and north-west keep behind it
tower(-11.5, -0.8, 0, (6.2, 5.2, 2.5, 1.1), [(6.2, 5.2, 1.6), (5.0, 4.1, 1.3), (3.8, 3.2, 1.3)], top_ridge="y", ov=0.65,
      hafu={0: [("chidori", "front", 0.0, 2.4)], 1: [("kara", "front", 0.0, 1.4)]}, shachi_size=0.9)
tower(-8.2, 6.6, 0, (5.4, 4.8, 2.7, 1.0), [(5.4, 4.8, 1.5), (4.0, 3.5, 1.3)], top_ridge="x", ov=0.6,
      hafu={0: [("chidori", "front", 0.0, 2.0)]}, shachi_size=0.85)

# Connecting halls (watari-yagura) with the white connecting walls
hall(-7.4, -1.4, 0, 3.4, 3.4, 2.4, 1.3, ridge="x")
hall(-11.0, 3.6, 0, 3.4, 3.0, 2.4, 1.2, ridge="y")
hall(-4.6, 5.4, 0, 4.2, 3.0, 2.6, 1.2, ridge="x")

# Long low hall and corner turret to the west (left in the reference)
hall(-20.0, -2.4, 0, 9.0, 3.4, 1.7, 1.3, ridge="x")
tower(-26.0, -2.4, 0, (3.6, 3.4, 1.9, 0.7), [(3.6, 3.4, 1.4), (2.6, 2.4, 1.1)], top_ridge="y", ov=0.5, lift=0.25, shachi_size=0.6)

# Front terrace: retaining stone walls and low white buildings
ishigaki(2.0, -6.9, -2.9, 0.0, 15.5, 2.4, 0.9)
ishigaki(1.8, -11.8, -5.6, -2.6, 15.0, 1.1, 0.9)
hall(2.6, -10.5, -2.6, 9.0, 2.3, 0.2, 1.1, ridge="x")
hall(-4.0, -10.2, -2.6, 3.2, 2.6, 0.2, 1.5, ridge="y")

# White walls along the plateau edges and down toward the terrace
dobei([(-28.0, -7.6), (-14.0, -7.4), (-6.5, -7.2)])
dobei([(8.6, -7.6), (8.6, 4.0), (6.0, 10.0)])
dobei([(-28.5, -6.0), (-28.5, 9.5), (-12.0, 10.4)])
dobei([(-6.5, -12.0), (-6.9, -8.4)])
dobei([(9.6, -12.0), (9.8, -8.0)])

n_trees = build_trees(300)

# ─────────────────────────────────────────────────────────────────────────────
# Build the Blender mesh
# ─────────────────────────────────────────────────────────────────────────────
fix_winding()
for v in G.v:
    v.z -= WATER_Z  # origin at water level

bpy.ops.wm.read_factory_settings(use_empty=True)
mesh = bpy.data.meshes.new("shiro")
mesh.from_pydata([tuple(v) for v in G.v], [], G.f)
mesh.update()
mesh.polygons.foreach_set("material_index", G.m)
mesh.polygons.foreach_set("use_smooth", G.smooth)

col = mesh.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
cvals = []
for fi, poly in enumerate(mesh.polygons):
    for _ in range(poly.loop_total):
        cvals.extend((1.0, G.glow[fi], G.rnd[fi], 1.0))
col.data.foreach_set("color", cvals)
ao_attr = mesh.color_attributes.new("AO", "BYTE_COLOR", "CORNER")

obj = bpy.data.objects.new("shiro", mesh)
bpy.context.scene.collection.objects.link(obj)

PALETTE = {
    "plaster": (0.86, 0.85, 0.82),
    "roof": (0.1, 0.11, 0.125),
    "stone": (0.2, 0.19, 0.17),
    "window": (0.05, 0.045, 0.04),
    "wood": (0.09, 0.08, 0.07),
    "foliage": (0.11, 0.2, 0.06),
    "ground": (0.12, 0.13, 0.07),
}
for name in MATS:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*PALETTE[name], 1)
    bsdf.inputs["Roughness"].default_value = 0.85 if name != "roof" else 0.55
    obj.data.materials.append(mat)

# merge coincident vertices (keeps per-corner attributes)
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
bm.to_mesh(mesh)
bm.free()

tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
print(f"[shiro] faces={len(mesh.polygons)} tris={tris} verts={len(mesh.vertices)} trees={n_trees}")

# ─── bake ambient occlusion into the AO colour attribute ───
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 96
world = bpy.data.worlds.new("w")
world.use_nodes = True
scene.world = world
world.light_settings.distance = 2.6
scene.render.bake.target = "VERTEX_COLORS"
ao_attr = mesh.color_attributes["AO"]
mesh.color_attributes.active_color = ao_attr
mesh.color_attributes.active_color_name = "AO"
print("[shiro] active color", mesh.color_attributes.active_color_name)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.bake(type="AO")

# pack AO into R of the exported colour attribute
ao_vals = [0.0] * (len(mesh.loops) * 4)
mesh.color_attributes["AO"].data.foreach_get("color", ao_vals)
col = mesh.color_attributes["Col"]
cvals = [0.0] * (len(mesh.loops) * 4)
col.data.foreach_get("color", cvals)
for i in range(len(mesh.loops)):
    cvals[i * 4] = ao_vals[i * 4]
col.data.foreach_set("color", cvals)
mesh.color_attributes.remove(mesh.color_attributes["AO"])
mesh.color_attributes.active_color = mesh.color_attributes["Col"]
mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
print("[shiro] AO baked")


# ─── preview render (reference-like daylight view) ───
def preview(path):
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.inputs["Factor"].default_value = 1.0
        mul.inputs[6].default_value = bsdf.inputs["Base Color"].default_value
        nt.links.new(attr.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Red"], mul.inputs[7])
        nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.7, 0.8, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.5
    sun.angle = 0.1
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    scene.collection.objects.link(so)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 60
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = Vector((14, -95, 20))
    target = Vector((-6, 0, 10))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 930
    scene.render.filepath = path
    scene.view_settings.view_transform = "AgX"
    bpy.ops.render.render(write_still=True)
    print("[shiro] preview", path)
    # restore plain materials for export
    for mat in obj.data.materials:
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        for node in list(nt.nodes):
            if node.bl_idname in {"ShaderNodeVertexColor", "ShaderNodeSeparateColor", "ShaderNodeMix"}:
                nt.nodes.remove(node)
        bsdf.inputs["Base Color"].default_value = (*PALETTE[mat.name], 1)
    for o in (so, cam):
        bpy.data.objects.remove(o)


if PREVIEW:
    preview(PREVIEW)

if OUT and not PREVIEW_ONLY:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_materials="EXPORT",
        export_apply=True,
    )
    print("[shiro] exported", OUT)
