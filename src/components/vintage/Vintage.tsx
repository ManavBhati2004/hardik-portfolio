import type { CSSProperties } from 'react'

/* Shared pieces of the aged-scroll look (styles in styles/vintage.css). */

/** Old-style formal numerals used on scrolls and seals. */
const KANJI_NUM = ['壱', '弐', '参', '四', '五', '六', '七', '八', '九', '十']
export const kanjiNumeral = (n: number) => KANJI_NUM[(n - 1) % KANJI_NUM.length]

/** One shared SVG filter: roughens edges like a dry brush / a worn seal. Mounted once. */
export function VintageDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="v-rough" x="-5%" y="-40%" width="110%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045 0.5" numOctaves="2" seed="4" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <filter id="v-worn" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="5" result="m" />
          <feColorMatrix in="m" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.3 1.4" result="holes" />
          <feComposite in="d" in2="holes" operator="in" />
        </filter>
      </defs>
    </svg>
  )
}

/** A sumi brush stroke: loaded at the start, drying and thinning toward the end. */
export function BrushStroke({ className = '', reveal, delay }: { className?: string; reveal?: boolean; delay?: number }) {
  return (
    <svg
      className={`brush ${className}`}
      viewBox="0 0 400 10"
      preserveAspectRatio="none"
      aria-hidden="true"
      data-reveal={reveal ? 'brush' : undefined}
      data-delay={delay}
    >
      <path
        filter="url(#v-rough)"
        d="M2 5.2 C 30 1.4, 90 2.2, 150 3.4 S 300 3.2, 398 5 C 330 6.4, 250 7.6, 170 7.4 S 40 8.8, 2 5.2 Z"
      />
    </svg>
  )
}

/** A red seal with one character. */
export function Hanko({
  text,
  size,
  outline,
  className = '',
  reveal,
  delay,
}: {
  text: string
  size?: string
  outline?: boolean
  className?: string
  reveal?: boolean
  delay?: number
}) {
  return (
    <span
      className={`hanko${outline ? ' hanko--outline' : ''} ${className}`}
      style={size ? ({ ['--hanko-size' as string]: size } as CSSProperties) : undefined}
      lang="ja"
      aria-hidden="true"
      data-reveal={reveal ? 'stamp' : undefined}
      data-delay={delay}
    >
      <svg viewBox="0 0 48 48">
        <g filter="url(#v-worn)">
          <rect x="2" y="2" width="44" height="44" rx="5" />
          <text x="24" y="25">
            {text}
          </text>
        </g>
      </svg>
    </span>
  )
}
