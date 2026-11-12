import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { PROJECTS, type Project } from '../data/projects'
import { sceneStore } from '../scene/store'
import { setupReveals, unrollOnScroll } from '../motion/sections'
import { BrushStroke, Hanko, kanjiNumeral } from './vintage/Vintage'
import { ProjectOverlay } from './ProjectOverlay'
import './SelectedWork.css'

gsap.registerPlugin(ScrollTrigger)

/* ─────────────────────────────────────────────────────────────────────────────
   Project card — a hanging scroll (kakejiku): cord, top rod, paper mount with brocade
   strips around the picture, title block with a seal, bottom roller.
   It unrolls when it enters; hover runs ONE GSAP timeline per card (image scale inside
   the clip, overlay, view indicator, title shift, seal press, a slow sway from the
   hanging point) plus a quickTo pointer parallax on a separate inner layer.
   ───────────────────────────────────────────────────────────────────────────── */
function WorkCard({
  project,
  index,
  featured,
  onOpen,
}: {
  project: Project
  index: number
  featured?: boolean
  onOpen: (p: Project, thumb: HTMLElement) => void
}) {
  const cardRef = useRef<HTMLElement>(null!)
  const thumbRef = useRef<HTMLDivElement>(null!)
  const mediaRef = useRef<HTMLDivElement>(null!)
  const parallaxRef = useRef<HTMLDivElement>(null!)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const card = cardRef.current
    const reduced = sceneStore.reducedMotion
    const q = gsap.utils.selector(card)

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } })
      tl.to(mediaRef.current, { scale: reduced ? 1 : 1.045, duration: 0.9 }, 0)
        .to(q('.work-card-overlay'), { opacity: 1, duration: 0.6, ease: 'power2.out' }, 0)
        .fromTo(q('.work-card-view'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.55 }, 0.08)
        .to(q('.work-card-title'), { x: reduced ? 0 : 6, color: '#a3201a', duration: 0.6 }, 0.02)
        .to(q('.work-card-cat'), { x: reduced ? 0 : 6, duration: 0.6 }, 0.06)

      // a hanging scroll stirred by the hand: slow sway from the cord, never looping
      const sway = gsap.timeline({ paused: true })
      if (!reduced) {
        sway.to(card, { keyframes: [{ rotation: 0.5, duration: 0.7 }, { rotation: -0.3, duration: 0.9 }, { rotation: 0, duration: 0.9 }], ease: 'sine.inOut', transformOrigin: '50% 0%' })
      }

      const px = gsap.quickTo(parallaxRef.current, 'x', { duration: 0.8, ease: 'power3.out' })
      const py = gsap.quickTo(parallaxRef.current, 'y', { duration: 0.8, ease: 'power3.out' })

      let videoTimer = 0
      const startVideo = () => {
        const v = videoRef.current
        if (!v) return
        videoTimer = window.setTimeout(() => {
          v.currentTime = 0
          v.play()
            .then(() => gsap.to(v, { opacity: 1, duration: 0.6, ease: 'power2.out', overwrite: true }))
            .catch(() => undefined)
        }, 250)
      }
      const stopVideo = () => {
        window.clearTimeout(videoTimer)
        const v = videoRef.current
        if (!v) return
        gsap.to(v, { opacity: 0, duration: 0.45, ease: 'power2.out', overwrite: true, onComplete: () => v.pause() })
      }

      const enter = () => {
        tl.timeScale(1).play()
        if (!sway.isActive()) sway.restart()
        startVideo()
      }
      const leave = () => {
        // slightly faster reverse + parallax settle → no snap, never stuck mid-state
        tl.timeScale(1.25).reverse()
        px(0)
        py(0)
        stopVideo()
      }
      const move = (e: PointerEvent) => {
        if (reduced) return
        const r = card.getBoundingClientRect()
        const nx = (e.clientX - r.left) / r.width - 0.5
        const ny = (e.clientY - r.top) / r.height - 0.5
        px(-nx * 14)
        py(-ny * 9)
      }

      card.addEventListener('pointerenter', enter)
      card.addEventListener('pointerleave', leave)
      card.addEventListener('pointermove', move)
      card.addEventListener('focusin', enter)
      card.addEventListener('focusout', leave)

      /* entrance: the scroll unrolls, the title block settles, the seal is pressed */
      const info = q('.work-card-index, .work-card-meta')
      const seal = q('.work-card-seal')
      gsap.set(info, { opacity: 0, y: reduced ? 0 : 12 })
      gsap.set(seal, { opacity: 0, scale: reduced ? 1 : 1.7, rotation: reduced ? -4 : -16 })
      unrollOnScroll(card, (index % 2) * 0.14, () => {
        gsap.to(info, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.1 })
        gsap.to(seal, { opacity: 1, scale: 1, rotation: -4, duration: 0.45, ease: 'power4.in', delay: 0.55 })
      })

      return () => {
        card.removeEventListener('pointerenter', enter)
        card.removeEventListener('pointerleave', leave)
        card.removeEventListener('pointermove', move)
        card.removeEventListener('focusin', enter)
        card.removeEventListener('focusout', leave)
        window.clearTimeout(videoTimer)
      }
    }, card)

    return () => ctx.revert()
  }, [index])

  return (
    <article ref={cardRef} className={`work-card kake${featured ? ' work-card--featured' : ''}`}>
      <a
        className="work-card-link"
        href={project.href ?? '#work'}
        aria-label={`${project.title} — ${project.category}${project.year ? `, ${project.year}` : ''}. Open details`}
        onClick={(e) => {
          e.preventDefault()
          onOpen(project, thumbRef.current)
        }}
      >
        <span className="kake-cord" aria-hidden="true" />
        <span className="scroll-rod scroll-rod--slim" aria-hidden="true" />
        <div className="kake-body washi" data-unroll-body>
        <span className="brocade" aria-hidden="true" />
        <div className="work-card-thumb" ref={thumbRef}>
          <div className="work-card-media" ref={mediaRef}>
            <div className="work-card-parallax" ref={parallaxRef}>
              {project.poster ? (
                <img className="work-card-poster" src={project.poster} alt="" loading="lazy" decoding="async" />
              ) : (
                project.renderArtwork()
              )}
              {project.videoSrc && (
                <video
                  ref={videoRef}
                  className="work-card-video"
                  src={project.videoSrc}
                  muted
                  loop
                  playsInline
                  preload="none"
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
          <div className="work-card-overlay" aria-hidden="true" />
          <div className="work-card-view" aria-hidden="true">
            <span className="work-card-view-icon">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="work-card-view-label">View project</span>
          </div>
        </div>
        <span className="brocade" aria-hidden="true" />

        <div className="work-card-info">
          <span className="work-card-index kanji-num" lang="ja" aria-hidden="true">
            {kanjiNumeral(index + 1)}
          </span>
          <div className="work-card-meta">
            <h3 className="work-card-title">{project.title}</h3>
            <span className="work-card-cat">
              {project.category}
              {project.year && <span className="work-card-year"> · {project.year}</span>}
            </span>
          </div>
          <Hanko text="作" className="work-card-seal" />
        </div>
        </div>
        <span className="scroll-rod" data-unroll-rod aria-hidden="true" />
      </a>
    </article>
  )
}

export function SelectedWork() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const [open, setOpen] = useState<{ project: Project; thumb: HTMLElement } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    const undo = setupReveals(root)
    // very subtle per-column scroll parallax (±20 px, different speeds per column)
    const ctx = gsap.context(() => {
      if (sceneStore.reducedMotion) return
      root.querySelectorAll<HTMLElement>('.work-shift').forEach((el) => {
        const speed = Number(el.dataset.speed) || 0
        gsap.fromTo(
          el,
          { y: 20 * speed },
          { y: -20 * speed, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } }
        )
      })
    }, root)
    return () => {
      ctx.revert()
      undo()
    }
  }, [])

  const [featured, ...rest] = PROJECTS
  return (
    <div className="section work" ref={rootRef}>
      <div className="section-inner">
        <header className="work-header">
          <div>
            <span className="eyebrow" data-reveal="rise">
              <span className="eyebrow-num">03</span> — Legacy
              <span className="eyebrow-kanji" lang="ja" data-reveal="ink" data-ink="tl">遺</span>
            </span>
            <h2 className="section-heading" data-reveal="lines">
              Selected <em>work</em>
            </h2>
            <BrushStroke className="work-brush brush--crimson" reveal delay={0.3} />
          </div>
          <p className="work-intro" data-reveal="lines">
            A space for finished pieces. Each card below is a placeholder until the real films are added.
          </p>
        </header>

        <div className="work-grid">
          <div className="work-shift work-featured" data-speed="0">
            <WorkCard project={featured} index={0} featured onOpen={(project, thumb) => setOpen({ project, thumb })} />
          </div>
          {rest.map((project, i) => (
            <div key={project.id} className={`work-shift work-col work-col--${i % 2 === 0 ? 'a' : 'b'}`} data-speed={i % 2 === 0 ? 0.5 : 1}>
              <WorkCard project={project} index={i + 1} onOpen={(p, thumb) => setOpen({ project: p, thumb })} />
            </div>
          ))}
        </div>
      </div>

      {open && <ProjectOverlay project={open.project} origin={open.thumb} onClosed={() => setOpen(null)} />}
    </div>
  )
}

export default SelectedWork
