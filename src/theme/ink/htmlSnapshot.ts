/*
 * Viewport snapshot of the HTML layer, for the ink-bleed "from" frame.
 * Approach from "Ink Bleed" by Codemure (https://www.codemure.com), MIT License:
 * html2canvas is lazy-loaded and snapshots are pre-captured in idle time so a click
 * can start the ink instantly. Adapted to capture only the visible viewport (the
 * page under it is a live WebGL scene, captured separately in the same frame).
 */
import { getLenis } from '../../hooks/useScrollProgress'
import { getTheme } from '../theme'

interface Snap {
  key: string
  canvas: HTMLCanvasElement
}

let cache: Snap | null = null
let capturing: Promise<Snap | null> | null = null
let lastScrollAt = 0
let paused = false
let started = false

const scale = () => Math.min(window.devicePixelRatio || 1, window.matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5)

/** What a snapshot depends on: theme, scroll position, viewport size. */
export function snapshotKey(): string {
  return `${getTheme()}|${Math.round(window.scrollY)}|${window.innerWidth}x${window.innerHeight}`
}

/** Elements that are not part of the HTML layer (or must stay live above the ink). */
function ignore(el: Element): boolean {
  return (
    el.classList.contains('canvas-container') ||
    el.classList.contains('ink-canvas') ||
    el.classList.contains('preloader') ||
    el.classList.contains('slash') ||
    el.classList.contains('qa-overlay')
  )
}

async function capture(): Promise<Snap | null> {
  const key = snapshotKey()
  try {
    const { default: html2canvas } = await import('html2canvas')
    const canvas = await html2canvas(document.body, {
      backgroundColor: null,
      scale: scale(),
      x: window.scrollX,
      y: window.scrollY,
      width: window.innerWidth,
      height: window.innerHeight,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: window.innerHeight,
      logging: false,
      useCORS: true,
      ignoreElements: ignore,
      onclone: (doc) => {
        // only the HTML layer: the page background must not hide the 3D frame it is drawn over
        doc.documentElement.style.background = 'transparent'
        doc.body.style.background = 'transparent'
        // html2canvas mis-draws a few hover-only constructs; render them in their resting state
        const fix = doc.createElement('style')
        fix.textContent = '.roll::after{display:none!important}.roll-inner{transform:none!important}'
        doc.head.appendChild(fix)
        // the toggle stays live above the ink (its icon morphs with the spread)
        doc.querySelectorAll<HTMLElement>('[data-ink-live]').forEach((el) => {
          el.style.visibility = 'hidden'
        })
      },
    })
    // the page may have moved while capturing: only keep a snapshot that still matches
    if (key !== snapshotKey()) return null
    cache = { key, canvas }
    return cache
  } catch (err) {
    if (import.meta.env.DEV) console.warn('[ink] html snapshot failed', err)
    return null
  }
}

/** The snapshot for the current state: cached if fresh, otherwise captured now. */
export async function getHtmlSnapshot(): Promise<HTMLCanvasElement | null> {
  if (cache && cache.key === snapshotKey()) return cache.canvas
  if (capturing) await capturing
  if (cache && cache.key === snapshotKey()) return cache.canvas
  capturing = capture()
  const s = await capturing
  capturing = null
  return s?.canvas ?? null
}

/** Pause idle captures while a transition is running (capturing blocks the main thread). */
export function setSnapshotPaused(p: boolean) {
  paused = p
}

/** Keep a fresh snapshot ready: refresh in idle time once scrolling has settled. */
export function startSnapshotKeeper() {
  if (started) return
  started = true
  const markScroll = () => (lastScrollAt = performance.now())
  window.addEventListener('scroll', markScroll, { passive: true })
  window.addEventListener('resize', markScroll)
  const attachLenis = () => getLenis()?.on('scroll', markScroll)
  attachLenis() ?? window.setTimeout(attachLenis, 1000)

  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  const idle = (cb: () => void) => (ric ? ric.call(window, cb, { timeout: 800 }) : window.setTimeout(cb, 1))

  window.setInterval(() => {
    if (paused || capturing) return
    if (!document.documentElement.classList.contains('intro-done')) return
    if (performance.now() - lastScrollAt < 500) return
    if (cache && cache.key === snapshotKey()) return
    idle(() => {
      if (paused || capturing || (cache && cache.key === snapshotKey())) return
      capturing = capture()
      void capturing.finally(() => (capturing = null))
    })
  }, 700)
}
