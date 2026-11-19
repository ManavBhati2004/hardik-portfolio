import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import './Preloader.css'
import { onSceneEvent, sceneStore } from '../scene/store'
import { startIntro } from '../motion/introTimeline'
import { getLenis } from '../hooks/useScrollProgress'

/* ─────────────────────────────────────────────────────────────────────────────
   "Fog Parting" preloader — the opening shot.
   1. The real 3D mist (VolumetricFog) fills the view from the first canvas frame; a faint 侍
      and a 000 → 100 counter sit inside it. The counter follows asset loading (≈ 85 %) and
      then the shader / texture warm-up (the rest), so it never idles at 99.
   2. One overlapped move, not a chain (≈ 1.4 s): as the count lands on 100 the mark and
      counter dissolve while the mist parts in depth (near bank first) and the camera drifts
      forward; the hero intro starts at ~55 % of the parting, so the katana rises through it.
   Every step is marked with performance.mark('pl:…') for traces.
   ───────────────────────────────────────────────────────────────────────────── */
/** Seconds the mist takes to part. */
const PART = 1.4
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
    let first = false
    let assets = false
    const tick = () => {
      if (done.current) return
      const p = sceneStore.loadProgress
      if (p > 0 && !first) {
        first = true
        performance.mark('pl:progress-first')
      }
      if (p >= 85 && !assets) {
        assets = true
        performance.mark('pl:assets')
      }
      const target = Math.min(99, Math.floor(p))
      if (target === last) return
      last = target
      tweenRef.current?.kill()
      tweenRef.current = gsap.to(shown.current, {
        v: Math.max(target, shown.current.v),
        duration: 0.5,
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
      performance.mark('pl:ready')
      const reduced = sceneStore.reducedMotion
      tweenRef.current?.kill()
      const tl = gsap.timeline({
        onComplete: () => {
          root.style.display = 'none'
          performance.mark('pl:done')
          sceneStore.introStarted = true
          getLenis()?.start()
        },
      })
      if (reduced) {
        tl.to(root, { opacity: 0, duration: 0.6, ease: 'power1.inOut' }, 0)
          .to(sceneStore, { fogPart: 1, moonPresence: 1, duration: 0.6, ease: 'none' }, 0)
          .add(() => {
            performance.mark('pl:intro')
            void startIntro()
          }, 0.3)
        return
      }
      // all at once: land the count on 100, dissolve the mark and counter into the mist,
      // part the mist and start the hero while it is still opening
      const write = () => {
        if (countRef.current) countRef.current.textContent = String(Math.round(shown.current.v)).padStart(3, '0')
      }
      performance.mark('pl:part')
      tl.to(shown.current, { v: 100, duration: Math.min(0.3, Math.max(0.12, (100 - shown.current.v) / 200)), ease: 'power1.out', onUpdate: write }, 0)
        .to(root.querySelectorAll('.preloader-mark, .preloader-count'), { opacity: 0, duration: 0.5, ease: 'power2.in' }, 0.08)
        .to(root, { backgroundColor: clearBg(), duration: 0.25, ease: 'none' }, 0)
        .to(sceneStore, { fogPart: 1, duration: PART, ease: 'power2.inOut' }, 0)
        .to(sceneStore, { moonPresence: 1, duration: PART, ease: 'power2.inOut' }, 0.1)
        .add(() => {
          performance.mark('pl:intro')
          void startIntro()
        }, PART * 0.55)
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
      performance.mark('pl:canvas')
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
