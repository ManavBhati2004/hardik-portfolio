import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CRAFT_INTRO, DISCIPLINES, FILLER_CLIPS, SEQUENCE, TOOLS, TRACKS, type TrackId } from '../data/craft'
import { setupReveals } from '../motion/sections'
import { sceneStore } from '../scene/store'
import { drawLoop } from './craftMonitor'
import './Craftsmanship.css'

gsap.registerPlugin(ScrollTrigger)

/* 02 — Craftsmanship. Left: label + ink-revealed 技, heading, intro, tools.
   Right: two liquid-glass slabs floating over the scene — the program monitor and the edit
   timeline. Scroll scrubs the playhead; when the scroll rests the sequence plays in real time
   through the live clip and loops it. The clip under the playhead drives the monitor.
   Hover / focus / tap on a clip jumps the playhead there. Per-frame work is transform / canvas only. */

const DUR = SEQUENCE.duration
const FPS = SEQUENCE.fps
const FRAME = 1 / FPS
const ROW = (id: TrackId) => TRACKS.findIndex((t) => t.id === id)
const KIND = (id: TrackId) => TRACKS[ROW(id)].kind

const pad = (n: number) => String(n).padStart(2, '0')
const short = (sec: number) => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec) % 60)}`

/** Index of the discipline clip containing t (clips are contiguous, non-overlapping). */
function clipAt(t: number) {
  for (let i = DISCIPLINES.length - 1; i >= 0; i--) if (t >= DISCIPLINES[i].in - 1e-6) return i
  return 0
}

/** Deterministic mirrored waveform for audio clips (viewBox 0 0 100 20). */
function wavePath(seed: number, n = 90) {
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100
    const s = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
    const r = s - Math.floor(s)
    const env = 0.35 + 0.65 * Math.abs(Math.sin(i * 0.21 + seed) * Math.cos(i * 0.053 + seed * 2))
    const a = Math.max(0.6, r * env * 9.5)
    top.push(`${x.toFixed(2)},${(10 - a).toFixed(2)}`)
    bottom.unshift(`${x.toFixed(2)},${(10 + a).toFixed(2)}`)
  }
  return `M${top.join('L')}L${bottom.join('L')}Z`
}

const RULER_STEP = 6
const RULER_MARKS = Array.from({ length: Math.floor(DUR / RULER_STEP) + 1 }, (_, i) => i * RULER_STEP)

function clipStyle(track: TrackId, tin: number, tout: number): CSSProperties {
  return {
    '--in': `${(tin / DUR) * 100}%`,
    '--len': `${((tout - tin) / DUR) * 100}%`,
    '--row': ROW(track),
  } as CSSProperties
}

function ClipMedia({ track, seed }: { track: TrackId; seed: number }) {
  const kind = KIND(track)
  if (kind === 'audio')
    return (
      <svg className="nle-wave" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
        <path d={wavePath(seed)} />
      </svg>
    )
  if (kind === 'video') return <span className="nle-thumbs" aria-hidden="true" style={{ '--seed': seed % 4 } as CSSProperties} />
  return <span className="nle-fxbar" aria-hidden="true" />
}

function EditTimeline() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const timeRef = useRef<HTMLDivElement>(null!)
  const headRef = useRef<HTMLDivElement>(null!)
  const monitorRef = useRef<HTMLCanvasElement>(null!)
  const clipRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [active, setActive] = useState(0)
  const [engaged, setEngaged] = useState<number | null>(null)

  // imperative bridge so the handlers can steer the ticker without re-subscribing it
  const api = useRef({ engage: (_i: number, _sticky: boolean) => {}, release: (_i: number) => {} })

  useEffect(() => {
    const root = rootRef.current
    const reduced = sceneStore.reducedMotion
    const vertical = window.matchMedia('(max-width: 767px)')
    const monitor = monitorRef.current
    const mctx = monitor.getContext('2d', { alpha: false })!

    let tScroll = 0
    let lastScroll = -1
    let idle = 0
    let play = 0
    let shown = 0
    let prevShown = -1
    let lastActive = 0
    let engagedIdx: number | null = null
    let stickyFrom = -1
    let inView = false
    let monitorAcc = 1

    // backing stores follow the element size (not per frame)
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const mw = Math.min(760, Math.round(monitor.clientWidth * dpr))
      monitor.width = Math.max(160, mw)
      monitor.height = Math.round((monitor.width * 9) / 16)
      monitorAcc = 1
      paintStill()
    }
    const paintStill = () => {
      const d = DISCIPLINES[lastActive]
      drawLoop(mctx, d.loop, monitor.width, monitor.height, reduced ? 1.4 : Math.max(0, shown - d.in))
    }
    const ro = new ResizeObserver(size)
    ro.observe(monitor)

    // only work while the panel is on screen
    const vis = ScrollTrigger.create({
      trigger: root,
      start: 'top bottom+=10%',
      end: 'bottom top-=10%',
      onToggle: (s) => {
        inView = s.isActive
      },
    })
    inView = vis.isActive

    const st = ScrollTrigger.create({ trigger: timeRef.current, start: 'top 92%', end: 'bottom 22%' })

    // the fixed "02 / 04" counter sits bottom-right, right where the panes scroll past:
    // it steps aside while they are under it
    const hudClear = ScrollTrigger.create({
      trigger: root,
      start: 'top 99%',
      end: 'bottom 84%',
      toggleClass: { targets: document.documentElement, className: 'hud-clear' },
    })

    const place = () => {
      const p = Math.min(1, Math.max(0, shown / DUR)) * 100
      headRef.current.style.transform = vertical.matches ? `translate3d(0, ${p}%, 0)` : `translate3d(${p}%, 0, 0)`
      const a = clipAt(shown)
      if (a !== lastActive) {
        lastActive = a
        setActive(a)
        monitorAcc = 1
        if (reduced) paintStill()
      }
    }

    api.current.engage = (i, sticky) => {
      engagedIdx = i
      stickyFrom = sticky ? tScroll : -1
      const d = DISCIPLINES[i]
      if (reduced) {
        shown = play = d.in + Math.min(1.2, (d.out - d.in) / 2)
        place()
      } else if (play < d.in || play >= d.out) {
        play = d.in + 0.35
      }
      setEngaged(i)
    }
    api.current.release = (i) => {
      if (engagedIdx !== i) return
      engagedIdx = null
      stickyFrom = -1
      if (!reduced) {
        play = tScroll
        lastScroll = tScroll
        idle = 0
      }
      setEngaged(null)
    }

    const tick = (_time: number, deltaMs: number) => {
      if (!inView || document.hidden) return
      const dt = Math.min(0.1, deltaMs / 1000)

      if (!reduced) {
        tScroll = Math.min(DUR - FRAME, st.progress * DUR)
        const moved = Math.abs(tScroll - lastScroll) > 1e-4
        if (engagedIdx !== null) {
          // touch-pinned clip lets go once the reader scrolls on
          if (stickyFrom >= 0 && Math.abs(tScroll - stickyFrom) > 1.5) {
            api.current.release(engagedIdx)
          } else {
            const d = DISCIPLINES[engagedIdx]
            play += dt
            if (play >= d.out - FRAME) play = d.in
          }
        }
        if (engagedIdx === null) {
          if (moved) {
            idle = 0
            if (tScroll < lastScroll) play = tScroll // scrubbing back pulls the playhead with it
          } else idle += dt
          play = Math.max(play, tScroll)
          if (idle > 0.35) {
            // resting: play in real time and loop the live clip
            const d = DISCIPLINES[clipAt(play)]
            play += dt
            if (play >= d.out - FRAME) {
              const back = Math.max(d.in, tScroll)
              play = d.out - back > 1 ? back : d.out - FRAME
            }
          }
        }
        lastScroll = tScroll
        shown += (play - shown) * (1 - Math.exp(-dt * 14))
        if (Math.abs(play - shown) < 1e-4) shown = play
      }

      if (shown !== prevShown) {
        prevShown = shown
        place()
      }

      if (reduced) return

      // program monitor at ~30 fps, its loop clock tied to the sequence clock
      monitorAcc += dt
      if (monitorAcc >= 1 / 30) {
        monitorAcc = 0
        const d = DISCIPLINES[lastActive]
        drawLoop(mctx, d.loop, monitor.width, monitor.height, Math.max(0, shown - d.in))
      }
    }
    gsap.ticker.add(tick)

    // liquid glass: Chromium can refract the backdrop through an SVG filter
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands
    if (brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))) root.dataset.refract = ''
    // the caustic sheen on each pane drifts toward the pointer
    const panes = Array.from(root.querySelectorAll<HTMLElement>('.nle-glass'))
    const onMove = (e: PointerEvent) => {
      if (reduced || e.pointerType !== 'mouse') return
      for (const p of panes) {
        const r = p.getBoundingClientRect()
        p.style.setProperty('--mx', ((e.clientX - r.left) / r.width).toFixed(3))
        p.style.setProperty('--my', ((e.clientY - r.top) / r.height).toFixed(3))
      }
    }
    root.addEventListener('pointermove', onMove)
    const onOrient = () => place()
    vertical.addEventListener('change', onOrient)
    size()
    place()

    // entrance: the panel settles, then clips are laid onto their tracks
    const ctx = gsap.context(() => {
      if (reduced) return
      const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 82%', once: true } })
      tl.fromTo(
        root.querySelectorAll('.nle-glass'),
        { opacity: 0, y: 40, scale: 0.97 },
        { opacity: 1, y: 0, scale: 1, duration: 1.1, ease: 'expo.out', stagger: 0.14, clearProps: 'transform' }
      )
      tl.fromTo(
        root.querySelectorAll('.nle-clip'),
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.7, ease: 'expo.out', stagger: { each: 0.025, from: 'start' }, clearProps: 'transform,opacity' },
        0.25
      )
    }, root)

    return () => {
      gsap.ticker.remove(tick)
      root.removeEventListener('pointermove', onMove)
      vertical.removeEventListener('change', onOrient)
      ro.disconnect()
      vis.kill()
      st.kill()
      hudClear.kill()
      ctx.revert()
    }
  }, [])

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    clipRefs.current[(i + step + DISCIPLINES.length) % DISCIPLINES.length]?.focus()
  }

  const shownIdx = engaged ?? active
  const cur = DISCIPLINES[shownIdx]

  return (
    <div className="nle" ref={rootRef} data-engaged={engaged !== null || undefined}>
      {/* liquid-glass refraction: low-frequency turbulence bends the scene seen through the panes */}
      <svg className="nle-defs" aria-hidden="true" focusable="false">
        <filter id="nle-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="2" seed="7" result="n" />
          <feGaussianBlur in="n" stdDeviation="2" result="nb" />
          <feDisplacementMap in="SourceGraphic" in2="nb" scale="22" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      {/* program monitor */}
      <div className="nle-glass nle-view">
        <div className="nle-monitor">
          <canvas ref={monitorRef} className="nle-monitor-canvas" aria-hidden="true" />
          <span className="nle-monitor-title" key={shownIdx} aria-live="polite">
            <span>{cur.title}</span>
          </span>
        </div>
      </div>

      {/* timeline */}
      <div className="nle-glass nle-tl">
        <div className="nle-heads" aria-hidden="true">
          <span className="nle-head nle-head--ruler" />
          {TRACKS.map((t) => (
            <span key={t.id} className={`nle-head nle-head--${t.kind}`}>
              <b>{t.id}</b>
              <span>{t.name}</span>
            </span>
          ))}
        </div>

        <div className="nle-time" ref={timeRef}>
          <div className="nle-ruler" aria-hidden="true">
            {RULER_MARKS.map((s) => (
              <span key={s} className="nle-mark" style={{ '--at': `${(s / DUR) * 100}%` } as CSSProperties}>
                {short(s)}
              </span>
            ))}
          </div>

          <div className="nle-lanes">
            {FILLER_CLIPS.map((f, i) => (
              <div key={`f${i}`} className={`nle-clip nle-clip--filler nle-clip--${KIND(f.track)}`} style={clipStyle(f.track, f.in, f.out)} aria-hidden="true">
                <ClipMedia track={f.track} seed={i + 11} />
                <span className="nle-clip-name">{f.name}</span>
              </div>
            ))}

            <ul className="nle-clips" aria-label="Disciplines on the timeline">
              {DISCIPLINES.map((d, i) => (
                <li key={d.title}>
                  <button
                    type="button"
                    ref={(el) => {
                      clipRefs.current[i] = el
                    }}
                    className={`nle-clip nle-clip--main nle-clip--${KIND(d.track)}${i === active ? ' is-live' : ''}${i === engaged ? ' is-engaged' : ''}`}
                    style={clipStyle(d.track, d.in, d.out)}
                    aria-current={i === active ? 'true' : undefined}
                    aria-label={`${d.title} — ${d.description}`}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && api.current.engage(i, false)}
                    onPointerLeave={(e) => {
                      if (e.pointerType === 'mouse' && document.activeElement !== e.currentTarget) api.current.release(i)
                    }}
                    onFocus={(e) => {
                      if (e.currentTarget.matches(':focus-visible')) api.current.engage(i, false)
                    }}
                    onBlur={() => api.current.release(i)}
                    onClick={(e) => api.current.engage(i, (e.nativeEvent as PointerEvent).pointerType !== 'mouse')}
                    onKeyDown={(e) => onKey(e, i)}
                  >
                    <ClipMedia track={d.track} seed={i} />
                    <span className="nle-clip-track" aria-hidden="true">
                      {d.track}
                    </span>
                    <span className="nle-clip-name">{d.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="nle-playhead" ref={headRef} aria-hidden="true">
            <span className="nle-playhead-cap" />
            <span className="nle-playhead-line" />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Craftsmanship() {
  const rootRef = useRef<HTMLDivElement>(null!)

  useEffect(() => setupReveals(rootRef.current), [])

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

        <EditTimeline />
      </div>
    </div>
  )
}

export default Craftsmanship
