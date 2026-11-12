import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
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
import { BlendFunction, ToneMappingMode } from 'postprocessing'

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
export function PostFX({ quality, focusTarget, day = false }: { quality: QualityTier; focusTarget: THREE.Vector3; day?: boolean }) {
  // raymarched volumetric mist (24 steps; 12 on the low tier)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const fog = useMemo(() => new VolumetricFogEffect(camera, 24), [camera])
  useEffect(() => fog.setSteps(quality === 'low' ? 12 : 24), [fog, quality])
  useEffect(() => {
    // dev-only handle on the MOUNTED instance (for live tuning in the browser)
    if (import.meta.env.DEV) (window as unknown as { __fog: VolumetricFogEffect }).__fog = fog
    return () => fog.dispose()
  }, [fog])

  // a bright misty morning wants a much gentler corner falloff than the night scene
  const vig = day ? { offset: 0.4, darkness: 0.28 } : { offset: 0.28, darkness: 0.62 }
  // the bright day sky must not bloom: only the sun core and steel glints exceed this
  const bloomT = day ? 2.6 : 1.0
  // film grain reads as dirt on a bright frame: much lighter by day
  const grain = day ? 0.1 : 1
  if (quality === 'low') {
    return (
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <primitive object={fog} dispose={null} />
        <Bloom mipmapBlur luminanceThreshold={bloomT} luminanceSmoothing={0.12} intensity={0.34} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={vig.offset} darkness={vig.darkness} />
        <Noise premultiply opacity={0.28 * grain} blendFunction={BlendFunction.SOFT_LIGHT} />
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
      <Bloom mipmapBlur luminanceThreshold={bloomT} luminanceSmoothing={0.12} intensity={0.38} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={vig.offset} darkness={vig.darkness} />
      <Noise premultiply opacity={0.32 * grain} blendFunction={BlendFunction.SOFT_LIGHT} />
      <SMAA />
    </EffectComposer>
  )
}

export default PostFX
