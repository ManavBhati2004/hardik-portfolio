import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { CRAFT_INTRO, DISCIPLINES, TOOLS } from '../data/craft'
import { setupReveals } from '../motion/sections'
import { sceneStore } from '../scene/store'
import './Craftsmanship.css'

/* 02 — Craftsmanship. Left: label + ink-revealed 技, heading, intro.
   Right: disciplines as large thin-serif rows; hover/focus slides the row,
   shows a crimson index and expands a one-line description (one GSAP timeline per row). */
export function Craftsmanship() {
  const rootRef = useRef<HTMLDivElement>(null!)

  useEffect(() => {
    const root = rootRef.current
    const undo = setupReveals(root)
    const canHover = window.matchMedia('(hover: hover)').matches
    const ctx = gsap.context(() => {
      root.querySelectorAll<HTMLElement>('.craft-row').forEach((row) => {
        const q = gsap.utils.selector(row)
        const desc = q('.craft-row-desc')[0] as HTMLElement
        if (!canHover) {
          gsap.set(desc, { height: 'auto', opacity: 1 })
          return
        }
        gsap.set(desc, { height: 0, opacity: 0 })
        const tl = gsap
          .timeline({ paused: true, defaults: { ease: 'power3.out', duration: 0.6 } })
          .to(q('.craft-row-title'), { x: sceneStore.reducedMotion ? 0 : 8, color: '#ffffff' }, 0)
          .to(q('.craft-row-num'), { opacity: 1, x: 0 }, 0)
          .to(desc, { height: 'auto', opacity: 1, duration: 0.55 }, 0.05)
          .to(q('.craft-row-line'), { scaleX: 1, duration: 0.8, ease: 'power3.inOut' }, 0)
        const on = () => tl.timeScale(1).play()
        const off = () => tl.timeScale(1.3).reverse()
        row.addEventListener('pointerenter', on)
        row.addEventListener('pointerleave', off)
        row.addEventListener('focusin', on)
        row.addEventListener('focusout', off)
      })

      // rows enter with a staggered masked rise
      gsap.fromTo(
        root.querySelectorAll('.craft-row-inner'),
        { yPercent: sceneStore.reducedMotion ? 0 : 105, opacity: sceneStore.reducedMotion ? 0 : 1 },
        {
          yPercent: 0,
          opacity: 1,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.07,
          scrollTrigger: { trigger: root.querySelector('.craft-list'), start: 'top 78%', once: true },
        }
      )
    }, root)
    return () => {
      ctx.revert()
      undo()
    }
  }, [])

  return (
    <div className="section craft" ref={rootRef}>
      <div className="section-inner craft-inner">
        <div className="craft-left">
          <span className="eyebrow" data-reveal="rise">
            <span className="eyebrow-num">02</span> — Craftsmanship
          </span>
          <span className="craft-kanji" lang="ja" aria-hidden="true" data-reveal="ink" data-ink="tl" data-ink-duration="1.4">
            技
          </span>
          <h2 className="section-heading craft-heading" data-reveal="lines">
            {CRAFT_INTRO.heading[0]}
            <br />
            <em>{CRAFT_INTRO.heading[1]}</em>
          </h2>
          <p className="craft-body" data-reveal="lines">
            {CRAFT_INTRO.body}
          </p>
          <div className="craft-tools" data-reveal="rise">
            <span className="craft-tools-label">Tools</span>
            <ul>
              {TOOLS.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>

        <ul className="craft-list">
          {DISCIPLINES.map((d, i) => (
            <li key={d.title} className="craft-row" tabIndex={0}>
              <div className="craft-row-inner">
                <span className="craft-row-num">{String(i + 1).padStart(2, '0')}</span>
                <span className="craft-row-title">{d.title}</span>
                <p className="craft-row-desc">
                  <span>{d.description}</span>
                </p>
              </div>
              <span className="craft-row-line" aria-hidden="true" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export default Craftsmanship
