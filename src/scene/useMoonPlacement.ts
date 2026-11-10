import { useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CAMERA_POSITION, HERO_LAYOUT, MOON_POSITION, MOON_RADIUS } from './config'
import { frustumHeightAt, heroCamera, isMobileViewport, pctToNdc, pointAtNdc } from './placement'

/** Moon centre + world scale so it lands at the reference anchor (47.5%, 32%) with r ≈ 16% vh. */
export function useMoonPlacement() {
  const size = useThree((s) => s.size)
  return useMemo(() => {
    const aspect = size.width / Math.max(1, size.height)
    const dist = CAMERA_POSITION.distanceTo(MOON_POSITION)
    const mobile = isMobileViewport()
    const [x, y] = pctToNdc(mobile ? 52 : HERO_LAYOUT.moon.x, mobile ? 30 : HERO_LAYOUT.moon.y)
    const position = pointAtNdc(heroCamera(aspect), x, y, dist, new THREE.Vector3())
    const H = frustumHeightAt(dist)
    const radiusVh = mobile ? 0.13 : HERO_LAYOUT.moon.radiusVh
    // on narrow portrait screens keep the moon from overflowing the width
    const widthLimit = aspect < 1 ? aspect : 1
    const radius = H * radiusVh * Math.min(1, widthLimit * 1.4)
    return {
      position,
      scale: radius / MOON_RADIUS,
      radius,
      ringRadius: (radius / radiusVh) * HERO_LAYOUT.ringRadiusVh * (mobile ? 0.85 : 1),
    }
  }, [size])
}
