# Implementation Plan: Premium Cinematic Rebuild (Pass 2)

Spec: `docs/premium-motion-prompt.md` · Reference: `reference/hero-reference.jpg`
Status: **PLAN ONLY. No source files have been changed.** Approve this plan before implementation starts.

---

## A. Audit findings (current state vs. spec)

### What's rendered today
`App` → `Scene3D` (fixed canvas) + HTML overlay (`Navigation`, `Hero`, `SelectedWork`, `Contact`, `AudioPlayer`).
`Scene3D` renders: `SkyBackground`, `RedMoon`, `MoonRing`, `Katana` (+`KatanaTassel`), `Water`, `BlossomBranch`, `FallingLeaves`, `Environment` (`Rocks` + torii raycast onto the cliff), `GroundFog`, `HorizonEffect`, `SceneEnvironment` (Lightformer IBL), `PostFX` (N8AO, DoF, Bloom, AgX, Vignette, Noise, SMAA).

### Already in good shape (keep)
- The `sceneStore` / no-React-state pattern, `pointAtNdc` placement, and Lenis + GSAP on one clock.
- Katana: scroll-spin spring, separate cursor tilt layer, rise-from-water intro, and fixed scale.
- The torii is already placed on the right cliff. Rocks use real scanned GLBs.
- `SelectedWork`: a single GSAP timeline per card and quickTo parallax. This is the right architecture.

### Gaps against the reference / spec
| Area | Current | Needed |
|---|---|---|
| Hero title font | `Reggae One` / `Shojumaru` (brushy, heavy) | Thin, wide-tracked luxury serif (Cormorant Garamond / Cinzel light) |
| Hero buttons | `VintagePlacardButton` senjafuda placards (16 KB) | One thin outlined "Explore My Work →" rectangle |
| Kanji | No logo 侍, no giant faded 侍, no vertical 暁の刃 | Add all three, with ink reveals |
| Nav | Work · Contact · "Get in Touch" | The Blade · Craftsmanship · Legacy · Gallery · Enquire ↗ |
| Counter | none | Live "01 / 04" plus a progress line |
| Sections | hero, work, contact | + `#craft`, `#gallery` |
| Blade colour | plain steel | Restrained crimson gradient toward the tip |
| Preloader | none | Fog parting tied to real load progress |
| Transitions | per-section CSS/GSAP only | Camera journey + slash wipe on nav + ink-bleed reveals |
| Katana after hero | spins in place | Sinks after the hero, returns at Contact |
| Audio | `AudioPlayer` mounted | Remove (user choice) |

### Dead code / dead weight
- **Unused components:** `AtmosphericFog.tsx`, `CinematicPostProcessing.tsx` (imported nowhere). `VolumetricFogPrototype.tsx` is only reachable through `?prototype=fog`.
- **Unused public assets** (shipped into `dist/` on every build): `images/fog1–5.png` (~13 MB), `textures/torii/Concrete025_4K-PNG/*` (~280 MB), `textures/sky_panorama.png`, `red_moon.png`, `moon_reference*`, `moon_diffuse_ref`, `moon_bump_ref`, `kloppenheim_02_puresky_2k.hdr`, `models/moon_3d/*` (~25 MB incl. .blend/.max/.c4d), `models/autumn_tree.glb`, `models/katana.glb` (49 MB source).
- **Fonts:** `index.html` loads 6 Google font families. `Yuji Boku` is unused, and `Reggae One`/`Shojumaru` go away with the redesign.
- **Boilerplate:** the README template and `src/assets/react.svg`, `vite.svg`, `hero.png`.

---

## B. Phased plan

Each phase ends with a build check, a browser check and a screenshot. Phases 1–3 are the visible "match the reference" milestone. Phases 4–7 add motion.

### Phase 0: Safety (≈ 5 min)
- `git init` (if not already a repo) and commit the current state as `baseline`, so every phase can be reverted.
- Create a `_unused/` folder outside `public/` for moved assets. Nothing gets deleted outright.

### Phase 1: Cleanup and assets
- Move the unused assets listed above into `_unused/` (outside `public/`, so they're no longer deployed). **Asks you first** before moving the `moon_3d` source files and the 4K torii textures.
- Remove `AudioPlayer` from `App.tsx` and move its files to `_unused/`.
- Delete `AtmosphericFog.tsx` and `CinematicPostProcessing.tsx`. Keep `VolumetricFogPrototype` only if it's still used for fog tuning (to confirm).
- Run the GLBs through `@gltf-transform/cli` (meshopt + WebP textures, max 2K): `blossom_branch` (5 MB), `torii` (3.7 MB) and the rocks. Keep the originals in `_unused/`.
- Fonts: self-host Cormorant Garamond (300/400), Inter (400/500) and Noto Serif JP (300, subset to 侍暁の刃技 + digits) as woff2, preload the display face, and drop the Google Fonts link.
- **Files:** `App.tsx`, `index.html`, `src/styles/fonts.css` (new), `tokens.css`, `public/**`.

### Phase 2: Hero HTML overlay, pixel-matched
- Rewrite `Hero.tsx` / `Hero.css` to the §3 measurements (percentage/clamp layout): giant 侍, title, subtitle, rule, description, outlined button, vertical 暁の刃 + line, scroll indicator, counter.
- Rewrite `Navigation.tsx` / `.css`: 侍 logo, four centered links, Enquire pill, plus a mobile menu overlay.
- New `src/components/ui/OutlineButton.tsx`, `SectionCounter.tsx`, `KanjiInk.tsx` (SVG stroke-mask reveal).
- `VintagePlacardButton` gets moved to `_unused/` (it's no longer used).
- **Check:** overlay a 1600×900 screenshot on the reference at 50% opacity.

### Phase 3: 3D composition match
- `Katana.tsx`: retune `pointAtNdc` targets so the pommel, guard and tip land at (54, 9.5) / (52, 29) / (43.5, 84.5)%, and adjust `REST_TILT_Z` / `REST_SPIN`. Add the crimson-to-tip blade gradient through `onBeforeCompile` (a uniform along the local Y axis, applied to the env/specular response, not emissive).
- `config.ts` / `RedMoon.tsx`: moon center (47.5, 32)%, radius 16vh equivalent, darker lower-left limb.
- `MoonRing.tsx`: radius ≈ 30vh equivalent, exactly 3 drifting segments (check the current segment count).
- `AutumnTree.tsx` (BlossomBranch): keep it inside the 0–35% × 0–33% corner and clear of the logo and title.
- `Environment.tsx`: nudge the rock and torii placements to the reference silhouettes (left group 0–24%, right mass 57–100%, torii at (89, 58)%).
- `FallingLeaves.tsx`: cap at about 4–6 visible leaves.
- `GroundFog.tsx`: concentrate density at y 75–92%, thinner in the center, with wisps around the torii.
- **Check:** screenshot overlay again. List the remaining differences and fix the largest.

### Phase 4: Preloader and intro choreography
- New `src/components/Preloader.tsx`: drei `useProgress` → eased 000–100 counter + small 侍. On completion, a `sceneStore.fogPart` uniform (0→1) parts the fog from the center, then hands off to the intro.
- New `src/motion/introTimeline.ts`: one master GSAP timeline (§5 table) that drives both the HTML (SplitText line/char masks) and the 3D (moon/ring/branch via `sceneStore` values). The existing katana rise gets triggered by the timeline instead of starting on mount.
- Warm up shaders with `gl.compile(scene, camera)` before the reveal.
- Reduced motion: 0.6 s crossfade.

### Phase 5: Sections and navigation system
- `App.tsx`: sections `#hero`, `#craft`, `#work`, `#gallery`, `#contact`.
- New `Craftsmanship.tsx` / `.css` (discipline rows with hover expand, 技 ink label) and `Gallery.tsx` / `.css` (pinned horizontal track, velocity skew).
- `src/data/craft.ts` and `src/data/gallery.ts`: editable placeholders.
- `src/motion/sections.ts`: one ScrollTrigger per section writes `sceneStore.section` (0–4) and drives the counter roll and the sliding nav underline (FLIP).

### Phase 6: Transition system
- **Camera journey:** new `src/scene/cameraPath.ts` (keyframes per section) and a `CameraRig` upgrade that damps toward `sceneStore.cameraT`. Per-section uniforms for scene dimming and fog density.
- **Katana sink and return:** a separate `offsetY` layer in `Katana.tsx` driven by section progress (sinks after the hero, rises at contact with a more upright rest pose). `Water.tsx` ripple burst at the entry/exit point.
- **Blade-slash wipe:** new `src/components/SlashTransition.tsx`, two clip-path halves at −62°. `scrollToTarget()` is wrapped so nav, Enquire and hero-button clicks run the wipe, guarded against re-entry.
- **Ink-bleed reveals:** new `src/components/ui/InkReveal.tsx` (SVG `feTurbulence` + `feDisplacementMap` mask animated by GSAP), used by cards, gallery frames and section labels.

### Phase 7: Legacy upgrade and micro-interactions
- `SelectedWork` → asymmetric editorial grid with 6 niche placeholders (`projects.tsx` + TODO comments + README guide), ink-bleed entrance, per-column parallax, and an optional FLIP case overlay.
- Button fill/arrow loop, nav letter-roll, Enquire arrow, scroll-indicator loop, selection colour. **No custom cursor; the system cursor stays.**
- `Contact` restyled as the finale, laid out around the returning katana.

### Phase 8: Reduced motion, mobile, performance
- Reduced-motion paths for every timeline. Mobile layout and nav overlay. Adaptive quality is kept.
- Code-split `Gallery` / `Craftsmanship` / the case overlay. Check in the Network tab that no 49 MB / 4K files load.
- Replace the README.

### Phase 9: Visual QA
- Screenshot overlays at 1600×900, 1440×900, 1920×1080 and 390×844. Run through the §16 checklist and fix the biggest differences. Nothing gets marked done without being seen working in the browser.

---

## C. New dependencies
- `@gltf-transform/cli` (dev only, for asset compression).
- Self-hosted font files (no package needed).
- Nothing else: GSAP SplitText ships with the installed gsap 3.15.

## D. Risks and decisions to confirm before starting
1. **Moving the source assets** (`moon_3d` .blend/.max/.c4d, the 4K torii PNGs, `katana.glb`) out of `public/` to `_unused/`. They stay on disk but stop being deployed. OK?
2. **`VolumetricFogPrototype` (`?prototype=fog`)**: keep it as a dev tool or remove it?
3. **Hero description:** shorten it to one line to match the reference rhythm? Proposed: *"Turning ideas into cinematic stories through editing and motion."*
4. **Counter:** it shows 01–04 for the four nav sections, and stays at 04 (with the line full) during Contact. OK?
5. **Git:** is the folder already a git repo? If not, can I initialise one for the baseline commit?
