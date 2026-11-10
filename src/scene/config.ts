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

/* ─── Camera journey keyframes (cameraT = 0..4) ─── */
export interface CameraKey {
  pos: THREE.Vector3
  target: THREE.Vector3
}
export const CAMERA_PATH: CameraKey[] = [
  // 0 hero
  { pos: CAMERA_POSITION.clone(), target: CAMERA_TARGET.clone() },
  // 1 craft — dolly forward and down to the waterline
  { pos: new THREE.Vector3(-0.4, -1.75, 5.6), target: new THREE.Vector3(-0.2, -1.55, -4) },
  // 2 legacy — lateral glide along the waterline past the right cliff / torii
  { pos: new THREE.Vector3(3.6, -1.55, 4.2), target: new THREE.Vector3(5.6, -1.0, -8) },
  // 3 gallery — tilt up toward the sky, stars and ring become the backdrop
  { pos: new THREE.Vector3(1.2, -1.2, 6.4), target: new THREE.Vector3(0.4, 3.8, -8) },
  // 4 contact — back near the hero framing
  { pos: new THREE.Vector3(0.15, -1.05, 8.6), target: new THREE.Vector3(0.1, -0.35, 0) },
]
