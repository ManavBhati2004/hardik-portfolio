import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import type { Project } from '../data/projects'
import { getLenis } from '../hooks/useScrollProgress'
import { sceneStore } from '../scene/store'
import './ProjectOverlay.css'

/* Full-screen case view. The media frame FLIPs from the card thumbnail's rect into a
   hero-size frame; Esc / close reverses it back into the card. Works with placeholders. */
export function ProjectOverlay({ project, origin, onClosed }: { project: Project; origin: HTMLElement; onClosed: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null!)
  const frameRef = useRef<HTMLDivElement>(null!)
  const closeRef = useRef<HTMLButtonElement>(null!)
  const closing = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    const frame = frameRef.current
    const lenis = getLenis()
    lenis?.stop()
    const reduced = sceneStore.reducedMotion
    const lastFocus = document.activeElement as HTMLElement | null

    // FLIP: measure the final frame, invert to the card rect, play to identity
    const flipFrom = () => {
      const a = origin.getBoundingClientRect()
      const b = frame.getBoundingClientRect()
      return { x: a.left - b.left, y: a.top - b.top, scaleX: a.width / b.width, scaleY: a.height / b.height }
    }
    const from = flipFrom()
    const items = root.querySelectorAll('.po-reveal')
    const tl = gsap.timeline({ defaults: { ease: 'power3.inOut' } })
    gsap.set(origin, { opacity: 0 })
    if (reduced) {
      tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.4 })
    } else {
      tl.fromTo(root.querySelector('.po-backdrop'), { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0)
        .fromTo(root.querySelector('.po-sheet'), { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 1.1 }, 0.05)
        .fromTo(frame, { ...from, transformOrigin: '0 0' }, { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 1.0 }, 0)
        .fromTo(items, { yPercent: 110 }, { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07 }, 0.55)
        .fromTo(closeRef.current, { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.7)
    }
    closeRef.current.focus({ preventScroll: true })

    const close = () => {
      if (closing.current) return
      closing.current = true
      const done = () => {
        gsap.set(origin, { opacity: 1 })
        lenis?.start()
        lastFocus?.focus?.({ preventScroll: true })
        onClosed()
      }
      if (reduced) {
        gsap.to(root, { opacity: 0, duration: 0.3, onComplete: done })
        return
      }
      const back = flipFrom()
      gsap
        .timeline({ defaults: { ease: 'power3.inOut' }, onComplete: done })
        .to(items, { yPercent: -110, duration: 0.45, ease: 'power3.in', stagger: 0.03 }, 0)
        .to(closeRef.current, { opacity: 0, duration: 0.3 }, 0)
        .to(frame, { ...back, duration: 0.9 }, 0.2)
        .to(root.querySelector('.po-sheet'), { clipPath: 'inset(0 0 100% 0)', duration: 0.8 }, 0.25)
        .to(root.querySelector('.po-backdrop'), { opacity: 0, duration: 0.6 }, 0.45)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'Tab') {
        // simple focus trap
        const f = root.querySelectorAll<HTMLElement>('button, a[href]')
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    closeRef.current.onclick = close
    return () => {
      window.removeEventListener('keydown', onKey)
      tl.kill()
    }
  }, [origin, onClosed])

  return createPortal(
    <div className="po" ref={rootRef} role="dialog" aria-modal="true" aria-label={project.title} data-lenis-prevent>
      <div className="po-backdrop" />
      <button className="po-close" ref={closeRef} aria-label="Close project">
        <span>Close</span>
        <span className="po-close-x" aria-hidden="true" />
      </button>
      <div className="po-inner">
        <span className="po-sheet washi" aria-hidden="true" />
        <div className="po-frame" ref={frameRef}>
          {project.videoSrc ? (
            <video src={project.videoSrc} poster={project.poster} muted loop playsInline autoPlay controls={false} />
          ) : project.poster ? (
            <img src={project.poster} alt="" />
          ) : (
            project.renderArtwork()
          )}
        </div>
        <div className="po-copy">
          <div className="po-line">
            <span className="po-reveal po-cat">
              {project.category}
              {project.year && ` · ${project.year}`}
            </span>
          </div>
          <div className="po-line">
            <h2 className="po-reveal po-title">{project.title}</h2>
          </div>
          <div className="po-line">
            <p className="po-reveal po-desc">{project.description}</p>
          </div>
          {project.href && (
            <div className="po-line">
              <a className="po-reveal po-link" href={project.href} target="_blank" rel="noopener noreferrer">
                Watch the full piece ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default ProjectOverlay
