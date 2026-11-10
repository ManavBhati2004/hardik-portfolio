import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import './Navigation.css'
import { getLenis } from '../hooks/useScrollProgress'
import { slashTo } from '../motion/slash'
import { onSceneEvent, sceneStore } from '../scene/store'

export const NAV_ITEMS = [
  { label: 'The Blade', id: 'hero' },
  { label: 'Craftsmanship', id: 'craft' },
  { label: 'Legacy', id: 'work' },
  { label: 'Gallery', id: 'gallery' },
] as const

/** Text that duplicates and rolls up one line on hover (CSS owns the transform). */
function RollText({ text }: { text: string }) {
  return (
    <span className="roll" data-text={text}>
      <span className="roll-inner">{text}</span>
    </span>
  )
}

export function Navigation() {
  const navRef = useRef<HTMLElement>(null!)
  const listRef = useRef<HTMLUListElement>(null!)
  const underlineRef = useRef<HTMLSpanElement>(null!)
  const menuRef = useRef<HTMLDivElement>(null!)
  const [active, setActive] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)

  /* active section (changes rarely → React state is fine here) */
  useEffect(() => {
    const off = onSceneEvent('section', () => setActive(sceneStore.section))
    return () => void off()
  }, [])

  /* one shared underline, FLIP-animated between links */
  useLayoutEffect(() => {
    const list = listRef.current
    const line = underlineRef.current
    const btn = list?.querySelectorAll<HTMLElement>('.nav-link')[active]
    if (!list || !line) return
    if (!btn || active > 3) {
      gsap.to(line, { opacity: 0, duration: 0.35, ease: 'power2.out', overwrite: 'auto' })
      return
    }
    const lr = list.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    const first = gsap.getProperty(line, 'opacity') === 0
    gsap.to(line, {
      x: br.left - lr.left,
      width: br.width,
      opacity: 1,
      duration: first ? 0 : 0.7,
      ease: 'power3.inOut',
      overwrite: 'auto',
    })
  }, [active])

  /* compress on scroll; hide on scroll-down after the hero, reveal on scroll-up */
  useEffect(() => {
    const nav = navRef.current
    let hidden = false
    let compact = false
    const show = gsap.quickTo(nav, 'yPercent', { duration: 0.6, ease: 'power3.out' })
    let unsub: (() => void) | undefined
    const attach = () => {
      const lenis = getLenis()
      if (!lenis) return false
      const onScroll = () => {
        const y = lenis.scroll
        const c = y > 40
        if (c !== compact) {
          compact = c
          nav.classList.toggle('nav--compact', c)
        }
        const shouldHide = y > window.innerHeight * 0.9 && lenis.direction === 1 && Math.abs(lenis.velocity) > 0.5
        const shouldShow = lenis.direction === -1 || y < window.innerHeight * 0.9
        if (shouldHide && !hidden) {
          hidden = true
          show(-140)
        } else if (shouldShow && hidden) {
          hidden = false
          show(0)
        }
      }
      lenis.on('scroll', onScroll)
      unsub = () => lenis.off('scroll', onScroll)
      return true
    }
    // Lenis is created in a sibling effect; attach on the next frame if needed
    let raf = 0
    if (!attach()) raf = requestAnimationFrame(() => attach())
    return () => {
      cancelAnimationFrame(raf)
      unsub?.()
    }
  }, [])

  /* mobile menu: full-screen overlay with masked line reveals */
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const items = menu.querySelectorAll('.menu-item-inner')
    const lenis = getLenis()
    if (menuOpen) {
      lenis?.stop()
      gsap.set(menu, { visibility: 'visible' })
      gsap
        .timeline()
        .fromTo(menu, { clipPath: 'inset(0% 0% 100% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.8, ease: 'power3.inOut' })
        .fromTo(items, { yPercent: 110 }, { yPercent: 0, duration: 1, ease: 'expo.out', stagger: 0.07 }, 0.35)
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    } else {
      lenis?.start()
      if (gsap.getProperty(menu, 'visibility') === 'visible') {
        gsap
          .timeline({ onComplete: () => void gsap.set(menu, { visibility: 'hidden' }) })
          .to(items, { yPercent: -110, duration: 0.45, ease: 'power3.in', stagger: 0.04 })
          .to(menu, { clipPath: 'inset(100% 0% 0% 0%)', duration: 0.7, ease: 'power3.inOut' }, 0.2)
      }
    }
  }, [menuOpen])

  const go = useCallback((id: string) => {
    setMenuOpen(false)
    // let the menu start closing before the wipe
    window.setTimeout(() => slashTo(id), menuOpen ? 250 : 0)
  }, [menuOpen])

  return (
    <>
      <nav ref={navRef} className="nav" aria-label="Primary">
        <button className="nav-brand" onClick={() => go('hero')} aria-label="Hardik Gehlot — back to top" data-intro="nav-logo">
          <span lang="ja">侍</span>
        </button>

        <ul className="nav-links" ref={listRef}>
          {NAV_ITEMS.map((item, i) => (
            <li key={item.id} data-intro="nav-link">
              <button
                className={`nav-link${active === i ? ' is-active' : ''}`}
                onClick={() => go(item.id)}
                aria-current={active === i ? 'true' : undefined}
              >
                <RollText text={item.label} />
              </button>
            </li>
          ))}
          <span className="nav-underline" ref={underlineRef} aria-hidden="true" />
        </ul>

        <button className="nav-cta" onClick={() => go('contact')} data-intro="nav-cta">
          <span>Enquire</span>
          <span className="arrow-cycle arrow-cycle--diag" aria-hidden="true">
            <span>↗</span>
            <span>↗</span>
          </span>
        </button>

        <button
          className={`nav-menu-btn${menuOpen ? ' is-open' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          data-intro="nav-cta"
        >
          <span />
          <span />
        </button>
      </nav>

      <div id="mobile-menu" className="menu" ref={menuRef} aria-hidden={!menuOpen}>
        <ul>
          {[...NAV_ITEMS, { label: 'Enquire', id: 'contact' }].map((item, i) => (
            <li key={item.id} className="menu-item">
              <button onClick={() => go(item.id)} tabIndex={menuOpen ? 0 : -1}>
                <span className="menu-item-inner">
                  <span className="menu-num">{String(i + 1).padStart(2, '0')}</span>
                  {item.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <span className="menu-kanji" lang="ja" aria-hidden="true">暁の刃</span>
      </div>
    </>
  )
}

export default Navigation
