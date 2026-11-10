import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { FRAMES } from '../data/gallery'
import { setupReveals } from '../motion/sections'
import { inkHide, inkReveal } from '../motion/inkMask'
import { sceneStore } from '../scene/store'
import './Gallery.css'

gsap.registerPlugin(ScrollTrigger)

/* 04 — Gallery: a pinned horizontal track scrubbed by vertical scroll.
   Frames skew slightly with scroll velocity (Lenis, clamped + damped), each frame
   ink-bleeds in as it enters, captions rise, and a hairline shows progress. */
export function Gallery() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const trackRef = useRef<HTMLDivElement>(null!)
  const barRef = useRef<HTMLSpanElement>(null!)

  useEffect(() => {
    const root = rootRef.current
    const track = trackRef.current
    const undo = setupReveals(root)
    const reduced = sceneStore.reducedMotion

    const ctx = gsap.context(() => {
      const distance = () => Math.max(0, track.scrollWidth - window.innerWidth)
      const setBar = gsap.quickSetter(barRef.current, 'scaleX')
      const scrub = gsap.to(track, {
        x: () => -distance(),
        ease: 'none',
        scrollTrigger: {
          trigger: root,
          start: 'top top',
          end: () => `+=${distance()}`,
          pin: true,
          scrub: reduced ? true : 1,
          invalidateOnRefresh: true,
          onUpdate: (self) => setBar(self.progress),
        },
      })

      // per-frame entrance along the horizontal track
      track.querySelectorAll<HTMLElement>('.gal-frame').forEach((frame, i) => {
        const media = frame.querySelector<HTMLElement>('.gal-media')!
        const cap = frame.querySelectorAll('.gal-cap > span')
        const corner = i % 2 === 0 ? 'bl' : 'tl'
        if (!reduced) inkHide(media, corner)
        gsap.set(cap, { yPercent: 110 })
        ScrollTrigger.create({
          trigger: frame,
          containerAnimation: scrub,
          start: 'left 92%',
          once: true,
          onEnter: () => {
            inkReveal(media, { from: corner, duration: 1.5 })
            gsap.to(cap, { yPercent: 0, duration: 1, ease: 'expo.out', delay: 0.5, stagger: 0.06 })
          },
        })
      })

      // velocity skew (separate inner layer: the track owns x, frames own skew)
      if (!reduced) {
        const skewers = Array.from(track.querySelectorAll<HTMLElement>('.gal-skew')).map((el) =>
          gsap.quickTo(el, 'skewX', { duration: 0.6, ease: 'power3.out' })
        )
        let last = 0
        const tick = () => {
          const v = gsap.utils.clamp(-6, 6, -sceneStore.velocity * 0.18)
          if (Math.abs(v - last) > 0.02) {
            last = v
            skewers.forEach((s) => s(v))
          }
        }
        gsap.ticker.add(tick)
        return () => gsap.ticker.remove(tick)
      }
    }, root)

    ScrollTrigger.refresh()
    return () => {
      ctx.revert()
      undo()
    }
  }, [])

  return (
    <div className="gallery" ref={rootRef}>
      <div className="gallery-head">
        <span className="eyebrow" data-reveal="rise">
          <span className="eyebrow-num">04</span> — Gallery
          <span className="eyebrow-kanji" lang="ja" data-reveal="ink" data-ink="tl">景</span>
        </span>
        <h2 className="section-heading" data-reveal="lines">
          Frames <em>from the edit</em>
        </h2>
      </div>

      <div className="gallery-track" ref={trackRef}>
        {FRAMES.map((f) => (
          <figure key={f.id} className="gal-frame" style={{ ['--ar' as string]: f.aspect }}>
            <div className="gal-skew">
              <div className="gal-media">{f.src ? <img src={f.src} alt={f.caption} loading="lazy" decoding="async" /> : f.art()}</div>
            </div>
            <figcaption className="gal-cap">
              <span className="gal-cap-num">{f.id}</span>
              <span>{f.caption}</span>
            </figcaption>
          </figure>
        ))}
        <div className="gal-end" aria-hidden="true">
          <span lang="ja">終</span>
        </div>
      </div>

      <div className="gallery-progress" aria-hidden="true">
        <span ref={barRef} />
      </div>
    </div>
  )
}

export default Gallery
