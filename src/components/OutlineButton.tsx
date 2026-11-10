/* Thin outlined rectangle button (reference "Explore the Blade" style):
   SVG border (drawable by the intro), crimson wash on hover, cycling arrow. */
export function OutlineButton({
  label,
  onClick,
  href,
  className = '',
}: {
  label: string
  onClick?: () => void
  href?: string
  className?: string
}) {
  const inner = (
    <>
      <svg className="btn-line-border" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0.5" y="0.5" pathLength={1} />
      </svg>
      <span className="btn-line-wash" aria-hidden="true" />
      <span className="btn-line-label">{label}</span>
      <span className="arrow-cycle" aria-hidden="true">
        <span>→</span>
        <span>→</span>
      </span>
    </>
  )
  if (href) {
    return (
      <a className={`btn-line ${className}`} href={href}>
        {inner}
      </a>
    )
  }
  return (
    <button type="button" className={`btn-line ${className}`} onClick={onClick}>
      {inner}
    </button>
  )
}

export default OutlineButton
