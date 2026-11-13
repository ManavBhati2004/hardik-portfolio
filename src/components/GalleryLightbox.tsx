import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { gsap } from 'gsap'
import type { Frame } from '../data/gallery'
import { getLenis } from '../hooks/useScrollProgress'
import { sceneStore } from '../scene/store'

/* Full-screen still. The frame FLIPs from its plane's rect on the canvas into a centred,
   contain-fit frame; the caption rises in. Esc / close / backdrop click reverse it back
   into the plane's current rect. */
export function GalleryLightbox({
  frame,
  index,
  total,
  still,
  from,
  getReturnRect,
  onClosed,
}: {
  frame: Frame
  index: number
  total: number
  still: string
  from: DOMRect
  getReturnRect: () => DOMRect
  onClosed: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null!)
  const frameRef = useRef<HTMLDivElement>(null!)
  const closeRef = useRef<HTMLButtonElement>(null!)
  // latest callbacks without re-running the open animation
  const cbRef = useRef({ getReturnRect, onClosed })
  useEffect(() => {
    cbRef.current = { getReturnRect, onClosed }
  }, [getReturnRect, onClosed])

  useEffect(() => {
    const root = rootRef.current
    const media = frameRef.current
    const backdrop = root.querySelector('.glb-backdrop')
    const items = root.querySelectorAll('.glb-reveal')
    const lenis = getLenis()
    lenis?.stop()
    const reduced = sceneStore.reducedMotion
    let closing = false

    const flipTo = (a: DOMRect) => {
      const b = media.getBoundingClientRect()
      return { x: a.left - b.left, y: a.top - b.top, scaleX: a.width / b.width, scaleY: a.height / b.height }
    }

    const tl = gsap.timeline({ defaults: { ease: 'expo.inOut' } })
    if (reduced) {
      tl.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' })
    } else {
      tl.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.7, ease: 'power2.out' }, 0)
        .fromTo(media, { ...flipTo(from), transformOrigin: '0 0' }, { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.95 }, 0)
        .fromTo(items, { yPercent: 115 }, { yPercent: 0, duration: 0.9, ease: 'expo.out', stagger: 0.06 }, 0.5)
        .fromTo(closeRef.current, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.55)
    }
    closeRef.current.focus({ preventScroll: true })

    const close = () => {
      if (closing) return
      closing = true
      tl.kill()
      const done = () => {
        lenis?.start()
        cbRef.current.onClosed()
      }
      if (reduced) {
        gsap.to(root, { opacity: 0, duration: 0.25, ease: 'none', onComplete: done })
        return
      }
      const back = cbRef.current.getReturnRect()
      gsap
        .timeline({ defaults: { ease: 'expo.inOut' }, onComplete: done })
        .to(items, { yPercent: -115, duration: 0.4, ease: 'power3.in', stagger: 0.03 }, 0)
        .to(closeRef.current, { opacity: 0, duration: 0.25 }, 0)
        .to(media, { ...flipTo(back), transformOrigin: '0 0', duration: 0.8 }, 0.1)
        .to(backdrop, { opacity: 0, duration: 0.55, ease: 'power2.in' }, 0.35)
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        // single control: keep focus inside the dialog
        e.preventDefault()
        closeRef.current.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    closeRef.current.onclick = close
    const onBackdrop = (e: MouseEvent) => {
      if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('glb-backdrop')) close()
    }
    root.addEventListener('click', onBackdrop)
    return () => {
      window.removeEventListener('keydown', onKey)
      root.removeEventListener('click', onBackdrop)
      tl.kill()
      if (!closing) lenis?.start()
    }
  }, [from])

  return createPortal(
    <div className="glb" ref={rootRef} role="dialog" aria-modal="true" aria-label={frame.caption} data-lenis-prevent>
      <div className="glb-backdrop" />
      <button type="button" className="glb-close" ref={closeRef} aria-label="Close frame">
        <span>Close</span>
        <span className="glb-close-x" aria-hidden="true" />
      </button>
      <figure className="glb-figure" style={{ ['--ar' as string]: frame.aspect }}>
        <div className="glb-media" ref={frameRef}>
          {still ? <img src={still} alt={frame.caption} decoding="async" /> : frame.art()}
        </div>
        <figcaption className="glb-cap">
          <span className="glb-line">
            <span className="glb-reveal glb-num">
              {frame.id} <span className="glb-of">/ {String(total).padStart(2, '0')}</span>
            </span>
          </span>
          <span className="glb-line">
            <span className="glb-reveal glb-title">{frame.caption}</span>
          </span>
          <span className="glb-line glb-line-end">
            <span className="glb-reveal glb-esc">Esc to close</span>
          </span>
        </figcaption>
      </figure>
      <span className="sr-only">{`Frame ${index + 1} of ${total}`}</span>
    </div>,
    document.body
  )
}

export default GalleryLightbox
