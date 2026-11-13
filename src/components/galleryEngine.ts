import * as THREE from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
   Gallery canvas engine — an infinite, wrapping field of frames drawn in its own
   small WebGL canvas (separate from the R3F scene; loaded lazily so three stays
   out of the main bundle).

   Layout: a staggered grid of cells that wraps in both axes (period = whole grid,
   always larger than the viewport plus a cell, so wrapped copies never show twice).
   Motion: drag / trackpad / page scroll write a target offset; the drawn offset
   eases toward it (inertia). The eased velocity bends each plane and splits RGB.
   ───────────────────────────────────────────────────────────────────────────── */

export interface EngineFrame {
  /** width / height */
  aspect: number
  /** rasterised still (null until ready → plane draws the stage colour) */
  image: HTMLCanvasElement | HTMLImageElement | null
}

export interface EngineCallbacks {
  /** pointer / keyboard focus moved to a cell (null = none) */
  onActive: (cell: number | null, frame: number | null) => void
  /** a cell was clicked / Enter pressed */
  onOpen: (cell: number, frame: number, rect: DOMRect) => void
  /** every drawn frame: the active plane's host-local box (for the DOM caption / focus ring) */
  onTick: (box: { x: number; y: number; w: number; h: number } | null) => void
}

export interface GalleryEngine {
  setReduced(reduced: boolean): void
  setImage(frame: number, image: EngineFrame['image']): void
  setTheme(bg: [number, number, number], day: boolean): void
  setVisible(visible: boolean): void
  /** hide one cell's plane (its frame is shown full-screen) */
  setHidden(cell: number | null): void
  setInputEnabled(enabled: boolean): void
  /** viewport rect of a cell's plane */
  cellRect(cell: number): DOMRect
  /** keyboard: focus the cell nearest the centre (or move it) */
  focusNearest(): number
  moveFocus(dc: number, dr: number): number
  clearFocus(): void
  openFocused(): void
  destroy(): void
}

interface Cell {
  c: number
  r: number
  frame: number
  /** unwrapped centre in grid space */
  bx: number
  by: number
  w: number
  h: number
  /** current screen-space centre (px, relative to the host) */
  sx: number
  sy: number
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  dim: number
  focus: number
}

const VERT = /* glsl */ `
uniform vec2 uVel;      // eased drag velocity, px
uniform vec2 uViewport; // px
varying vec2 vUv;
#define PI 3.14159265
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  // bow the plane against the motion: the middle lags, the edges lead
  float bx = sin(uv.y * PI);
  float by = sin(uv.x * PI);
  wp.x -= uVel.x * bx;
  wp.y += uVel.y * by;
  // a touch of lens curvature: planes far from centre lag a little more
  vec2 n = wp.xy / (uViewport * 0.5);
  wp.x -= uVel.x * 0.35 * dot(n, n);
  wp.y += uVel.y * 0.35 * dot(n, n);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uHasTex;
uniform vec2 uShift;    // rgb split in uv units
uniform float uDim;     // 0..1 other frames dim while one is focused
uniform float uFocus;   // 0..1 the focused frame
uniform float uAlpha;
uniform vec3 uBg;
uniform float uDay;
varying vec2 vUv;
void main() {
  // focused frame zooms its image slightly inside the plane
  vec2 uv = (vUv - 0.5) * (1.0 - 0.06 * uFocus) + 0.5;
  vec3 col;
  if (uHasTex > 0.5) {
    float r = texture2D(uTex, uv + uShift).r;
    float g = texture2D(uTex, uv).g;
    float b = texture2D(uTex, uv - uShift).b;
    col = vec3(r, g, b);
  } else {
    col = vec3(0.04, 0.04, 0.05);
  }
  // soft inner vignette so frames read as stills, not flat cards
  vec2 q = vUv - 0.5;
  col *= 1.0 - 0.35 * smoothstep(0.25, 0.75, length(q * vec2(1.0, 1.2)));
  // dim toward the stage colour (theme aware)
  col = mix(col, uBg, uDim * (uDay > 0.5 ? 0.72 : 0.62));
  gl_FragColor = vec4(col, uAlpha);
  #include <colorspace_fragment>
}
`

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const wrap = (v: number, p: number) => ((v % p) + p) % p
/* deterministic per-cell jitter */
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

export function createGalleryEngine(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  frames: EngineFrame[],
  cb: EngineCallbacks,
  opts: { reduced: boolean }
): GalleryEngine {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  const geometry = new THREE.PlaneGeometry(1, 1, 24, 24)

  const textures: (THREE.Texture | null)[] = frames.map(() => null)
  const bg = new THREE.Color(0.012, 0.012, 0.016)
  let day = 0

  let reduced = opts.reduced
  let visible = false
  let inputEnabled = true
  let hiddenCell: number | null = null

  // view
  let vw = 1
  let vh = 1
  let cellW = 1
  let cellH = 1
  let cols = 0
  let rows = 0
  let pw = 1
  let ph = 1
  let cells: Cell[] = []

  // motion (offset of the grid in px)
  let ox = 0
  let oy = 0
  let tx = 0
  let ty = 0
  let velX = 0
  let velY = 0

  let hover: number | null = null
  let focus: number | null = null
  let active: number | null = null

  const makeMaterial = (frame: number) =>
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTex: { value: textures[frame] },
        uHasTex: { value: textures[frame] ? 1 : 0 },
        uVel: { value: new THREE.Vector2() },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uShift: { value: new THREE.Vector2() },
        uDim: { value: 0 },
        uFocus: { value: 0 },
        uAlpha: { value: 1 },
        uBg: { value: bg },
        uDay: { value: 0 },
      },
    })

  const layout = () => {
    const rect = host.getBoundingClientRect()
    vw = Math.max(1, rect.width)
    vh = Math.max(1, rect.height)
    const mobile = vw < 768
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75))
    renderer.setSize(vw, vh, false)
    camera.left = -vw / 2
    camera.right = vw / 2
    camera.top = vh / 2
    camera.bottom = -vh / 2
    camera.updateProjectionMatrix()

    cellW = mobile ? clamp(vw * 0.64, 200, 340) : clamp(vw * 0.25, 260, 470)
    cellH = cellW * (mobile ? 1.0 : 0.8)
    let nCols = Math.max(4, Math.ceil(vw / cellW) + 2)
    let nRows = Math.max(4, Math.ceil(vh / cellH) + 3)
    // keep the wrap seams from putting a frame next to itself
    while ((nCols - 1) % frames.length === 0) nCols++
    while ((nRows - 1) % frames.length === 0) nRows++
    if (nCols === cols && nRows === rows && cells.length) {
      // same grid: only resize planes
      for (const cell of cells) sizeCell(cell)
      return
    }
    cols = nCols
    rows = nRows
    pw = cols * cellW
    ph = rows * cellH

    for (const cell of cells) {
      scene.remove(cell.mesh)
      cell.mesh.material.dispose()
    }
    cells = []
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        // 7 frames, coprime steps → neighbours never repeat
        const frame = (c * 3 + r * 2) % frames.length
        const mesh = new THREE.Mesh(geometry, makeMaterial(frame))
        mesh.frustumCulled = false
        scene.add(mesh)
        const cell: Cell = { c, r, frame, bx: 0, by: 0, w: 0, h: 0, sx: 0, sy: 0, mesh, dim: 0, focus: 0 }
        sizeCell(cell)
        cells.push(cell)
      }
    }
    if (focus !== null && focus >= cells.length) focus = null
    hover = null
  }

  const sizeCell = (cell: Cell) => {
    const { c, r, frame } = cell
    const j1 = hash(c, r)
    const j2 = hash(r + 7, c + 3)
    const scale = 0.82 + 0.18 * j1
    const maxW = cellW * 0.8 * scale
    const maxH = cellH * 0.74 * scale
    const ar = frames[frame].aspect
    let w = maxW
    let h = w / ar
    if (h > maxH) {
      h = maxH
      w = h * ar
    }
    cell.w = w
    cell.h = h
    cell.bx = c * cellW + cellW / 2 + (j2 - 0.5) * cellW * 0.12
    cell.by = r * cellH + cellH / 2 + (c % 2 ? cellH * 0.5 : 0) + (j1 - 0.5) * cellH * 0.1
    cell.mesh.material.uniforms.uViewport.value.set(vw, vh)
  }

  const place = () => {
    for (const cell of cells) {
      cell.sx = wrap(cell.bx + ox + cellW, pw) - cellW
      cell.sy = wrap(cell.by + oy + cellH, ph) - cellH
    }
  }

  const hit = (px: number, py: number): number | null => {
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      if (Math.abs(px - cell.sx) <= cell.w / 2 && Math.abs(py - cell.sy) <= cell.h / 2) return i
    }
    return null
  }

  const setActive = () => {
    const next = focus ?? hover
    if (next === active) return
    active = next
    cb.onActive(active, active === null ? null : cells[active].frame)
  }

  /* ── input ─────────────────────────────────────────────────────────────── */
  let dragging = false
  let pointerId = -1
  let downX = 0
  let downY = 0
  let lastX = 0
  let lastY = 0
  let lastT = 0
  let pvx = 0
  let pvy = 0
  let moved = 0

  const local = (e: PointerEvent | MouseEvent) => {
    const r = host.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const onDown = (e: PointerEvent) => {
    if (!inputEnabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    dragging = true
    pointerId = e.pointerId
    downX = lastX = e.clientX
    downY = lastY = e.clientY
    lastT = performance.now()
    pvx = pvy = 0
    moved = 0
    host.classList.add('is-dragging')
  }
  const onMove = (e: PointerEvent) => {
    if (!inputEnabled) return
    if (dragging && e.pointerId === pointerId) {
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      // velocity in px / ms, lightly smoothed
      pvx = pvx * 0.6 + (dx / dt) * 0.4
      pvy = pvy * 0.6 + (dy / dt) * 0.4
      lastX = e.clientX
      lastY = e.clientY
      lastT = now
      moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY))
      tx += dx
      ty += dy
      if (reduced) {
        ox = tx
        oy = ty
      }
      if (moved > 6 && hover !== null) {
        hover = null
        setActive()
      }
      return
    }
    if (e.pointerType === 'mouse') {
      const [px, py] = local(e)
      const h = hit(px, py)
      if (h !== hover) {
        hover = h
        host.classList.toggle('is-over-frame', h !== null)
        setActive()
      }
    }
  }
  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    if (!dragging || e.pointerId !== pointerId) return
    dragging = false
    host.classList.remove('is-dragging')
    // released after a pause → no throw
    const idle = performance.now() - lastT > 90
    if (!reduced && !idle) {
      // inertia: throw the target along the release velocity
      tx += clamp(pvx, -6, 6) * 260
      ty += clamp(pvy, -6, 6) * 260
    }
    if (!cancelled && moved < 6) {
      const [px, py] = local(e)
      const h = hit(px, py)
      if (h !== null) cb.onOpen(h, cells[h].frame, cellRect(h))
    }
  }
  const onUp = (e: PointerEvent) => endDrag(e, false)
  const onCancel = (e: PointerEvent) => endDrag(e, true)
  const onLeave = () => {
    if (hover !== null) {
      hover = null
      host.classList.remove('is-over-frame')
      setActive()
    }
  }
  const onWheel = (e: WheelEvent) => {
    // horizontal trackpad swipes pan the canvas; vertical wheel stays page scroll
    if (!inputEnabled || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    e.preventDefault()
    tx -= e.deltaX
    if (reduced) ox = tx
  }

  host.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  host.addEventListener('pointerleave', onLeave)
  host.addEventListener('wheel', onWheel, { passive: false })

  /* ── keyboard focus ───────────────────────────────────────────────────── */
  const centreOn = (i: number) => {
    const cell = cells[i]
    // shortest wrapped path to the centre
    let dx = vw / 2 - cell.sx
    let dy = vh / 2 - cell.sy
    dx -= Math.round(dx / pw) * pw
    dy -= Math.round(dy / ph) * ph
    tx = ox + dx
    ty = oy + dy
    if (reduced) {
      ox = tx
      oy = ty
    }
  }
  const nearest = () => {
    let best = 0
    let bestD = Infinity
    cells.forEach((cell, i) => {
      const d = Math.hypot(cell.sx - vw / 2, cell.sy - vh / 2)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }
  const indexOf = (c: number, r: number) => wrap(c, cols) * rows + wrap(r, rows)

  /* ── loop ─────────────────────────────────────────────────────────────── */
  let lastScroll = window.scrollY
  let lastTime = performance.now()
  let raf = 0

  const tick = () => {
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    const dt = Math.min(0.05, (now - lastTime) / 1000)
    lastTime = now

    // page scroll pans the field while the section is on screen
    const sy = window.scrollY
    const ds = sy - lastScroll
    lastScroll = sy
    if (!visible) return
    if (inputEnabled && Math.abs(ds) < 400) {
      ty -= ds * 0.55
      if (reduced) oy = ty
    }

    const prevX = ox
    const prevY = oy
    if (!reduced) {
      const k = 1 - Math.pow(1 - 0.085, dt * 60)
      ox += (tx - ox) * k
      oy += (ty - oy) * k
    } else {
      ox = tx
      oy = ty
    }
    const f = dt > 0 ? 1 / (dt * 60) : 1
    const target = reduced ? 0 : 1
    const vk = 1 - Math.pow(1 - 0.18, dt * 60)
    velX += (clamp((ox - prevX) * f * 1.1, -70, 70) * target - velX) * vk
    velY += (clamp((oy - prevY) * f * 1.1, -70, 70) * target - velY) * vk

    place()
    const shiftX = reduced ? 0 : clamp(velX * 0.00028, -0.012, 0.012)
    const shiftY = reduced ? 0 : clamp(-velY * 0.00028, -0.012, 0.012)
    const ek = 1 - Math.pow(1 - 0.14, dt * 60)
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const u = cell.mesh.material.uniforms
      const isActive = active === i
      const dimT = active !== null && !isActive ? 1 : 0
      cell.dim += (dimT - cell.dim) * ek
      cell.focus += ((isActive ? 1 : 0) - cell.focus) * ek
      const s = 1 + cell.focus * 0.035
      cell.mesh.position.set(cell.sx - vw / 2, vh / 2 - cell.sy, 0)
      cell.mesh.scale.set(cell.w * s, cell.h * s, 1)
      u.uVel.value.set(velX * 0.55, velY * 0.55)
      u.uShift.value.set(shiftX, shiftY)
      u.uDim.value = cell.dim
      u.uFocus.value = cell.focus
      u.uAlpha.value = hiddenCell === i ? 0 : 1
      u.uDay.value = day
    }
    renderer.render(scene, camera)
    if (active !== null) {
      const a = cells[active]
      const s = 1 + a.focus * 0.035
      cb.onTick({ x: a.sx - (a.w * s) / 2, y: a.sy - (a.h * s) / 2, w: a.w * s, h: a.h * s })
    } else cb.onTick(null)
  }

  const ro = new ResizeObserver(() => {
    layout()
    place()
  })
  ro.observe(host)
  layout()
  // start with a frame near the centre rather than a seam
  ox = tx = -cellW * 0.35
  oy = ty = -cellH * 0.6
  place()
  raf = requestAnimationFrame(tick)

  const cellRect = (i: number) => {
    const r = host.getBoundingClientRect()
    const cell = cells[i]
    return new DOMRect(r.left + cell.sx - cell.w / 2, r.top + cell.sy - cell.h / 2, cell.w, cell.h)
  }

  return {
    setReduced(v) {
      reduced = v
    },
    setImage(frame, image) {
      textures[frame]?.dispose()
      let tex: THREE.Texture | null = null
      if (image) {
        tex = image instanceof HTMLCanvasElement ? new THREE.CanvasTexture(image) : new THREE.Texture(image)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.minFilter = THREE.LinearMipmapLinearFilter
        tex.anisotropy = 4
        tex.needsUpdate = true
      }
      textures[frame] = tex
      for (const cell of cells) {
        if (cell.frame !== frame) continue
        cell.mesh.material.uniforms.uTex.value = tex
        cell.mesh.material.uniforms.uHasTex.value = tex ? 1 : 0
      }
      // new grids pick textures from the array
    },
    setTheme(rgb, isDay) {
      bg.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
      day = isDay ? 1 : 0
    },
    setVisible(v) {
      visible = v
      if (v) {
        lastScroll = window.scrollY
        lastTime = performance.now()
      }
    },
    setHidden(cell) {
      hiddenCell = cell
    },
    setInputEnabled(v) {
      inputEnabled = v
      if (!v) {
        dragging = false
        host.classList.remove('is-dragging')
      } else {
        lastScroll = window.scrollY
      }
    },
    cellRect,
    focusNearest() {
      focus = nearest()
      centreOn(focus)
      setActive()
      return focus
    },
    moveFocus(dc, dr) {
      if (focus === null) focus = nearest()
      const cell = cells[focus]
      focus = indexOf(cell.c + dc, cell.r + dr)
      centreOn(focus)
      setActive()
      return focus
    },
    clearFocus() {
      focus = null
      setActive()
    },
    openFocused() {
      if (focus === null) return
      cb.onOpen(focus, cells[focus].frame, cellRect(focus))
    },
    destroy() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      host.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      host.removeEventListener('pointerleave', onLeave)
      host.removeEventListener('wheel', onWheel)
      for (const cell of cells) cell.mesh.material.dispose()
      textures.forEach((t) => t?.dispose())
      geometry.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
