import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { VolumetricFogEffect } from './VolumetricFog'
import {
  EffectComposer,
  N8AO,
  Bloom,
  ToneMapping,
  Vignette,
  Noise,
  SMAA,
  DepthOfField,
} from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode, type BloomEffect, type NoiseEffect, type VignetteEffect } from 'postprocessing'
import { sceneStore } from '../scene/store'

export type QualityTier = 'high' | 'low'

/* ─────────────────────────────────────────────────────────────────────────────
   Render-quality post stack (one composer, HDR half-float buffers):
   1. N8AO   — soft screen-space ambient occlusion (contact shadows, crevices)
   2. DoF    — very mild lens depth of field, focused on the sword
   3. Bloom  — high threshold: only genuine highlights (moon rim, steel glints)
   4. AgX    — filmic tone mapping for the whole frame (keeps crimson from going neon)
   5. Vignette + fine film grain, SMAA for clean edges
   Low tier (phones, or slow desktops after the fps sample) drops the two
   expensive passes — AO and DoF — and keeps the look-defining ones.
   ───────────────────────────────────────────────────────────────────────────── */
export function PostFX({ quality, focusTarget }: { quality: QualityTier; focusTarget: THREE.Vector3 }) {
  // raymarched volumetric mist (24 steps; 12 on the low tier)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const fog = useMemo(() => new VolumetricFogEffect(camera, 24), [camera])
  useEffect(() => fog.setSteps(quality === 'low' ? 12 : 24), [fog, quality])
  useEffect(() => {
    // dev-only handle on the MOUNTED instance (for live tuning in the browser)
    if (import.meta.env.DEV) (window as unknown as { __fog: VolumetricFogEffect }).__fog = fog
    return () => fog.dispose()
  }, [fog])

  // The effects are built once. Day / night only changes their values (no rebuild, so no
  // shader recompile when the theme is toggled):
  // - a bright misty morning wants a much gentler corner falloff than the night scene
  // - the bright day sky must not bloom: only the sun core and steel glints exceed the threshold
  // - film grain reads as dirt on a bright frame: much lighter by day
  const bloomRef = useRef<BloomEffect>(null)
  const vigRef = useRef<VignetteEffect>(null)
  const noiseRef = useRef<NoiseEffect>(null)
  const lastDay = useRef(-1)
  useFrame(() => {
    const day = sceneStore.day > 0.5 ? 1 : 0
    // (the effect refs arrive a frame or two after mount: only mark as applied once they exist)
    if (day === lastDay.current || !bloomRef.current || !vigRef.current || !noiseRef.current) return
    lastDay.current = day
    if (bloomRef.current) bloomRef.current.luminanceMaterial.threshold = day ? 2.6 : 1.0
    if (vigRef.current) {
      vigRef.current.offset = day ? 0.4 : 0.28
      vigRef.current.darkness = day ? 0.28 : 0.62
    }
    if (noiseRef.current) noiseRef.current.blendMode.opacity.value = (quality === 'low' ? 0.28 : 0.32) * (day ? 0.1 : 1)
  })

  if (quality === 'low') {
    return (
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <primitive object={fog} dispose={null} />
        <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.12} intensity={0.34} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette ref={vigRef} offset={0.28} darkness={0.62} />
        <Noise ref={noiseRef} premultiply opacity={0.28} blendFunction={BlendFunction.SOFT_LIGHT} />
        <SMAA />
      </EffectComposer>
    )
  }

  return (
    <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
      <N8AO
        // halfRes uses a render-target path that is incompatible with this three.js version
        halfRes={false}
        quality="medium"
        aoRadius={0.9}
        distanceFalloff={0.6}
        intensity={2.4}
        color="black"
      />
      <primitive object={fog} dispose={null} />
      {/* gentle and at near-full resolution: rocks and shrine stay crisp, only the far distance softens */}
      <DepthOfField target={focusTarget} focalLength={0.14} bokehScale={0.7} height={900} />
      <Bloom ref={bloomRef} mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.12} intensity={0.38} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette ref={vigRef} offset={0.28} darkness={0.62} />
      <Noise ref={noiseRef} premultiply opacity={0.32} blendFunction={BlendFunction.SOFT_LIGHT} />
      <SMAA />
    </EffectComposer>
  )
}

export default PostFX
