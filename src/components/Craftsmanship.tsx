import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CRAFT_INTRO, DISCIPLINES, FILLER_CLIPS, SEQUENCE, TOOLS, TRACKS, type TrackId } from '../data/craft'
import { setupReveals } from '../motion/sections'
import { sceneStore } from '../scene/store'
import { drawLoop, levels, Vectorscope } from './craftMonitor'
import './Craftsmanship.css'

gsap.registerPlugin(ScrollTrigger)

/* 02 — Craftsmanship. Left: label + ink-revealed 技, heading, intro, tools.
   Right: a live edit timeline (NLE). Scroll scrubs the playhead; when the scroll rests
   the sequence plays in real time through the live clip and loops it. The clip under the
   playhead drives the program monitor, vectorscope and audio meter. Hover / focus / tap on
   a clip jumps the playhead there. Per-frame work is transform / text / canvas only. */

const DUR = SEQUENCE.duration
const FPS = SEQUENCE.fps
const FRAME = 1 / FPS
const ROW = (id: TrackId) => TRACKS.findIndex((t) => t.id === id)
const KIND = (id: TrackId) => TRACKS[ROW(id)].kind

const pad = (n: number) => String(n).padStart(2, '0')
function timecode(sec: number) {
  const f = Math.max(0, Math.floor(sec * FPS + 1e-6))
  return `${pad(Math.floor(f / (FPS * 3600)))}:${pad(Math.floor(f / (FPS * 60)) % 60)}:${pad(Math.floor(f / FPS) % 60)}:${pad(f % FPS)}`
}
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
  const tcRef = useRef<HTMLSpanElement>(null!)
  const stateRef = useRef<HTMLSpanElement>(null!)
  const monitorRef = useRef<HTMLCanvasElement>(null!)
  const scopeRef = useRef<HTMLCanvasElement>(null!)
  const meterRefs = useRef<(HTMLSpanElement | null)[]>([])
  const peakRefs = useRef<(HTMLSpanElement | null)[]>([])
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
    const scope = scopeRef.current
    const sctx = scope.getContext('2d', { alpha: false })!
    const vscope = new Vectorscope()

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
    let scopeAcc = 1
    let freshScope = true
    let lastTc = ''
    let playing = false
    let lastPlaying: boolean | null = null
    const meter = [0, 0]
    const peak = [0, 0]
    const peakAge = [0, 0]

    // backing stores follow the element size (not per frame)
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const mw = Math.min(760, Math.round(monitor.clientWidth * dpr))
      monitor.width = Math.max(160, mw)
      monitor.height = Math.round((monitor.width * 9) / 16)
      const s = Math.max(64, Math.round(scope.clientWidth * dpr))
      scope.width = s
      scope.height = s
      monitorAcc = 1
      freshScope = true
      paintStill()
    }
    const paintStill = () => {
      const d = DISCIPLINES[lastActive]
      drawLoop(mctx, d.loop, monitor.width, monitor.height, reduced ? 1.4 : Math.max(0, shown - d.in))
      vscope.draw(monitor, sctx, scope.width, true)
    }
    const ro = new ResizeObserver(size)
    ro.observe(monitor)
    ro.observe(scope)

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

    const place = () => {
      const p = Math.min(1, Math.max(0, shown / DUR)) * 100
      headRef.current.style.transform = vertical.matches ? `translate3d(0, ${p}%, 0)` : `translate3d(${p}%, 0, 0)`
      const code = timecode(shown)
      if (code !== lastTc) {
        lastTc = code
        tcRef.current.textContent = code
      }
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
        const prevPlay = play
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
        playing = play !== prevPlay
        shown += (play - shown) * (1 - Math.exp(-dt * 14))
        if (Math.abs(play - shown) < 1e-4) shown = play
      }

      if (shown !== prevShown) {
        prevShown = shown
        place()
      }

      if (playing !== lastPlaying) {
        lastPlaying = playing
        stateRef.current.dataset.state = playing ? 'play' : 'pause'
      }

      if (reduced) return

      // program monitor at ~30 fps, its loop clock tied to the sequence clock
      monitorAcc += dt
      if (monitorAcc >= 1 / 30) {
        monitorAcc = 0
        const d = DISCIPLINES[lastActive]
        drawLoop(mctx, d.loop, monitor.width, monitor.height, Math.max(0, shown - d.in))
        scopeAcc += 1
        if (scopeAcc >= 3) {
          scopeAcc = 0
          vscope.draw(monitor, sctx, scope.width, freshScope)
          freshScope = false
        }
      }

      // meters: fast attack, slow release, peak hold
      const lv = playing ? levels(DISCIPLINES[lastActive].loop, shown) : [0, 0]
      for (let c = 0; c < 2; c++) {
        const target = lv[c]
        meter[c] += (target - meter[c]) * (target > meter[c] ? 0.55 : 1 - Math.exp(-dt * 5))
        if (meter[c] >= peak[c]) {
          peak[c] = meter[c]
          peakAge[c] = 0
        } else if ((peakAge[c] += dt) > 0.9) peak[c] = Math.max(0, peak[c] - dt * 0.6)
        const m = meterRefs.current[c]
        const p = peakRefs.current[c]
        if (m) m.style.transform = `scale3d(1, ${(1 - meter[c]).toFixed(4)}, 1)`
        if (p) p.style.transform = `translate3d(0, ${((1 - peak[c]) * 100).toFixed(2)}%, 0)`
      }
    }
    gsap.ticker.add(tick)
    const onOrient = () => place()
    vertical.addEventListener('change', onOrient)
    size()
    place()

    // entrance: the panel settles, then clips are laid onto their tracks
    const ctx = gsap.context(() => {
      if (reduced) return
      const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: 'top 82%', once: true } })
      tl.fromTo(root, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out' })
      tl.fromTo(
        root.querySelectorAll('.nle-clip'),
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.7, ease: 'expo.out', stagger: { each: 0.025, from: 'start' }, clearProps: 'transform,opacity' },
        0.25
      )
    }, root)

    return () => {
      gsap.ticker.remove(tick)
      vertical.removeEventListener('change', onOrient)
      ro.disconnect()
      vis.kill()
      st.kill()
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
  const curTrack = TRACKS[ROW(cur.track)]

  return (
    <div className="nle" ref={rootRef} data-engaged={engaged !== null || undefined}>
      {/* header */}
      <div className="nle-bar">
        <span className="nle-seq">
          <span className="nle-rec" aria-hidden="true" />
          Seq 02 <span className="nle-dim">/</span> {SEQUENCE.name}
        </span>
        <span className="nle-tc-wrap">
          <span className="nle-state" ref={stateRef} data-state="pause" aria-hidden="true" />
          <span className="nle-tc" ref={tcRef} aria-hidden="true">
            00:00:00:00
          </span>
        </span>
        <span className="nle-meta">
          {FPS} fps <span className="nle-dim">·</span> UHD
        </span>
      </div>

      {/* monitor + scopes */}
      <div className="nle-view">
        <div className="nle-monitor">
          <canvas ref={monitorRef} className="nle-monitor-canvas" aria-hidden="true" />
          <span className="nle-safe" aria-hidden="true" />
          <span className="nle-tag nle-tag--tl">PGM</span>
          <span className="nle-tag nle-tag--tr">{curTrack.id}</span>
          <span className="nle-monitor-title" key={shownIdx}>
            <span>{cur.title}</span>
          </span>
          <span className="nle-placeholder">Placeholder loop · footage soon</span>
        </div>
        <div className="nle-scopes" aria-hidden="true">
          <div className="nle-scope">
            <canvas ref={scopeRef} className="nle-scope-canvas" />
            <span className="nle-scope-label">Vectorscope</span>
          </div>
          <div className="nle-meter">
            <div className="nle-meter-scale">
              {['0', '-6', '-12', '-24', '-48'].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            {[0, 1].map((c) => (
              <div className="nle-meter-ch" key={c}>
                <span className="nle-meter-fill" />
                <span
                  className="nle-meter-mask"
                  ref={(el) => {
                    meterRefs.current[c] = el
                  }}
                />
                <span
                  className="nle-meter-peak"
                  ref={(el) => {
                    peakRefs.current[c] = el
                  }}
                >
                  <i />
                </span>
                <span className="nle-meter-lbl">{c ? 'R' : 'L'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* inspector — the live / engaged clip's line */}
      <div className="nle-inspector" aria-live="polite">
        <span className={`nle-chip nle-chip--${curTrack.kind}`}>{curTrack.id}</span>
        <div className="nle-insp-text" key={shownIdx}>
          <span className="nle-insp-title">
            <span>{cur.title}</span>
          </span>
          <span className="nle-insp-desc">
            <span>{cur.description}</span>
          </span>
        </div>
        <span className="nle-io" aria-hidden="true">
          <span>
            <b>IN</b> {timecode(cur.in)}
          </span>
          <span>
            <b>OUT</b> {timecode(cur.out)}
          </span>
        </span>
      </div>

      {/* timeline */}
      <div className="nle-tl">
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
