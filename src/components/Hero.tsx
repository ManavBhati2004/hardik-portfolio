import './Hero.css'
import { slashTo } from '../motion/slash'
import { OutlineButton } from './OutlineButton'

/* ─────────────────────────────────────────────────────────────────────────────
   Hero overlay — every position is measured from the 1600×900 reference and
   expressed in viewport units (see Hero.css). The 3D scene behind it supplies
   the moon, ring, katana, water, rocks, torii, branch, fog and leaves.
   All entrances are owned by the intro timeline (motion/introTimeline.ts);
   elements are addressed by their data-intro names.
   ───────────────────────────────────────────────────────────────────────────── */
export function Hero() {
  return (
    <div className="hero">
      {/* giant faded 侍 behind the title */}
      <div className="hero-kanji-giant" aria-hidden="true">
        <span lang="ja" data-intro="kanji-giant">侍</span>
      </div>

      <div className="hero-copy">
        <h1 className="hero-title" data-intro="title">
          <span className="hero-title-word">HARDIK</span> <span className="hero-title-word">GEHLOT</span>
        </h1>
        <p className="hero-subtitle" data-intro="subtitle">
          Creative Video Editor &amp; Motion Designer
        </p>
        <span className="hero-rule" data-intro="rule" aria-hidden="true" />
        <p className="hero-desc" data-intro="desc">
          Stories shaped through editing, motion and cinematic craft.
        </p>
        <div className="hero-cta" data-intro="cta">
          <OutlineButton label="Explore My Work" onClick={() => slashTo('work')} />
        </div>
      </div>

      {/* vertical 暁の刃 with its line */}
      <div className="hero-vkanji" aria-hidden="true">
        <span className="hero-vkanji-text" lang="ja" data-intro="vkanji">
          <span>暁</span>
          <span>の</span>
          <span>刃</span>
        </span>
        <span className="hero-vkanji-line" data-intro="vline" />
      </div>
    </div>
  )
}

export default Hero
