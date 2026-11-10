import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { Katana } from './Katana'
import { Water } from './Water'
import { RedMoon } from './RedMoon'
import { MoonRing } from './MoonRing'
import { SkyBackground } from './SkyBackground'
import { BlossomBranch } from './AutumnTree'
import { FallingLeaves } from './FallingLeaves'
import { Environment } from './Environment'
import { GroundFog } from './GroundFog'
import { HorizonEffect } from './HorizonEffect'
import { SceneEnvironment } from './SceneEnvironment'
import { FogVeil } from './FogVeil'
import { PostFX, type QualityTier } from './PostFX'
import { CAMERA_FOV, CAMERA_PATH, CAMERA_POSITION, LAYER_NO_REFLECT, MOON_POSITION } from '../scene/config'
import { emitSceneEvent, onSceneEvent, sceneStore } from '../scene/store'
import { isMobileViewport } from '../scene/placement'

// attach the shared vectors the scene publishes into (see scene/store.ts)
sceneStore.swordTip ??= new THREE.Vector3(0, -1.4, 2)
sceneStore.swordCenter ??= new THREE.Vector3(0, 0, 2)

/* ─── Props ─── */
export type CursorRef = React.RefObject<{ x: number; y: number; smoothX: number; smoothY: number } | null>

export interface Scene3DProps {
  cursorRef: CursorRef
}

/* ─── Camera journey: damped travel along a Catmull-Rom path through the section keys ─── */
function CameraRig() {
  const camera = useThree((s) => s.camera)
  const curves = useMemo(
    () => ({
      pos: new THREE.CatmullRomCurve3(CAMERA_PATH.map((k) => k.pos), false, 'centripetal'),
      target: new THREE.CatmullRomCurve3(CAMERA_PATH.map((k) => k.target), false, 'centripetal'),
    }),
    []
  )
  const s = useRef({ t: 0, pos: new THREE.Vector3(), target: new THREE.Vector3() })

  useEffect(() => {
    camera.layers.enable(LAYER_NO_REFLECT)
  }, [camera])

  // nav jumps happen behind the slash panels: cut the camera instead of flying the whole path
  useEffect(() => onSceneEvent('jump', () => void (s.current.t = sceneStore.cameraT)), [])

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05)
    const st = s.current
    // reduced motion: no camera journey (stays on the hero framing)
    const goal = sceneStore.reducedMotion ? 0 : THREE.MathUtils.clamp(sceneStore.cameraT, 0, CAMERA_PATH.length - 1)
    st.t = THREE.MathUtils.damp(st.t, goal, 2.6, delta)
    const u = st.t / (CAMERA_PATH.length - 1)
    curves.pos.getPoint(u, st.pos)
    curves.target.getPoint(u, st.target)
    camera.position.copy(st.pos)
    camera.lookAt(st.target)
    camera.updateMatrixWorld()
  })
  return null
}

/* ─── After Suspense resolves: compile every shader, then announce "ready" ─── */
function WarmUp() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        if ('compileAsync' in gl) await gl.compileAsync(scene, camera)
        else (gl as THREE.WebGLRenderer).compile(scene, camera)
      } catch {
        /* compile is an optimisation only */
      }
      // two frames so textures upload before the reveal
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancelled) return
          sceneStore.ready = true
          emitSceneEvent('ready')
        })
      )
    }
    run()
    return () => {
      cancelled = true
    }
  }, [gl, scene, camera])
  return null
}

/* ─── Publish real loading progress to the store (read by the HTML preloader) ─── */
function ProgressReporter() {
  const progress = useProgress((s) => s.progress)
  const active = useProgress((s) => s.active)
  useEffect(() => {
    sceneStore.loadProgress = active ? Math.min(99, progress) : progress
  }, [progress, active])
  return null
}

/* dev-only: expose the live root state for visual QA (the last mounted instance wins) */
function DevHandle() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __r3f: unknown }).__r3f = get()
  }, [get])
  return null
}

/* ─── Inner scene contents (must be inside Canvas) ─── */
function SceneContents({ cursorRef, quality }: { cursorRef: CursorRef; quality: QualityTier }) {
  return (
    <>
      <DevHandle />
      <CameraRig />

      {/* Distance haze for PBR objects: neutral charcoal, same as the horizon */}
      <fogExp2 attach="fog" args={['#0d0b0d', 0.018]} />

      {/* Image-based lighting (soft reflections + ambient for every PBR material) */}
      <SceneEnvironment />

      {/* Restrained physical lighting */}
      <ambientLight intensity={0.03} color="#c8ccd4" />

      {/* Cool key from above-right: shapes the sword, tops of rocks; casts soft shadows */}
      <directionalLight
        position={[5, 7, 6]}
        intensity={1.35}
        color="#dfe5ee"
        castShadow
        shadow-mapSize={isMobileViewport() ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={6}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-camera-bottom={-5}
        shadow-camera-near={1}
        shadow-camera-far={30}
      />

      {/* Grazing rim from behind-right: reveals rock contours and blade edge */}
      <directionalLight position={[7, 2.2, -6]} intensity={1.1} color="#b8c2d0" />

      {/* Moonlight: dim crimson from the moon direction */}
      <directionalLight
        position={[MOON_POSITION.x, MOON_POSITION.y + 2, MOON_POSITION.z]}
        intensity={0.55}
        color="#a3241f"
      />

      {/* The preloader mist is outside Suspense: visible from the first frame */}
      <FogVeil />

      <Suspense fallback={null}>
        <SkyBackground />
        <RedMoon />
        <MoonRing />
        <Katana cursorRef={cursorRef} />
        <Water cursorRef={cursorRef} />
        <BlossomBranch />
        <FallingLeaves />
        <Environment />
        <GroundFog />
        <HorizonEffect />
        <WarmUp />
      </Suspense>

      <PostFX quality={quality} focusTarget={sceneStore.swordCenter} />
    </>
  )
}

/* ─── Main Canvas Wrapper ─── */
export function Scene3D({ cursorRef }: Scene3DProps) {
  const [active, setActive] = useState(true)
  const [quality, setQuality] = useState<QualityTier>(() => (isMobileViewport() ? 'low' : 'high'))
  const [dpr, setDpr] = useState<number>(() =>
    Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, isMobileViewport() ? 1.25 : 1.75)
  )

  // The canvas is the backdrop of every section now: pause only when the tab is hidden.
  // Idle animation is delta-based, so it resumes seamlessly.
  useEffect(() => {
    const update = () => {
      const next = !document.hidden
      sceneStore.active = next
      setActive(next)
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  // Adaptive quality: if the first seconds after the reveal run slow, lower resolution / effects
  useEffect(() => {
    let frames = 0
    let start = 0
    let raf = 0
    const sample = (t: number) => {
      if (!start) start = t
      frames++
      if (t - start < 2500) {
        raf = requestAnimationFrame(sample)
        return
      }
      const fps = (frames * 1000) / (t - start)
      if (fps < 40) {
        setQuality('low')
        setDpr((d) => Math.max(1, d * 0.75))
      }
    }
    const delay = window.setTimeout(() => (raf = requestAnimationFrame(sample)), 6500)
    return () => {
      window.clearTimeout(delay)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <>
    <Canvas
      shadows="percentage"
      dpr={dpr}
      frameloop={active ? 'always' : 'never'}
      gl={{
        antialias: false,
        powerPreference: 'high-performance',
        toneMapping: THREE.NoToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
        stencil: false,
      }}
      camera={{
        fov: CAMERA_FOV,
        near: 0.1,
        far: 220,
        position: CAMERA_POSITION.toArray() as [number, number, number],
      }}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        background: '#030304',
      }}
      scene={{ background: new THREE.Color('#030304') }}
      onCreated={() => {
        // the mist veil is on screen from the next frame
        requestAnimationFrame(() => emitSceneEvent('canvas'))
      }}
    >
      <SceneContents cursorRef={cursorRef} quality={quality} />
    </Canvas>
    <ProgressReporter />
    </>
  )
}

export default Scene3D
