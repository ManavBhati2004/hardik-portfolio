/* ─────────────────────────────────────────────────────────────────────────────
   Craftsmanship — editable copy. Short, honest descriptions; no numbers or claims.
   ───────────────────────────────────────────────────────────────────────────── */

export const CRAFT_INTRO = {
  heading: ['Every cut', 'is a decision.'],
  // TODO: Hardik to confirm / rewrite in his own words
  body: 'I edit for rhythm and feeling first — where a shot breathes, where it cuts, what the sound carries. The craft below is the work I do on every project.',
}

export interface Discipline {
  title: string
  description: string
}

export const DISCIPLINES: Discipline[] = [
  { title: 'Video Editing', description: 'Structure, pacing and story shaped from raw footage into a finished cut.' },
  { title: 'Motion Graphics', description: 'Titles, typography and graphic motion designed to sit inside the film.' },
  { title: 'Colour Grading', description: 'A consistent look and mood, balanced shot to shot.' },
  { title: 'Sound Design & Pacing', description: 'Music, effects and silence used to set the tempo of the edit.' },
  { title: 'Real Estate Films', description: 'Property films paced around light, space and the feeling of arrival.' },
  { title: 'Documentary Storytelling', description: 'Interview-led stories built and refined in the edit.' },
  { title: 'AI-assisted Visuals', description: 'Visual development with AI-assisted tools, finished by hand.' },
]

// TODO: Hardik to confirm the tools he actually uses
export const TOOLS = ['Premiere Pro', 'After Effects', 'DaVinci Resolve']
