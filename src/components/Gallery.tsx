import { useCallback, useEffect, useRef, useState } from 'react'
import { FRAMES } from '../data/gallery'
import { setupReveals } from '../motion/sections'
import { onSceneEvent, sceneStore } from '../scene/store'
import type { GalleryEngine } from './galleryEngine'
import { GalleryLightbox } from './GalleryLightbox'
import './Gallery.css'

/* 04 — Gallery: an infinite, wrapping canvas of frames drawn in a small WebGL canvas.
   Drag in any direction (mouse / touch / trackpad) with inertia; page scroll pans it while
   on screen. Frames bow and split RGB with speed; hover focuses one and dims the rest;
   click (or Enter) zooms a frame full-screen. Without WebGL it falls back to a swipe row. */

const ratio = (a: string) => {
  const [w, h] = a.split('/').map((n) => parseFloat(n))
  return w / h
}
const ASPECTS = FRAMES.map((f) => ratio(f.aspect))

/** rasterise a still (url) into a canvas for the GPU */
function loadStill(url: string, aspect: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const w = 1024
      const h = Math.round(w / aspect)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return reject(new Error('2d'))
      // object-fit: cover
      const ir = img.naturalWidth / Math.max(1, img.naturalHeight)
      let sw = img.naturalWidth
      let sh = img.naturalHeight
      if (ir > aspect) sw = sh * aspect
      else sh = sw / aspect
      ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h)
      resolve(c)
    }
    img.onerror = reject
    img.src = url
  })
}

const bgRgb = (): [number, number, number] => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bg-rgb')
  const p = v.split(',').map((n) => parseFloat(n))
  return p.length === 3 && p.every((n) => Number.isFinite(n)) ? [p[0], p[1], p[2]] : [3, 3, 4]
}

interface OpenState {
  cell: number
  frame: number
  rect: DOMRect
}

export function Gallery() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const stageRef = useRef<HTMLDivElement>(null!)
  const canvasRef = useRef<HTMLCanvasElement>(null!)
  const sourcesRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null!)
  const ringRef = useRef<HTMLDivElement>(null!)
  const cursorRef = useRef<HTMLDivElement>(null!)
  const engineRef = useRef<GalleryEngine | null>(null)
  const keyboardRef = useRef(false)

  const [mode, setMode] = useState<'gl' | 'fallback'>('gl')
  const [stills, setStills] = useState<string[] | null>(null)
  const [activeFrame, setActiveFrame] = useState<number | null>(null)
  const [open, setOpen] = useState<OpenState | null>(null)
  const [fallbackOrigin, setFallbackOrigin] = useState<HTMLElement | null>(null)

  /* heading reveals (unchanged choreography) */
  useEffect(() => setupReveals(rootRef.current), [])

  /* stills: placeholder SVG art → blob urls (vector, crisp in the lightbox) */
  useEffect(() => {
    const holder = sourcesRef.current
    const urls = FRAMES.map((f, i) => {
      if (f.src) return f.src
      const svg = holder?.querySelector<SVGSVGElement>(`[data-frame="${i}"] svg`)
      if (!svg) return ''
      const clone = svg.cloneNode(true) as SVGSVGElement
      const vb = clone.viewBox.baseVal
      clone.setAttribute('width', String(vb?.width || 1024))
      clone.setAttribute('height', String(vb?.height || 1024 / ASPECTS[i]))
      const xml = new XMLSerializer().serializeToString(clone)
      return URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }))
    })
    setStills(urls)
    return () => urls.forEach((u) => u.startsWith('blob:') && URL.revokeObjectURL(u))
  }, [])

  /* engine: created lazily as the section approaches (three is a separate chunk) */
  useEffect(() => {
    if (!stills || mode !== 'gl') return
    const stage = stageRef.current
    let cancelled = false
    let engine: GalleryEngine | null = null
    const offs: (() => void)[] = []

    const start = async () => {
      try {
        const { createGalleryEngine } = await import('./galleryEngine')
        if (cancelled) return
        engine = createGalleryEngine(
          stage,
          canvasRef.current,
          ASPECTS.map((aspect) => ({ aspect, image: null })),
          {
            onActive: (_cell, frame) => setActiveFrame(frame),
            onOpen: (cell, frame, rect) => {
              engine?.setInputEnabled(false)
              engine?.setHidden(cell)
              setOpen({ cell, frame, rect })
            },
            onTick: (box) => {
              const label = labelRef.current
              const ring = ringRef.current
              if (!box) {
                label.style.opacity = '0'
                ring.style.opacity = '0'
                return
              }
              label.style.opacity = '1'
              label.style.transform = `translate3d(${box.x}px, ${box.y + box.h + 12}px, 0)`
              ring.style.opacity = keyboardRef.current ? '1' : '0'
              ring.style.transform = `translate3d(${box.x - 6}px, ${box.y - 6}px, 0)`
              ring.style.width = `${box.w + 12}px`
              ring.style.height = `${box.h + 12}px`
            },
          },
          { reduced: sceneStore.reducedMotion }
        )
      } catch {
        if (!cancelled) setMode('fallback')
        return
      }
      engineRef.current = engine
      engine.setTheme(bgRgb(), document.documentElement.dataset.theme === 'light')
      offs.push(onSceneEvent('theme', () => engine?.setTheme(bgRgb(), document.documentElement.dataset.theme === 'light')))

      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const onMq = (e: MediaQueryListEvent) => engine?.setReduced(e.matches)
      mq.addEventListener?.('change', onMq)
      offs.push(() => mq.removeEventListener?.('change', onMq))

      // draw only while on screen
      const vis = new IntersectionObserver(([e]) => engine?.setVisible(e.isIntersecting), { threshold: 0 })
      vis.observe(stage)
      offs.push(() => vis.disconnect())

      FRAMES.forEach((_f, i) => {
        if (!stills[i]) return
        loadStill(stills[i], ASPECTS[i])
          .then((c) => !cancelled && engine?.setImage(i, c))
          .catch(() => {})
      })
    }

    // load when the section is within ~1.5 viewports
    const near = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return
        near.disconnect()
        void start()
      },
      { rootMargin: '150% 0px' }
    )
    near.observe(stage)

    return () => {
      cancelled = true
      near.disconnect()
      offs.forEach((f) => f())
      engine?.destroy()
      engineRef.current = null
    }
  }, [stills, mode])

  /* keyboard: arrows move focus between frames, Enter / Space opens */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const engine = engineRef.current
    if (!engine || open) return
    const moves: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    const m = moves[e.key]
    if (m) {
      e.preventDefault()
      keyboardRef.current = true
      engine.moveFocus(m[0], m[1])
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      keyboardRef.current = true
      engine.openFocused()
    }
  }
  const onFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    // only keyboard focus picks a frame (a click focuses the stage too)
    if (!e.currentTarget.matches(':focus-visible')) return
    keyboardRef.current = true
    engineRef.current?.focusNearest()
  }
  const onBlur = () => {
    if (open) return
    keyboardRef.current = false
    engineRef.current?.clearFocus()
  }

  /* text cursor pill that follows the pointer (fine pointers only, via CSS) */
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    if (keyboardRef.current) {
      keyboardRef.current = false
      engineRef.current?.clearFocus()
    }
    const r = e.currentTarget.getBoundingClientRect()
    cursorRef.current.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0)`
  }

  const getReturnRect = useCallback(() => {
    if (open && engineRef.current) return engineRef.current.cellRect(open.cell)
    if (fallbackOrigin) return fallbackOrigin.getBoundingClientRect()
    return open?.rect ?? new DOMRect()
  }, [open, fallbackOrigin])

  const onClosed = useCallback(() => {
    const engine = engineRef.current
    engine?.setHidden(null)
    engine?.setInputEnabled(true)
    setOpen(null)
    if (fallbackOrigin) {
      fallbackOrigin.focus({ preventScroll: true })
      setFallbackOrigin(null)
    } else if (keyboardRef.current) stageRef.current.focus({ preventScroll: true })
  }, [fallbackOrigin])

  const current = activeFrame === null ? null : FRAMES[activeFrame]

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

      {mode === 'gl' ? (
        <div
          className="gal-stage"
          ref={stageRef}
          tabIndex={0}
          role="group"
          aria-roledescription="draggable gallery"
          aria-label="Frames from the edit. Drag to explore; arrow keys move between frames, Enter opens one."
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          onPointerMove={onPointerMove}
        >
          <canvas className="gal-canvas" ref={canvasRef} aria-hidden="true" />
          <div className="gal-ring" ref={ringRef} aria-hidden="true" />
          <div className="gal-label" ref={labelRef} aria-hidden="true">
            {current && (
              <>
                <span className="gal-label-num">{current.id}</span>
                <span>{current.caption}</span>
              </>
            )}
          </div>
          <div className="gal-cursor" ref={cursorRef} aria-hidden="true">
            <span className="gal-cursor-drag">Drag</span>
            <span className="gal-cursor-view">View</span>
          </div>
          <p className="sr-only" aria-live="polite">
            {current ? `${current.caption}. Press Enter to open.` : ''}
          </p>
        </div>
      ) : (
        <ul className="gal-strip" aria-label="Frames from the edit">
          {FRAMES.map((f, i) => (
            <li key={f.id} style={{ ['--ar' as string]: f.aspect }}>
              <button
                type="button"
                className="gal-strip-btn"
                aria-label={`Open ${f.caption}`}
                onClick={(e) => {
                  setFallbackOrigin(e.currentTarget)
                  setOpen({ cell: -1, frame: i, rect: e.currentTarget.getBoundingClientRect() })
                }}
              >
                {stills?.[i] ? <img src={stills[i]} alt="" decoding="async" loading="lazy" /> : f.art()}
              </button>
              <span className="gal-strip-cap">
                <span className="gal-label-num">{f.id}</span> {f.caption}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="gallery-hint" aria-hidden="true">
        <span className="gallery-hint-line" />
        <span>Drag to explore</span>
        <span className="gallery-hint-dot">·</span>
        <span>Click to open</span>
        <span className="gallery-hint-count">{String(FRAMES.length).padStart(2, '0')} frames</span>
      </div>

      {/* placeholder art, serialised once into stills then unmounted */}
      {!stills && (
        <div ref={sourcesRef} className="gal-sources" aria-hidden="true">
          {FRAMES.map((f, i) => (
            <div key={f.id} data-frame={i}>
              {f.art()}
            </div>
          ))}
        </div>
      )}

      {open && (
        <GalleryLightbox
          frame={FRAMES[open.frame]}
          index={open.frame}
          total={FRAMES.length}
          still={stills?.[open.frame] ?? ''}
          from={open.rect}
          getReturnRect={getReturnRect}
          onClosed={onClosed}
        />
      )}
    </div>
  )
}

export default Gallery
