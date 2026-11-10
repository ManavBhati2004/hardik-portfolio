import type * as THREE from 'three'

/* ─────────────────────────────────────────────────────────────────────────────
   Mutable scene store — written by DOM-side code (scroll, GSAP timelines) and
   read inside useFrame. No React state, so scrolling never re-renders the canvas.

   Ownership (one writer per field):
   - scroll hook        → scrollY, progress, heroProgress, velocity
   - section triggers   → cameraT, section, dim, katanaSink, katanaFinale, fogThicken
   - preloader          → fogPart, moonPresence
   - intro timeline     → katanaRise, ringPresence, branchIn, introDone
   - WarmUp (in Canvas) → ready
   ───────────────────────────────────────────────────────────────────────────── */

export interface SceneStore {
  /** World position of the sword tip (written by Katana, read by Water). */
  swordTip: THREE.Vector3
  /** World position of the sword guard (depth-of-field focus). */
  swordCenter: THREE.Vector3
  /** Sword angular speed around its axis (rad/s, signed) — drives the tassel. */
  swordSpin: number
  /** False while the sword is fully sunk (water ignores the tip). */
  swordVisible: boolean
  /** Smoothed (Lenis) scroll offset in px. */
  scrollY: number
  /** Lenis velocity (px / frame). */
  velocity: number
  /** 0 → 1 over the whole document. */
  progress: number
  /** 0 → 1 over the first viewport (hero section). */
  heroProgress: number

  /** Camera path parameter: 0 hero, 1 craft, 2 legacy, 3 gallery, 4 contact. */
  cameraT: number
  /** Active section index 0..3 (contact counts as 3 for the HUD, 4 internally). */
  section: number
  /** 0 → 1 scene darkening behind dense content. */
  dim: number
  /** Extra fog density for the camera journey (0..1). */
  fogThicken: number

  /** Preloader mist parting 0 (closed) → 1 (parted). */
  fogPart: number
  /** Moon presence 0 → 1 (fade + brighten). */
  moonPresence: number
  /** Moon ring presence 0 → 1 (brightens slightly above 1 in the finale). */
  ringPresence: number
  /** Blossom branch intro 0 (off-frame) → 1 (in place). */
  branchIn: number
  /** Katana intro rise 0 (under water) → 1 (rest). */
  katanaRise: number
  /** Katana sink after the hero 0 (shown) → 1 (sunk, hidden). */
  katanaSink: number
  /** Katana finale rise at Contact 0 → 1. */
  katanaFinale: number

  /** Real asset loading progress 0..100 (from the loading manager). */
  loadProgress: number
  /** Assets loaded and shaders compiled. */
  ready: boolean
  /** Preloader handed off to the intro (scrolling allowed). */
  introStarted: boolean
  /** Hero intro finished. */
  introDone: boolean
  /** User prefers reduced motion. */
  reducedMotion: boolean
  /** Canvas should render (tab visible). */
  active: boolean
  /** Canvas mostly covered by content → render cheaper. */
  covered: boolean
}

const prefersReduced =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

export const sceneStore: SceneStore = {
  // three.js vectors are attached by the scene chunk (keeps three out of the main bundle)
  swordTip: null as unknown as THREE.Vector3,
  swordCenter: null as unknown as THREE.Vector3,
  swordSpin: 0,
  swordVisible: true,
  scrollY: 0,
  velocity: 0,
  progress: 0,
  heroProgress: 0,

  cameraT: 0,
  section: 0,
  dim: 0,
  fogThicken: 0,

  fogPart: 0,
  moonPresence: 0,
  ringPresence: 0,
  branchIn: 0,
  katanaRise: 0,
  katanaSink: 0,
  katanaFinale: 0,

  loadProgress: 0,
  ready: false,
  introStarted: false,
  introDone: false,
  reducedMotion: prefersReduced,
  active: true,
  covered: false,
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  mq.addEventListener?.('change', (e) => {
    sceneStore.reducedMotion = e.matches
  })
}

// Dev-only handle for visual QA scripts (stripped from production builds)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __scene: SceneStore }).__scene = sceneStore
}

/** Motion multiplier for ambient (time-driven) animation. */
export function ambientMotion(): number {
  return sceneStore.reducedMotion ? 0.15 : 1
}

/** Tiny pub/sub for one-off events (ready, intro start). */
type Listener = () => void
const listeners: Record<string, Set<Listener>> = {}
export function onSceneEvent(name: string, fn: Listener) {
  ;(listeners[name] ??= new Set()).add(fn)
  return (): void => {
    listeners[name]?.delete(fn)
  }
}
export function emitSceneEvent(name: string) {
  listeners[name]?.forEach((fn) => fn())
}
