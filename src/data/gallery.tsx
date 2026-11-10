import type { ReactNode } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Gallery — "frames from the edit". ALL FRAMES ARE PLACEHOLDERS.
   To add a real still: set `src` to an image in /public/gallery/ and update the caption.
   Aspect ratios: '16 / 9', '4 / 5' or '2.39 / 1' (cinemascope).
   ───────────────────────────────────────────────────────────────────────────── */

export interface Frame {
  id: string
  aspect: '16 / 9' | '4 / 5' | '2.39 / 1'
  caption: string
  src?: string // TODO: replace with a real still, e.g. '/gallery/frame-01.jpg'
  art: () => ReactNode
}

/* moody generated placeholder artwork in the site palette */
function art(kind: 'moon' | 'horizon' | 'figure' | 'gate' | 'rain' | 'blade' | 'window', w: number, h: number, seed: number): ReactNode {
  const id = `g${seed}`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}a`} cx={kind === 'window' ? '70%' : '55%'} cy="35%" r="60%">
          <stop offset="0%" stopColor="#7a1414" stopOpacity="0.85" />
          <stop offset="45%" stopColor="#2a0a0c" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#050506" stopOpacity="1" />
        </radialGradient>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0a0a0c" />
          <stop offset="100%" stopColor="#16141a" />
        </linearGradient>
        <filter id={`${id}n`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.07 0" />
        </filter>
      </defs>
      <rect width={w} height={h} fill={`url(#${id}a)`} />
      {kind === 'moon' && <circle cx={w * 0.58} cy={h * 0.38} r={h * 0.2} fill="#8e1717" opacity="0.85" />}
      {kind === 'horizon' && (
        <>
          <rect y={h * 0.62} width={w} height={h * 0.38} fill={`url(#${id}b)`} />
          <rect x={w * 0.47} y={h * 0.64} width={w * 0.02} height={h * 0.3} fill="#b3201f" opacity="0.35" />
        </>
      )}
      {kind === 'figure' && (
        <path d={`M${w * 0.5} ${h * 0.3} q ${w * 0.04} 0 ${w * 0.04} ${h * 0.06} t ${-w * 0.04} ${h * 0.06} l ${w * 0.08} ${h * 0.5} h ${-w * 0.16} z`} fill="#050506" />
      )}
      {kind === 'gate' && (
        <g fill="#5a1210" opacity="0.9">
          <rect x={w * 0.36} y={h * 0.32} width={w * 0.025} height={h * 0.5} />
          <rect x={w * 0.615} y={h * 0.32} width={w * 0.025} height={h * 0.5} />
          <rect x={w * 0.3} y={h * 0.28} width={w * 0.4} height={h * 0.035} />
          <rect x={w * 0.33} y={h * 0.38} width={w * 0.34} height={h * 0.022} />
        </g>
      )}
      {kind === 'rain' &&
        Array.from({ length: 40 }, (_, i) => (
          <line key={i} x1={(i * 37) % w} y1={(i * 53) % h} x2={((i * 37) % w) - 6} y2={((i * 53) % h) + h * 0.12} stroke="#eae7e2" strokeOpacity="0.08" />
        ))}
      {kind === 'blade' && <line x1={w * 0.62} y1={h * 0.08} x2={w * 0.42} y2={h * 0.92} stroke="#c9c9cc" strokeWidth={h * 0.008} opacity="0.7" />}
      {kind === 'window' && <rect x={w * 0.6} y={h * 0.18} width={w * 0.22} height={h * 0.5} fill="#b3201f" opacity="0.18" />}
      <rect width={w} height={h} filter={`url(#${id}n)`} />
    </svg>
  )
}

export const FRAMES: Frame[] = [
  { id: '01', aspect: '2.39 / 1', caption: 'Frame 01 — placeholder', art: () => art('horizon', 956, 400, 1) },
  { id: '02', aspect: '4 / 5', caption: 'Frame 02 — placeholder', art: () => art('figure', 400, 500, 2) },
  { id: '03', aspect: '16 / 9', caption: 'Frame 03 — placeholder', art: () => art('moon', 640, 360, 3) },
  { id: '04', aspect: '4 / 5', caption: 'Frame 04 — placeholder', art: () => art('gate', 400, 500, 4) },
  { id: '05', aspect: '2.39 / 1', caption: 'Frame 05 — placeholder', art: () => art('rain', 956, 400, 5) },
  { id: '06', aspect: '16 / 9', caption: 'Frame 06 — placeholder', art: () => art('blade', 640, 360, 6) },
  { id: '07', aspect: '4 / 5', caption: 'Frame 07 — placeholder', art: () => art('window', 400, 500, 7) },
]
