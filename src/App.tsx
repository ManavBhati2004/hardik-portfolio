import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Navigation } from './components/Navigation'
import { Hero } from './components/Hero'
import { Craftsmanship } from './components/Craftsmanship'
import { SelectedWork } from './components/SelectedWork'
import { Gallery } from './components/Gallery'
import { Contact } from './components/Contact'
import { SectionHUD } from './components/SectionHUD'
import { Preloader } from './components/Preloader'
import { useScrollProgress } from './hooks/useScrollProgress'
import { useCursorMotion } from './hooks/useCursorMotion'
import { setupSections } from './motion/sections'
import { VintageDefs } from './components/vintage/Vintage'

// three.js + the scene are the heavy part: split them into their own chunk;
// the preloader (pure HTML + the mist veil) masks the load.
const Scene3D = lazy(() => import('./components/Scene3D'))

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Dev-only: ?overlay=1 lays the reference screenshot over the page at 50% for visual QA. */
function QaOverlay() {
  const [on] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has('overlay'))
  if (!import.meta.env.DEV || !on) return null
  return <div className="qa-overlay" style={{ backgroundImage: 'url(/reference/hero-reference.jpg)' }} />
}

export default function App() {
  const [webgl] = useState(() => (typeof window === 'undefined' ? true : hasWebGL()))

  // intro-controlled elements start hidden (only when JS runs → no-JS stays readable)
  useLayoutEffect(() => {
    document.documentElement.classList.add('js-intro')
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  }, [])

  useScrollProgress()
  const cursorRef = useCursorMotion(0.06)

  useEffect(() => {
    const undo = setupSections()
    // layout settles after fonts; recompute pins / offsets
    document.fonts?.ready.then(() => ScrollTrigger.refresh())
    return undo
  }, [])

  return (
    <>
      {/* Fixed 3D canvas layer — the backdrop of every section */}
      <div className={`canvas-container${webgl ? '' : ' canvas-fallback'}`}>
        {webgl && (
          <Suspense fallback={null}>
            <Scene3D cursorRef={cursorRef} />
          </Suspense>
        )}
      </div>
      <div className="vignette" aria-hidden="true" />

      <Navigation />
      <SectionHUD />

      <main className="content-overlay">
        <section id="hero" aria-label="Introduction">
          <Hero />
        </section>
        <section id="craft" aria-label="Craftsmanship">
          <Craftsmanship />
        </section>
        <section id="work" aria-label="Legacy — selected work">
          <SelectedWork />
        </section>
        <section id="gallery" aria-label="Gallery">
          <Gallery />
        </section>
        <section id="contact" aria-label="Enquire">
          <Contact />
        </section>
      </main>

      <VintageDefs />
      <Preloader webgl={webgl} />
      <QaOverlay />
    </>
  )
}
