/* ─────────────────────────────────────────────────────────────────────────────
   Craftsmanship — editable copy. Short, honest descriptions; no numbers or claims.
   The section renders as an edit timeline: each discipline is a clip on a track,
   with an in/out point (seconds) on a short sequence. Clips must not overlap in
   time — the clip under the playhead is the "live" discipline.
   ───────────────────────────────────────────────────────────────────────────── */

export const CRAFT_INTRO = {
  heading: ['Every cut', 'is a decision.'],
  // TODO: Hardik to confirm / rewrite in his own words
  body: 'I edit for rhythm and feeling first — where a shot breathes, where it cuts, what the sound carries. The craft below is the work I do on every project.',
}

export type TrackId = 'FX' | 'V2' | 'V1' | 'A1' | 'A2'

export interface Track {
  id: TrackId
  kind: 'fx' | 'video' | 'audio'
  /** Shown in the track header. */
  name: string
}

/** Top → bottom, as in an NLE: effects, video layers, then audio. */
export const TRACKS: Track[] = [
  { id: 'FX', kind: 'fx', name: 'Colour' },
  { id: 'V2', kind: 'video', name: 'Graphics' },
  { id: 'V1', kind: 'video', name: 'Picture' },
  { id: 'A1', kind: 'audio', name: 'Score' },
  { id: 'A2', kind: 'audio', name: 'Dialogue' },
]

/** Procedural monitor loop shown while the clip is live (placeholder until real footage). */
export type LoopId = 'cuts' | 'motion' | 'grade' | 'sound' | 'space' | 'interview' | 'generative'

export interface Discipline {
  title: string
  description: string
  track: TrackId
  /** In / out points on the sequence, in seconds. */
  in: number
  out: number
  loop: LoopId
}

export const DISCIPLINES: Discipline[] = [
  { title: 'Video Editing', description: 'Structure, pacing and story shaped from raw footage into a finished cut.', track: 'V1', in: 0, out: 8, loop: 'cuts' },
  { title: 'Motion Graphics', description: 'Titles, typography and graphic motion designed to sit inside the film.', track: 'V2', in: 8, out: 14, loop: 'motion' },
  { title: 'Colour Grading', description: 'A consistent look and mood, balanced shot to shot.', track: 'FX', in: 14, out: 21, loop: 'grade' },
  { title: 'Sound Design & Pacing', description: 'Music, effects and silence used to set the tempo of the edit.', track: 'A1', in: 21, out: 28, loop: 'sound' },
  { title: 'Real Estate Films', description: 'Property films paced around light, space and the feeling of arrival.', track: 'V1', in: 28, out: 35, loop: 'space' },
  { title: 'Documentary Storytelling', description: 'Interview-led stories built and refined in the edit.', track: 'V2', in: 35, out: 42, loop: 'interview' },
  { title: 'AI-assisted Visuals', description: 'Visual development with AI-assisted tools, finished by hand.', track: 'V1', in: 42, out: 48, loop: 'generative' },
]

/** Sequence settings shown in the panel header. */
export const SEQUENCE = { name: 'Craft_Reel_v07', fps: 24, duration: 48 }

/** Decorative media under / around the disciplines — gives the timeline a real edit's density. */
export interface FillerClip {
  track: TrackId
  in: number
  out: number
  name: string
}

export const FILLER_CLIPS: FillerClip[] = [
  { track: 'FX', in: 0, out: 13.5, name: 'Adj · Base look' },
  { track: 'FX', in: 21.5, out: 48, name: 'Adj · Film LUT' },
  { track: 'V2', in: 1.5, out: 6.5, name: 'Title_01' },
  { track: 'V2', in: 15, out: 26, name: 'Lower_third' },
  { track: 'V2', in: 43, out: 47.5, name: 'End_card' },
  { track: 'V1', in: 8, out: 15.5, name: 'A001_C014' },
  { track: 'V1', in: 15.5, out: 28, name: 'B-roll_03' },
  { track: 'V1', in: 35, out: 42, name: 'INT_0412' },
  { track: 'A1', in: 0, out: 20.5, name: 'Score_mix' },
  { track: 'A1', in: 28.5, out: 48, name: 'Score_mix' },
  { track: 'A2', in: 2, out: 19, name: 'VO_take3' },
  { track: 'A2', in: 33, out: 46, name: 'Interview_A' },
]

// TODO: Hardik to confirm the tools he actually uses
export const TOOLS = ['Premiere Pro', 'After Effects', 'DaVinci Resolve']
