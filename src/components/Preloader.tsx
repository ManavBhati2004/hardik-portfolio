import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import './Preloader.css'
import { onSceneEvent, sceneStore } from '../scene/store'
import { startIntro } from '../motion/introTimeline'
import { getLenis } from '../hooks/useScrollProgress'

/* ─────────────────────────────────────────────────────────────────────────────
   "Fog Parting" preloader — the opening shot.
   1. Black stage; the WebGL mist veil drifts behind a faint 侍 and a 000 → 100
      counter that follows real loading progress (eased, never jumps).
   2. At 100% and once every shader is compiled: 侍 + counter fade (0.4 s), the mist
      parts horizontally from the centre (1.6 s, shader uniform) as the moon fades in.
   3. Hands off straight into the hero intro timeline.
   ───────────────────────────────────────────────────────────────────────────── */
/** The stage colour (night or day) at zero alpha, for fading the solid backdrop away. */
const clearBg = () => `rgba(${getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb').trim() || '3, 3, 4'}, 0)`

export function Preloader({ webgl }: { webgl: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null!)
  const countRef = useRef<HTMLSpanElement>(null!)
  const shown = useRef({ v: 0 })
  const tweenRef = useRef<gsap.core.Tween | null>(null)
  const done = useRef(false)

  /* eased counter toward the real progress (published by the scene chunk) */
  useEffect(() => {
    if (!webgl) return
    let last = -1
    const tick = () => {
      if (done.current) return
      const target = Math.min(99, sceneStore.loadProgress)
      if (target === last) return
      last = target
      tweenRef.current?.kill()
      tweenRef.current = gsap.to(shown.current, {
        v: Math.max(target, shown.current.v),
        duration: 0.9,
        ease: 'power2.out',
        onUpdate: () => {
          if (countRef.current) countRef.current.textContent = String(Math.round(shown.current.v)).padStart(3, '0')
        },
      })
    }
    gsap.ticker.add(tick)
    return () => gsap.ticker.remove(tick)
  }, [webgl])

  useEffect(() => {
    const root = rootRef.current
    getLenis()?.stop()
    window.scrollTo(0, 0)

    const finish = () => {
      if (done.current) return
      done.current = true
      const reduced = sceneStore.reducedMotion
      tweenRef.current?.kill()
      const tl = gsap.timeline({
        onComplete: () => {
          root.style.display = 'none'
          sceneStore.introStarted = true
          getLenis()?.start()
        },
      })
      if (reduced) {
        tl.to(root, { opacity: 0, duration: 0.6, ease: 'power1.inOut' }, 0)
          .to(sceneStore, { fogPart: 1, moonPresence: 1, duration: 0.6, ease: 'none' }, 0)
          .add(() => void startIntro(), 0.3)
        return
      }
      // count up to 100 if the real progress jumped straight to ready
      tl.to(shown.current, {
        v: 100,
        duration: Math.max(0.15, (100 - shown.current.v) / 160),
        ease: 'power1.out',
        onUpdate: () => {
          if (countRef.current) countRef.current.textContent = String(Math.round(shown.current.v)).padStart(3, '0')
        },
      })
        .to(root.querySelectorAll('.preloader-mark, .preloader-count'), { opacity: 0, duration: 0.4, ease: 'power2.out' }, '+=0.15')
        .addLabel('part')
        .to(root, { backgroundColor: clearBg(), duration: 0.3, ease: 'none' }, 'part')
        .to(sceneStore, { fogPart: 1, duration: 1.6, ease: 'power3.inOut' }, 'part')
        .to(sceneStore, { moonPresence: 1, duration: 1.7, ease: 'power2.inOut' }, 'part+=0.25')
        .add(() => void startIntro(), 'part+=1.6')
    }

    if (!webgl) {
      // static fallback: no 3D to wait for — reveal once the type is ready
      document.fonts.ready.then(() => {
        sceneStore.fogPart = 1
        sceneStore.moonPresence = 1
        finish()
      })
      return
    }

    // the mist veil is drawn by WebGL from the first frame: lift the solid black then
    const offCanvas = onSceneEvent('canvas', () => {
      gsap.to(root, { backgroundColor: clearBg(), duration: 0.9, ease: 'power1.inOut', delay: 0.15 })
    })
    const offReady = onSceneEvent('ready', finish)
    if (sceneStore.ready) finish()
    // safety net: never hold the visitor on the loader forever
    const safety = window.setTimeout(finish, 25000)
    return () => {
      offCanvas()
      offReady()
      window.clearTimeout(safety)
    }
  }, [webgl])

  return (
    <div className="preloader" ref={rootRef} role="status" aria-live="polite" aria-label="Loading">
      <span className="preloader-mark" lang="ja" aria-hidden="true">侍</span>
      <span className="preloader-count">
        <span ref={countRef}>000</span>
      </span>
    </div>
  )
}

export default Preloader
