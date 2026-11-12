import * as THREE from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
   Shared scene constants — single source of truth for positions, layers and
   palette so shaders and components never drift apart.
   ───────────────────────────────────────────────────────────────────────────── */

/** World Y of the calm water surface. */
export const WATER_Y = -2.2

/** Camera rig: ~1 unit over the water, nearly level (≈5° up) so the water beneath the
 *  blade tip — and the sword's reflection — sits in the lower part of the frame. */
export const CAMERA_POSITION = new THREE.Vector3(0, -1.15, 8.2)
export const CAMERA_TARGET = new THREE.Vector3(0, -0.45, 0)
export const CAMERA_FOV = 40

/** Moon placement (behind the sword, upper-middle of the frame). */
export const MOON_POSITION = new THREE.Vector3(-0.05, 2.5, -8.4)
export const MOON_RADIUS = 2.35

/** Direction used for moonlight in custom shaders (from scene toward the moon). */
export const MOON_LIGHT_DIR = new THREE.Vector3(-0.1, 0.42, -1).normalize()

/** Render layers. Layer 0 is seen by both the main and reflection cameras. */
export const LAYER_DEFAULT = 0
/** Atmospheric effects that must not appear in the water reflection. */
export const LAYER_NO_REFLECT = 1

/** Colour of the far atmosphere — sky horizon, water distance fade and fog share it. */
export const HORIZON_COLOR = new THREE.Color('#0d0b0d')
export const SKY_ZENITH = new THREE.Color('#020203')

/** Restrained crimson used for moon light and accents (linear values). */
export const CRIMSON = new THREE.Color('#8c1414')

/* ─── Reference composition (screen %, from top-left, 1600×900 reference) ─── */
export const HERO_LAYOUT = {
  /** Moon centre and radius as a fraction of viewport height. */
  moon: { x: 47.5, y: 32, radiusVh: 0.16 },
  /** Ring radius (fraction of viewport height). */
  ringRadiusVh: 0.3,
  /** Katana guard (tsuba) and tip. */
  guard: { x: 52, y: 29 },
  tip: { x: 43.5, y: 84.5 },
  /** Mobile: centred, smaller, behind the text. */
  guardMobile: { x: 56, y: 30 },
  tipMobile: { x: 47, y: 74 },
  /** Blossom branch root (just outside the top-left corner). */
  branch: { x: -5, y: -2 },
} as const

/** Katana sits this far from the camera (world units). */
export const KATANA_DISTANCE = 6.1

/** The torii on the right headland (x, z); its height is found on the rock below. */
export const TORII_XZ = new THREE.Vector2(8.45, -8.6)
/** Centre of the gate, used to aim the shrine close-up (y set to the planted gate in Environment). */
export const TORII_FOCUS = new THREE.Vector3(8.39, -0.45, -8.56)

/** The castle on its wooded rise directly behind the torii headland (a few units beyond the gate
 *  along the shrine camera's view line), so gate and keep compose as one shrine precinct.
 *  Model origin = main keep axis at water level; the model's front faces +Z. */
export const SHIRO_POSITION = new THREE.Vector3(15.4, WATER_Y + 0.25, -15.6)
export const SHIRO_SCALE = 0.125
export const SHIRO_YAW = -0.55

/* ─── Camera journey keyframes ───
   `t` is the section progress (cameraT 0..4) at which the camera reaches the key.
   Hero → Craftsmanship (0 → 1): push in toward the blade, then glide right to a
   close-up of the shrine. Later sections continue from there. */
export interface CameraKey {
  t: number
  pos: THREE.Vector3
  target: THREE.Vector3
}
export const CAMERA_PATH: CameraKey[] = [
  // 0 hero
  { t: 0, pos: CAMERA_POSITION.clone(), target: CAMERA_TARGET.clone() },
  // zoom in: dolly forward and slightly down, still looking at the blade / water
  { t: 0.4, pos: new THREE.Vector3(0.7, -1.3, 5.4), target: new THREE.Vector3(1.6, -0.85, -2.5) },
  // 1 craft — shrine close-up: just above the foreground slab (its top is y ≈ −1.46), about
  // 3.7 units from the gate (≈ a third of the frame tall); aimed slightly left of the gate
  // so the torii sits right of centre, clear of the Craftsmanship copy on the left; aimed a
  // touch right and up so the distant castle (SHIRO_POSITION) reads beyond the gate
  { t: 1, pos: new THREE.Vector3(6.55, -0.2, -5.35), target: new THREE.Vector3(8.25, -0.42, -8.73) },
  // 2 legacy — drift along the headland past the shrine
  { t: 2, pos: new THREE.Vector3(7.6, -1.25, -1.8), target: new THREE.Vector3(10.5, -0.6, -11) },
  // 3 gallery — pull back and tilt up toward the sky
  { t: 3, pos: new THREE.Vector3(2.4, -1.2, 5.2), target: new THREE.Vector3(0.8, 3.8, -8) },
  // 4 contact — back near the hero framing
  { t: 4, pos: new THREE.Vector3(0.15, -1.05, 8.6), target: new THREE.Vector3(0.1, -0.35, 0) },
]

/** cameraT (0..4) → curve parameter u (0..1) so the camera hits each key exactly at its `t`. */
export function cameraTToU(t: number): number {
  const n = CAMERA_PATH.length
  if (t <= CAMERA_PATH[0].t) return 0
  for (let i = 0; i < n - 1; i++) {
    const a = CAMERA_PATH[i].t
    const b = CAMERA_PATH[i + 1].t
    if (t <= b) return (i + (t - a) / (b - a)) / (n - 1)
  }
  return 1
}
