# Hardik Gehlot — Portfolio

A cinematic single-page portfolio: a live three.js night scene (red moon, katana, water,
fog, torii, blossom branch) behind an HTML overlay, with a choreographed GSAP motion system.

**Stack:** Vite 8 · React 19 · TypeScript · @react-three/fiber 9 · drei 10 · postprocessing ·
GSAP 3.15 (ScrollTrigger, SplitText) · Lenis.

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build
```

Dev-only helpers: `?overlay=1` lays `reference/hero-reference.jpg` over the page at 50%
for layout QA (never shipped, never used as a background). `window.__scene`, `__r3f`,
`__lenis` are exposed in dev for inspection.

## Page structure

| # | Nav label | Section id | Component |
|---|---|---|---|
| 01 | The Blade | `#hero` | `src/components/Hero.tsx` |
| 02 | Craftsmanship | `#craft` | `src/components/Craftsmanship.tsx` |
| 03 | Legacy | `#work` | `src/components/SelectedWork.tsx` (+ `ProjectOverlay.tsx`) |
| 04 | Gallery | `#gallery` | `src/components/Gallery.tsx` |
| — | Enquire ↗ | `#contact` | `src/components/Contact.tsx` |

## Editing content

- **Projects (Legacy):** `src/data/projects.tsx`. Every entry is a placeholder marked `TODO`.
  Set `title`, `category`, `year`, `description`, and point `poster` at a 16:9 image in
  `public/work/` (e.g. `/work/project-01.jpg`). Optional `videoSrc` (short muted clip, plays
  on hover after 250 ms) and `href` (link to the full piece). Without a poster the card shows
  its generated artwork.
- **Gallery frames:** `src/data/gallery.tsx`. Set `src` to an image in `public/gallery/`,
  update `caption`, and keep `aspect` as `'16 / 9'`, `'4 / 5'` or `'2.39 / 1'`.
- **Craftsmanship copy and tools:** `src/data/craft.ts` (tools list is marked TODO to confirm).
- **Contact links:** `LINKS` at the top of `src/components/Contact.tsx` (placeholders).
- **Hero text:** `src/components/Hero.tsx`.

## Where things live

- `src/scene/config.ts` — single source of truth: camera, moon, water level, palette,
  the reference composition anchors (`HERO_LAYOUT`) and the camera journey keys (`CAMERA_PATH`).
- `src/scene/store.ts` — mutable scene store (no React state). Each field has one writer;
  `useFrame` reads it. Also a tiny event bus (`ready`, `section`, `jump`, `canvas`).
- `src/scene/placement.ts` — `pointAtNdc()` + `heroCamera()`: everything is placed against a
  fixed hero camera so the composition matches the reference on any aspect ratio, even while
  the live camera travels.
- `src/scene/linkUniforms.ts` — R3F 9 copies `uniforms` props into new objects; every
  `<shaderMaterial>` uses `ref={linkUniforms(uniforms)}` so animated uniforms reach the GPU.
- `src/motion/` — the motion system:
  - `introTimeline.ts` — master hero intro timeline (after the fog-parting preloader)
  - `sections.ts` — scroll → camera journey, katana sink/return, counter, scene dim; generic
    `data-reveal` scroll reveals (`lines`, `ink`, `rise`)
  - `slash.ts` — blade-slash wipe for nav clicks
  - `inkMask.ts` — organic ink-bleed mask reveals
  - `split.ts` — SplitText masked line/char helpers
- `src/components/Preloader.tsx` — "Fog Parting" preloader (real load progress).

## Assets

Only optimised assets ship from `public/`:
`models/*.opt.glb` (meshopt + WebP textures, made with `@gltf-transform/cli optimize`),
`textures/moon_nasa_2k.jpg` (+ normal), `fonts/` (self-hosted Cormorant Garamond).
Sources and unused heavy files (49 MB katana source, 4K torii PNGs, moon source files,
fog PNGs, audio) were moved to `assets-src/`, which is not part of the build and is
git-ignored (one texture exceeds GitHub's 100 MB file limit) — keep it locally or in
external storage.

To re-optimise a model:

```bash
npx @gltf-transform/cli optimize assets-src/models/torii.glb public/models/torii.opt.glb --compress meshopt --texture-compress webp --texture-size 2048 --join false --flatten false --instance false --simplify false --weld false --palette false
```

Components that read raw geometry from a quantised GLB must use `bakeGeometry()`
(`src/scene/bakeGeometry.ts`) so the node scale is applied.

## Motion rules

One clock (GSAP ticker drives Lenis; R3F renders on rAF), one owner per animated property,
no per-frame React state, everything scroll-linked reverses cleanly. `prefers-reduced-motion`
keeps layout and fades but removes the camera journey, slash wipe, parallax and skew, and
drops ambient 3D motion to 15%.
