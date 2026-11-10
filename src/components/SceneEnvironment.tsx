import { Environment, Lightformer } from '@react-three/drei'
import { MOON_POSITION } from '../scene/config'

/* ─────────────────────────────────────────────────────────────────────────────
   Image-based lighting for the night scene.
   Lightformers are rendered once into a cube map: emissive panels that the
   PBR materials (steel, wet rock, bark, petals) reflect as soft studio-like
   highlights. A dim crimson panel on the moon side keeps reflections in
   the scene's palette without tinting everything red.
   ───────────────────────────────────────────────────────────────────────────── */
export function SceneEnvironment() {
  return (
    <Environment resolution={256} frames={1} environmentIntensity={0.55}>
      <color attach="background" args={['#030304']} />
      {/* Long cool key strip above-right: the main sweep of light along the blade */}
      <Lightformer
        form="rect"
        intensity={3.2}
        color="#e6ebf2"
        position={[4, 5, 5]}
        scale={[9, 0.9, 1]}
        target={[0, 0, 0]}
      />
      {/* Narrow vertical strip front-left: edge highlight on the blade bevel */}
      <Lightformer
        form="rect"
        intensity={1.6}
        color="#d4dae4"
        position={[-5, 1.5, 4]}
        scale={[0.6, 6, 1]}
        target={[0, 0, 0]}
      />
      {/* Moon side: restrained crimson glow from behind */}
      <Lightformer
        form="circle"
        intensity={2.4}
        color="#7a1414"
        position={[MOON_POSITION.x, MOON_POSITION.y + 1, -12]}
        scale={6}
        target={[0, 0, 0]}
      />
      {/* Large soft panel behind the camera: what the blade's flat face mirrors (silver sheen) */}
      <Lightformer
        form="rect"
        intensity={3}
        color="#e9edf3"
        position={[1.5, -0.5, 12]}
        scale={[24, 12, 1]}
        target={[0, 0, 0]}
      />
      {/* Low crimson bounce from the water/moonlit mist: warms the lower blade toward the tip */}
      <Lightformer
        form="rect"
        intensity={1.4}
        color="#9c1a16"
        position={[0, -3.5, 9]}
        scale={[14, 3, 1]}
        target={[0, 0, 0]}
      />
      {/* Soft overhead fill */}
      <Lightformer
        form="rect"
        intensity={0.45}
        color="#b9c0cc"
        position={[0, 8, 0]}
        rotation-x={Math.PI / 2}
        scale={[14, 14, 1]}
      />
      {/* Dark water bounce from below */}
      <Lightformer
        form="rect"
        intensity={0.12}
        color="#2a2a30"
        position={[0, -4, 0]}
        rotation-x={-Math.PI / 2}
        scale={[30, 30, 1]}
      />
    </Environment>
  )
}

export default SceneEnvironment
