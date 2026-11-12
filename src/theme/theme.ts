import { emitSceneEvent, sceneStore } from '../scene/store'

/* ─────────────────────────────────────────────────────────────────────────────
   Day / night theme state.
   - `html[data-theme]` drives every CSS colour token.
   - `sceneStore.day` (0 night, 1 day) drives the 3D scene; it flips instantly
     (the ink overlay hides the switch).
   - Dark on first visit; a visitor's choice is remembered.
   The inline script in index.html applies the saved theme before first paint.
   ───────────────────────────────────────────────────────────────────────────── */

export type Theme = 'light' | 'dark'

const KEY = 'hg-theme'
const root = document.documentElement

export function getTheme(): Theme {
  return root.dataset.theme === 'light' ? 'light' : 'dark'
}

export function otherTheme(t: Theme): Theme {
  return t === 'dark' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  root.dataset.theme = theme
  sceneStore.day = theme === 'light' ? 1 : 0
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage blocked: the choice simply isn't remembered */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f3f0ea' : '#030304')
  emitSceneEvent('theme')
}

// sync the scene with whatever the inline script applied
sceneStore.day = getTheme() === 'light' ? 1 : 0
