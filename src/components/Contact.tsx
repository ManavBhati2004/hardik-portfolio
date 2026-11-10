import { useEffect, useRef } from 'react'
import './Contact.css'
import { setupReveals } from '../motion/sections'
import { slashTo } from '../motion/slash'

// TODO: replace with Hardik's real email and profile links
const LINKS = [
  { label: 'Email', value: 'hello@example.com', href: 'mailto:hello@example.com' },
  { label: 'Instagram', value: '@handle', href: '#' },
  { label: 'YouTube', value: 'Channel', href: '#' },
  { label: 'LinkedIn', value: 'Profile', href: '#' },
]

/* Finale. The katana rises out of the water again between the heading (left) and
   the links (right); the live scene is the backdrop. */
export function Contact() {
  const rootRef = useRef<HTMLDivElement>(null!)
  useEffect(() => setupReveals(rootRef.current), [])

  return (
    <div className="contact" ref={rootRef}>
      <div className="contact-grid">
        <div className="contact-left">
          <span className="eyebrow" data-reveal="rise">
            <span className="eyebrow-num">05</span> — Enquire
            <span className="eyebrow-kanji" lang="ja" data-reveal="ink" data-ink="tl">縁</span>
          </span>
          <h2 className="contact-heading" data-reveal="lines">
            Let’s create
            <br />
            <em>something.</em>
          </h2>
          <p className="contact-description" data-reveal="lines">
            Have a project, idea or collaboration in mind? Send a few lines about it.
          </p>
        </div>

        <ul className="contact-links">
          {LINKS.map((l, i) => (
            <li key={l.label} data-reveal="rise" data-delay={0.08 * i}>
              <a className="contact-link" href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
                <span className="contact-link-label">{l.label}</span>
                <span className="contact-link-value">
                  <span className="contact-link-text">{l.value}</span>
                  <span className="arrow-cycle arrow-cycle--diag" aria-hidden="true">
                    <span>↗</span>
                    <span>↗</span>
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <footer className="contact-footer">
        <span>&copy; {new Date().getFullYear()} Hardik Gehlot</span>
        <span lang="ja" className="contact-footer-kanji">暁の刃</span>
        <button className="contact-top" onClick={() => slashTo('hero')}>
          Back to top ↑
        </button>
      </footer>
    </div>
  )
}

export default Contact
