import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import './SectionHUD.css'
import { onSceneEvent, sceneStore } from '../scene/store'

/* "01 / 04" counter + progress line, fixed bottom-right (x ≈ 82.5%, y ≈ 91%).
   Digit changes roll vertically; the line fill is written from the scroll store
   on the GSAP ticker (no React state per frame). */
export function SectionHUD() {
  const digitWrap = useRef<HTMLSpanElement>(null!)
  const fill = useRef<HTMLSpanElement>(null!)
  const current = useRef(0)

  useEffect(() => {
    const setFill = gsap.quickSetter(fill.current, 'scaleX')
    let last = -1
    const tick = () => {
      const p = sceneStore.progress
      if (Math.abs(p - last) > 0.0005) {
        last = p
        setFill(0.12 + p * 0.88)
      }
    }
    gsap.ticker.add(tick)

    const roll = () => {
      const next = Math.min(3, sceneStore.section)
      if (next === current.current) return
      const dir = next > current.current ? 1 : -1
      current.current = next
      const wrap = digitWrap.current
      const old = wrap.querySelector<HTMLSpanElement>('.hud-digit:last-child')
      const el = document.createElement('span')
      el.className = 'hud-digit'
      el.textContent = String(next + 1).padStart(2, '0')
      wrap.appendChild(el)
      // remove any digits left over from interrupted rolls
      wrap.querySelectorAll('.hud-digit').forEach((d) => d !== el && d !== old && d.remove())
      if (sceneStore.reducedMotion) {
        old?.remove()
        return
      }
      gsap.fromTo(el, { yPercent: 100 * dir }, { yPercent: 0, duration: 0.7, ease: 'expo.out' })
      if (old) gsap.to(old, { yPercent: -100 * dir, duration: 0.7, ease: 'expo.out', onComplete: () => old.remove() })
    }
    const off = onSceneEvent('section', roll)
    return () => {
      gsap.ticker.remove(tick)
      off()
    }
  }, [])

  return (
    <div className="hud" data-intro="hud" aria-hidden="true">
      <span className="hud-count">
        <span className="hud-digits" ref={digitWrap}>
          <span className="hud-digit">01</span>
        </span>
        <span className="hud-sep">/</span>
        <span className="hud-total">04</span>
      </span>
      <span className="hud-line">
        <span className="hud-line-fill" ref={fill} />
      </span>
    </div>
  )
}

export default SectionHUD
