import { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { MorphSVGPlugin } from 'gsap/MorphSVGPlugin'
import { getTheme, type Theme } from './theme'
import { getInkOverlay, type Point } from './ink/inkOverlay'
import './ThemeToggle.css'

gsap.registerPlugin(MorphSVGPlugin)

/* Sun ↔ moon icon (poses and morph from "Ink Bleed" by Codemure, MIT License). */
const SUN = 'M12 7a5 5 0 1 1 0 10a5 5 0 1 1 0-10z'
const MOON = 'M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a7.2 7.2 0 0 0 9.7 9.7z'
const POSE: Record<Theme, { body: string; rays: { scale: number; opacity: number; rotation: number }; icon: number }> = {
  // the icon shows what the scene IS: moon by night, sun by day
  dark: { body: MOON, rays: { scale: 0.2, opacity: 0, rotation: -60 }, icon: -25 },
  light: { body: SUN, rays: { scale: 1, opacity: 1, rotation: 0 }, icon: 0 },
}
const RAYS = [0, 45, 90, 135, 180, 225, 270, 315]

export function ThemeToggle({ className = '' }: { className?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null!)
  const svgRef = useRef<SVGSVGElement>(null!)
  const bodyRef = useRef<SVGPathElement>(null!)
  const raysRef = useRef<SVGGElement>(null!)

  useEffect(() => {
    const rays = Array.from(raysRef.current.querySelectorAll('line'))
    const setPose = (t: Theme) => {
      const p = POSE[t]
      gsap.set(bodyRef.current, { morphSVG: p.body })
      gsap.set(rays, { scale: p.rays.scale, opacity: p.rays.opacity, svgOrigin: '12 12' })
      gsap.set(raysRef.current, { rotation: p.rays.rotation, svgOrigin: '12 12' })
      gsap.set(svgRef.current, { rotation: p.icon, transformOrigin: '50% 50%' })
      btnRef.current.setAttribute('aria-pressed', String(t === 'light'))
    }
    setPose(getTheme())

    let tl: gsap.core.Timeline | null = null
    const morph = (to: Theme, duration: number) => {
      tl?.kill()
      const p = POSE[to]
      tl = gsap.timeline({ defaults: { duration, ease: 'power3.out' } })
      tl.to(bodyRef.current, { morphSVG: { shape: p.body, shapeIndex: 'auto' } }, 0)
        .to(rays, { scale: p.rays.scale, opacity: p.rays.opacity, svgOrigin: '12 12', stagger: duration * 0.035 }, 0)
        .to(raysRef.current, { rotation: p.rays.rotation, svgOrigin: '12 12' }, 0)
        .to(svgRef.current, { rotation: p.icon, transformOrigin: '50% 50%' }, 0)
      btnRef.current.setAttribute('aria-pressed', String(to === 'light'))
    }

    const ink = getInkOverlay()
    if (ink) ink.onMorph = (to, d) => morph(to, d)

    const fire = (pt?: Point) => getInkOverlay()?.toggle(pt)

    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.key.toLowerCase() !== 't') return
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      fire()
    }
    window.addEventListener('keydown', onKey)
    const btn = btnRef.current
    const onClick = (e: MouseEvent) => {
      // keyboard activation (detail 0) spreads from the button itself
      const r = btn.getBoundingClientRect()
      fire(e.detail === 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: e.clientX, y: e.clientY })
    }
    btn.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      btn.removeEventListener('click', onClick)
      tl?.kill()
    }
  }, [])

  return (
    <button
      ref={btnRef}
      type="button"
      className={`theme-toggle ${className}`}
      aria-label="Switch between day and night"
      title="Day / night (T)"
      data-intro="nav-cta"
    >
      <svg ref={svgRef} viewBox="0 0 24 24" aria-hidden="true">
        <g ref={raysRef} className="theme-toggle-rays">
          {/* each ray keeps its own angle on a wrapper; GSAP only scales / fades the line itself */}
          {RAYS.map((a) => (
            <g key={a} transform={`rotate(${a} 12 12)`}>
              <line x1="12" y1="1.6" x2="12" y2="3.8" />
            </g>
          ))}
        </g>
        <path ref={bodyRef} className="theme-toggle-body" d={MOON} />
      </svg>
    </button>
  )
}

export default ThemeToggle
