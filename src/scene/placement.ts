import * as THREE from 'three'
import { CAMERA_FOV, CAMERA_POSITION, CAMERA_TARGET } from './config'

const _v = new THREE.Vector3()

/**
 * World position that appears at the given NDC (-1..1) at `distance` from the camera.
 * Used to keep the composition (sword, branch, moon) matched to the reference
 * across aspect ratios.
 */
export function pointAtNdc(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  distance: number,
  target = new THREE.Vector3()
): THREE.Vector3 {
  camera.updateMatrixWorld()
  _v.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize()
  return target.copy(camera.position).addScaledVector(_v, distance)
}

/** Screen percentage (0–100, from top-left) → NDC. */
export const pctToNdc = (xPct: number, yPct: number): [number, number] => [xPct / 50 - 1, 1 - yPct / 50]

/**
 * The fixed hero camera, independent of the live (scroll-animated) camera.
 * Every composition placement is computed against it, so objects stay where
 * the reference puts them while the camera journeys through the scene.
 */
const _base = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.1, 220)
export function heroCamera(aspect: number): THREE.PerspectiveCamera {
  _base.aspect = aspect
  _base.fov = CAMERA_FOV
  _base.position.copy(CAMERA_POSITION)
  _base.lookAt(CAMERA_TARGET)
  _base.updateProjectionMatrix()
  _base.updateMatrixWorld()
  return _base
}

/** World-space height of the view frustum at `distance` for the hero camera. */
export function frustumHeightAt(distance: number, fov = CAMERA_FOV): number {
  return 2 * distance * Math.tan(THREE.MathUtils.degToRad(fov) / 2)
}

export const isMobileViewport = () =>
  typeof window !== 'undefined' && window.innerWidth < 768
