import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECTS, type Project } from '../data/projects'
import { setupReveals } from '../motion/sections'
import { ProjectOverlay } from './ProjectOverlay'
import { WarpCarousel } from './WarpCarousel'
import './SelectedWork.css'

export function SelectedWork() {
  const rootRef = useRef<HTMLDivElement>(null!)
  const [open, setOpen] = useState<{ project: Project; thumb: HTMLElement } | null>(null)

  useEffect(() => setupReveals(rootRef.current), [])

  const onOpen = useCallback((project: Project, thumb: HTMLElement) => setOpen({ project, thumb }), [])
  const onClosed = useCallback(() => setOpen(null), [])

  return (
    <div className="section work" ref={rootRef}>
      <div className="section-inner">
        <header className="work-header">
          <div>
            <span className="eyebrow" data-reveal="rise">
              <span className="eyebrow-num">03</span> — Legacy
              <span className="eyebrow-kanji" lang="ja" data-reveal="ink" data-ink="tl">遺</span>
            </span>
            <h2 className="section-heading" data-reveal="lines">
              Selected <em>work</em>
            </h2>
          </div>
          <p className="work-intro" data-reveal="lines">
            A space for finished pieces. Each card below is a placeholder until the real films are added.
          </p>
        </header>

        <div className="work-stage" data-reveal="rise" data-delay="0.15">
          <WarpCarousel className="work-carousel" projects={PROJECTS} onOpen={onOpen} paused={!!open} ariaLabel="Selected work" />
        </div>
      </div>

      {open && <ProjectOverlay project={open.project} origin={open.thumb} onClosed={onClosed} />}
    </div>
  )
}

export default SelectedWork
