import { useEffect, useState } from 'react'
import { Environment, Lightformer } from '@react-three/drei'
import { MOON_POSITION } from '../scene/config'
import { onSceneEvent, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Image-based lighting for the scene.
   Lightformers are rendered once into a cube map: emissive panels that the
   PBR materials (steel, wet rock, bark, petals) reflect as soft studio-like
   highlights.
   - Night: a dim crimson panel on the moon side keeps reflections in the
     palette without tinting everything red.
   - Day: a bright overcast sky dome and a warm low sun — the katana reads as
     polished steel. Re-baked when the theme flips (under the ink overlay).
   ───────────────────────────────────────────────────────────────────────────── */
function NightFormers() {
  return (
    <>
      <color attach="background" args={['#030304']} />
      {/* Long cool key strip above-right: the main sweep of light along the blade */}
      <Lightformer form="rect" intensity={3.2} color="#e6ebf2" position={[4, 5, 5]} scale={[9, 0.9, 1]} target={[0, 0, 0]} />
      {/* Narrow vertical strip front-left: edge highlight on the blade bevel */}
      <Lightformer form="rect" intensity={1.6} color="#d4dae4" position={[-5, 1.5, 4]} scale={[0.6, 6, 1]} target={[0, 0, 0]} />
      {/* Moon side: restrained crimson glow from behind */}
      <Lightformer form="circle" intensity={2.4} color="#7a1414" position={[MOON_POSITION.x, MOON_POSITION.y + 1, -12]} scale={6} target={[0, 0, 0]} />
      {/* Large soft panel behind the camera: what the blade's flat face mirrors (silver sheen) */}
      <Lightformer form="rect" intensity={3} color="#e9edf3" position={[1.5, -0.5, 12]} scale={[24, 12, 1]} target={[0, 0, 0]} />
      {/* Low crimson bounce from the water/moonlit mist: warms the lower blade toward the tip */}
      <Lightformer form="rect" intensity={1.4} color="#9c1a16" position={[0, -3.5, 9]} scale={[14, 3, 1]} target={[0, 0, 0]} />
      {/* Soft overhead fill */}
      <Lightformer form="rect" intensity={0.45} color="#b9c0cc" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[14, 14, 1]} />
      {/* Dark water bounce from below */}
      <Lightformer form="rect" intensity={0.12} color="#2a2a30" position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
    </>
  )
}

function DayFormers() {
  return (
    <>
      {/* mid-grey base: the steel mirrors it, so the bright strips below read as crisp highlights */}
      <color attach="background" args={['#7d848a']} />
      {/* bright overcast dome */}
      <Lightformer form="rect" intensity={2.2} color="#f4f2ee" position={[0, 9, 0]} rotation-x={Math.PI / 2} scale={[40, 40, 1]} />
      {/* warm low sun behind the scene (where the moon is by night) */}
      <Lightformer form="circle" intensity={6} color="#fff1dc" position={[MOON_POSITION.x, MOON_POSITION.y + 1, -12]} scale={5} target={[0, 0, 0]} />
      {/* long key strip: the polished sweep along the blade */}
      <Lightformer form="rect" intensity={4} color="#ffffff" position={[4, 5, 5]} scale={[10, 1.1, 1]} target={[0, 0, 0]} />
      {/* soft panel behind the camera: the blade face mirrors a pale sky */}
      <Lightformer form="rect" intensity={1.5} color="#eef0f2" position={[1.5, 1.5, 12]} scale={[26, 5, 1]} target={[0, 0, 0]} />
      {/* misty water bounce from below */}
      <Lightformer form="rect" intensity={0.9} color="#b9c1c8" position={[0, -4, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
    </>
  )
}

export function SceneEnvironment() {
  const [day, setDay] = useState(sceneStore.day > 0.5)
  useEffect(() => onSceneEvent('theme', () => setDay(sceneStore.day > 0.5)), [])
  return (
    <Environment key={day ? 'day' : 'night'} resolution={256} frames={1} environmentIntensity={day ? 0.9 : 0.55}>
      {day ? <DayFormers /> : <NightFormers />}
    </Environment>
  )
}

export default SceneEnvironment
