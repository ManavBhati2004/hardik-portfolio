import * as THREE from 'three'
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
export function PostFX({ quality, focusTarget }: { quality: QualityTier; focusTarget: THREE.Vector3 }) {
  if (quality === 'low') {
    return (
      <EffectComposer multisampling={0} frameBufferType={THREE.HalfFloatType}>
        <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.12} intensity={0.34} radius={0.65} />
        <ToneMapping mode={ToneMappingMode.AGX} />
        <Vignette offset={0.28} darkness={0.62} />
        <Noise premultiply opacity={0.28} blendFunction={BlendFunction.SOFT_LIGHT} />
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
      <DepthOfField target={focusTarget} focalLength={0.06} bokehScale={1.6} height={540} />
      <Bloom mipmapBlur luminanceThreshold={1.0} luminanceSmoothing={0.12} intensity={0.38} radius={0.72} />
      <ToneMapping mode={ToneMappingMode.AGX} />
      <Vignette offset={0.28} darkness={0.62} />
      <Noise premultiply opacity={0.32} blendFunction={BlendFunction.SOFT_LIGHT} />
      <SMAA />
    </EffectComposer>
  )
}

export default PostFX
