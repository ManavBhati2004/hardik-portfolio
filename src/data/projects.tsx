import type { ReactNode } from 'react'

/* ─────────────────────────────────────────────────────────────────────────────
   Legacy (Selected Work) — editable project list. ALL ENTRIES ARE PLACEHOLDERS.

   To add a real project, edit an entry below:
   - `title`       : project name
   - `category`    : one of the disciplines (shown under the title)
   - `year`        : e.g. '2025' (leave '' to hide)
   - `description` : one or two honest sentences for the case overlay
   - `poster`      : 16:9 thumbnail in /public/work/ (e.g. '/work/project-01.jpg')
   - `videoSrc`    : optional short muted preview clip (mp4/webm), plays on hover
   - `href`        : optional link to the full piece (Vimeo, YouTube, case study…)
   Until a poster is supplied, the card shows its built-in artwork.
   ───────────────────────────────────────────────────────────────────────────── */

export interface Project {
  id: string
  title: string
  category: string
  year: string
  description: string
  poster?: string
  videoSrc?: string
  href?: string
  renderArtwork: () => ReactNode
}
export const PROJECTS: Project[] = [
  {
    id: '01',
    title: 'Project Title 01', // TODO: replace
    category: 'Cinematic Edit',
    year: '', // TODO: add year
    description: 'Placeholder — a narrative edit built on rhythm, restraint and image. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-01.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="moonGlow" cx="65%" cy="40%" r="45%">
            <stop offset="0%" stopColor="#E62424" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#9E1010" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#0B0B0B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill="#0C0C0E" />
        <circle cx="260" cy="90" r="105" fill="url(#moonGlow)" />
        <circle cx="260" cy="90" r="52" fill="#B11818" />
        <circle cx="250" cy="86" r="47" fill="#880F0F" opacity="0.65" />
        <path d="M0 176 Q100 146 220 168 T400 161 L400 225 L0 225 Z" fill="#141416" />
        <ellipse cx="200" cy="184" rx="180" ry="12" fill="#B12020" opacity="0.18" />
        <g transform="translate(190, 108) scale(0.6)" fill="#0B0B0B">
          <ellipse cx="20" cy="10" rx="6" ry="7" />
          <path d="M12 17 Q20 15 28 17 L32 50 L8 50 Z" />
          <path d="M8 22 L-8 42 L-5 44 L11 26 Z" />
          <path d="M28 22 L40 40 L37 42 L25 26 Z" />
          <path d="M10 50 L12 85 L18 85 L18 50 Z" />
          <path d="M22 50 L22 85 L28 85 L30 50 Z" />
          <line x1="-12" y1="46" x2="55" y2="8" stroke="#EAE7E2" strokeWidth="1.8" />
          <line x1="-12" y1="46" x2="-2" y2="38" stroke="#9E1010" strokeWidth="2.8" />
        </g>
        <path d="M0 191 C120 176 280 199 400 184" stroke="rgba(255,255,255,0.12)" strokeWidth="8" fill="none" />
        <path d="M0 206 C150 195 250 210 400 199" stroke="rgba(220,30,30,0.22)" strokeWidth="11" fill="none" />
      </svg>
    ),
  },
  {
    id: '02',
    title: 'Project Title 02', // TODO: replace
    category: 'Brand / Commercial Edit',
    year: '', // TODO: add year
    description: 'Placeholder — a short commercial cut for a brand, graded low-key. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-02.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="sideLight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#C41C1C" stopOpacity="0.5" />
            <stop offset="40%" stopColor="#450F0F" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#0B0B0B" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="faceRim" cx="30%" cy="40%" r="50%">
            <stop offset="0%" stopColor="#E62424" stopOpacity="0.5" />
            <stop offset="50%" stopColor="#8B1010" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill="#0C0C0E" />
        <rect width="400" height="225" fill="url(#sideLight)" />
        <g transform="translate(140, 10) scale(0.8)">
          <path d="M40 50 C20 90 25 150 45 180 C65 210 110 220 130 200 C150 170 150 90 120 50 C95 20 60 20 40 50 Z" fill="#141416" />
          <path d="M40 50 C20 90 25 150 45 180 C50 188 56 195 65 200" stroke="#C41515" strokeWidth="4.5" fill="none" opacity="0.85" />
          <path d="M44 55 C26 92 30 148 48 176" stroke="#FFAAAA" strokeWidth="1.5" fill="none" opacity="0.7" />
          <path d="M60 90 L52 125 L65 130" stroke="#E62424" strokeWidth="2.8" fill="none" opacity="0.8" />
          <path d="M56 145 C64 148 72 147 78 144" stroke="#A81515" strokeWidth="2.2" fill="none" />
          <circle cx="50" cy="40" r="14" fill="#1C1C20" stroke="#9E1010" strokeWidth="1.8" />
          <circle cx="70" cy="30" r="16" fill="#18181C" stroke="#9E1010" strokeWidth="1.2" />
          <circle cx="95" cy="32" r="15" fill="#141418" />
          <path d="M45 180 C30 210 10 240 -10 260 L180 260 C160 230 140 210 130 200 Z" fill="#101012" />
        </g>
        <rect width="400" height="225" fill="url(#faceRim)" />
      </svg>
    ),
  },
  {
    id: '03',
    title: 'Project Title 03', // TODO: replace
    category: 'Motion Graphics',
    year: '', // TODO: add year
    description: 'Placeholder — typographic and graphic motion for a title or brand sequence. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-03.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="mistGlow" cx="50%" cy="55%" r="60%">
            <stop offset="0%" stopColor="#851010" stopOpacity="0.45" />
            <stop offset="50%" stopColor="#300808" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#0B0B0B" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill="#0C0C0E" />
        <rect width="400" height="225" fill="url(#mistGlow)" />
        <path d="M0 131 Q140 101 280 124 T400 116 L400 225 L0 225 Z" fill="#121216" />
        <rect y="154" width="400" height="71" fill="#0E0E12" />
        <ellipse cx="200" cy="169" rx="80" ry="3" fill="#C41515" opacity="0.45" />
        <ellipse cx="200" cy="179" rx="110" ry="4" fill="#B11818" opacity="0.32" />
        <ellipse cx="200" cy="191" rx="145" ry="5" fill="#8B1010" opacity="0.22" />
        <g transform="translate(152, 62) scale(0.8)">
          <rect x="25" y="25" width="9" height="90" rx="1" fill="#8B1010" />
          <rect x="87" y="25" width="9" height="90" rx="1" fill="#8B1010" />
          <path d="M5 20 Q60 13 115 20 L118 12 Q60 6 2 12 Z" fill="#C41818" />
          <rect x="15" y="38" width="90" height="6.5" rx="1" fill="#9E1010" />
          <rect x="26" y="115" width="7" height="38" fill="#8B1010" opacity="0.3" />
          <rect x="88" y="115" width="7" height="38" fill="#8B1010" opacity="0.3" />
        </g>
        <path d="M-20 161 C100 146 260 169 420 154" stroke="rgba(220,210,205,0.12)" strokeWidth="12" fill="none" />
        <path d="M-20 176 C120 161 280 184 420 169" stroke="rgba(220,30,30,0.20)" strokeWidth="15" fill="none" />
      </svg>
    ),
  },
  /* ── Neutral, editable placeholders (replace with real projects) ── */
  {
    id: '04',
    title: 'Project Title 04', // TODO: replace
    category: 'Real Estate Film',
    year: '', // TODO: add year
    description: 'Placeholder — a property film paced around light, space and arrival. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-04.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="reDusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#120c0e" />
            <stop offset="70%" stopColor="#24110f" />
            <stop offset="100%" stopColor="#0c0c0e" />
          </linearGradient>
        </defs>
        <rect width="400" height="225" fill="url(#reDusk)" />
        <path d="M70 150 L70 92 L170 60 L300 92 L300 150 Z" fill="#141416" />
        <path d="M60 96 L170 56 L312 96" stroke="#3a1a18" strokeWidth="3" fill="none" />
        <rect x="96" y="104" width="44" height="30" fill="#c8742e" opacity="0.55" />
        <rect x="156" y="104" width="44" height="30" fill="#d88a3a" opacity="0.4" />
        <rect x="226" y="104" width="50" height="46" fill="#c8742e" opacity="0.5" />
        <rect y="150" width="400" height="75" fill="#0b0b0d" />
        <rect x="80" y="156" width="210" height="10" fill="#c8742e" opacity="0.12" />
        <line x1="0" y1="150" x2="400" y2="150" stroke="rgba(234,231,226,0.08)" />
      </svg>
    ),
  },
  {
    id: '05',
    title: 'Project Title 05', // TODO: replace
    category: 'Documentary / Story Edit',
    year: '', // TODO: add year
    description: 'Placeholder — interview-led storytelling shaped in the edit. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-05.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="docLight" cx="72%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#d9c9b0" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0c0c0e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill="#0d0d0f" />
        <rect width="400" height="225" fill="url(#docLight)" />
        <rect x="262" y="34" width="70" height="96" fill="#1a1712" stroke="#3b3326" strokeWidth="2" />
        <line x1="297" y1="34" x2="297" y2="130" stroke="#3b3326" strokeWidth="2" />
        <line x1="262" y1="82" x2="332" y2="82" stroke="#3b3326" strokeWidth="2" />
        <path d="M120 225 L130 140 Q150 110 180 112 Q214 116 222 146 L232 225 Z" fill="#141414" />
        <circle cx="176" cy="92" r="24" fill="#161616" />
        <path d="M156 84 Q176 64 198 84" stroke="#b9a68a" strokeWidth="2" fill="none" opacity="0.45" />
        <rect x="0" y="0" width="400" height="18" fill="#000" opacity="0.6" />
        <rect x="0" y="207" width="400" height="18" fill="#000" opacity="0.6" />
      </svg>
    ),
  },
  {
    id: '06',
    title: 'Project Title 06', // TODO: replace
    category: 'AI-assisted Visuals',
    year: '', // TODO: add year
    description: 'Placeholder — visuals developed with AI-assisted tools, finished by hand in the edit. Replace with the real project description.',
    poster: undefined, // TODO: replace with '/work/project-06.jpg'
    videoSrc: undefined, // TODO: replace with a short muted preview clip
    href: undefined, // TODO: replace with the full project link
    renderArtwork: () => (
      <svg viewBox="0 0 400 225" className="work-svg-thumb" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="aiCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#b11818" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#0c0c0e" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill="#0c0c0e" />
        <circle cx="200" cy="112" r="96" fill="url(#aiCore)" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <ellipse
            key={i}
            cx="200"
            cy="112"
            rx={34 + i * 15}
            ry={14 + i * 7}
            fill="none"
            stroke="#eae7e2"
            strokeOpacity={0.16 - i * 0.018}
            transform={`rotate(${i * 11 - 30} 200 112)`}
          />
        ))}
        <circle cx="200" cy="112" r="6" fill="#eae7e2" opacity="0.85" />
      </svg>
    ),
  },
]
