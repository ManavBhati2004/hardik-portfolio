# HARDIK GEHLOT PORTFOLIO: PREMIUM CINEMATIC REBUILD (PASS 2)
## Pixel-faithful hero recreation + full motion and transition system

> Attach the reference image (the "AKATSUKI" katana web page) with this prompt, and save a copy at `reference/hero-reference.jpg` in the project so you can compare it against screenshots.

---

## 0. Context: read this first

You are working inside the existing project `hardik-gehlot-portfolio`. Do **not** start a new project.

**Current stack (confirmed):** Vite 8 + React 19 + TypeScript, `@react-three/fiber` 9, `@react-three/drei` 10, `three` 0.187, `postprocessing` / `@react-three/postprocessing`, `n8ao`, `gsap` 3.15 (ScrollTrigger, and SplitText, which is free in this version), `lenis` smooth scroll driven from the GSAP ticker.

**Existing architecture you must keep:**
- `src/scene/store.ts`: a mutable `sceneStore` with no React state. Scroll writes to it and `useFrame` reads from it. Keep this pattern for all new scroll and transition values.
- `src/scene/config.ts`: the single source of truth for camera, moon, water and palette constants.
- `src/scene/placement.ts`: `pointAtNdc()` keeps objects pinned to screen positions across aspect ratios. Use it for every placement below.
- `src/hooks/useScrollProgress.ts`: Lenis + ScrollTrigger on one clock, plus `scrollToTarget()`.
- `src/components/Katana.tsx`: the uploaded `katana.opt.glb` with a scroll-driven spring spin, a separate damped cursor tilt/drift layer, a rise-from-water intro and `KatanaTassel`.
- Existing scene components: `SkyBackground`, `RedMoon`, `MoonRing`, `Water` (live reflection), `BlossomBranch` (in `AutumnTree.tsx`), `FallingLeaves`, `Environment`, `GroundFog`, `HorizonEffect`, `SceneEnvironment`, `PostFX`.
- `src/components/SelectedWork.tsx` and `src/data/projects.tsx`: a GSAP card timeline and quickTo parallax, with editable placeholder projects.

**Assets in `/public` (use these, don't replace them with stock):**
`models/katana.opt.glb` (the optimised one; `katana.glb` is the 49 MB source), `tassel.glb`, `blossom_branch.glb`, `autumn_tree.glb`, `leaf.glb`, `torii.glb`, `rocks/*.glb` (boulder_01, coast_rocks_01/05, coastal_cliff_04, namaqualand_boulder_02), `moon_3d/` (OBJ + 2K diffuse/bump), `textures/moon_nasa_2k.jpg` + normal, `textures/sky_panorama.png`, `textures/kloppenheim_02_puresky_2k.hdr`, `images/fog1–5.png`, `textures/torii/Concrete025_4K-PNG/*`.

The previous rebuild spec (materials, fog, water, moon, rocks, stars) still applies. This pass is about **matching the reference page exactly** and adding a **premium, heavily choreographed motion system**.

---

## 1. Main goal

The reference image is **the design of the page**, not a background. Do not use it as a background image, texture, CSS backdrop or video frame anywhere.

Rebuild that page **as a live 3D scene plus an HTML overlay** so that a screenshot at 1600×900 looks almost the same as the reference: the same composition, scale, spacing, typography, palette and atmosphere. The difference is that everything in this version moves.

The target feel is a **$10,000 award-level site** (Awwwards/FWA tier): cinematic, choreographed, smooth at 60 fps, and calm. "Heavily animated" means **every element has a considered entrance, idle life and exit**. It does not mean chaotic, bouncy or neon. Restraint is the premium signal.

---

## 2. Content and text (user decisions)

| Reference element | Use in this site |
|---|---|
| Big title "AKATSUKI" | **HARDIK GEHLOT** (same thin luxury serif, same wide tracking and size) |
| Spaced subtitle "THE SAMURAI BLADE" | **CREATIVE VIDEO EDITOR & MOTION DESIGNER** (same letter-spaced caps) |
| Body line | Keep the existing hero description from `Hero.tsx`, shortened to one line if needed to match the reference rhythm |
| "Explore the Blade →" button | **Explore My Work →**, a thin outlined rectangle exactly like the reference (replaces the hero use of `VintagePlacardButton`) |
| Small 侍 logo top-left | **Keep 侍** as the logo mark |
| Large faded red 侍 behind the title | **Keep** |
| Vertical 暁の刃 on the right with a thin line under it | **Keep** |
| Nav: The Blade · Craftsmanship · Legacy · Gallery | **Keep these exact four labels** (mapped to sections in §6) |
| "Enquire ↗" pill button | **Keep "Enquire ↗"** (scrolls to contact) |
| "Scroll to Discover" + mouse icon + chevrons | **Keep** |
| "01 / 04" counter + progress line | **Keep**, live (tracks the active section) |

Do not invent clients, awards, numbers, testimonials or project outcomes anywhere.

**Typography (match the reference):**
- Display: thin, high-contrast, wide-tracked serif. Use **Cormorant Garamond Light/Regular** or **Cinzel** at light weight, whichever matches the reference "AKATSUKI" letterforms more closely (compare side by side). Tracking about `0.12em`.
- Subtitle / labels: same serif or a clean sans in small caps, tracking about `0.55–0.65em`.
- Body / nav / buttons: **Inter** or **Manrope**, 400 weight, about 14–16 px.
- Kanji: **Noto Serif JP** (or Shippori Mincho) at a light weight.
- Self-host the fonts (woff2, `font-display: swap`, preload the display face). Update `tokens.css`.

---

## 3. Exact hero layout (measure from the reference)

All positions are percentages of a 1600×900 viewport (x from left, y from top). Build with CSS (clamp/vw/vh) for the HTML layer and `pointAtNdc()` for the 3D layer, so the layout holds at 1440×900, 1920×1080 and 2560×1440.

**HTML overlay:**
- **侍 logo**: x ≈ 11%, y ≈ 4%, about 34 px, bone white.
- **Nav links**: centered group from x ≈ 36.5% to 63.5% at y ≈ 4%, 14 px, about 60 px gaps, muted bone (`#cfcac4`).
- **Enquire ↗**: rounded pill, 1 px bone border, x ≈ 84–92%, y ≈ 2–6%.
- **Giant faded 侍**: centered near x ≈ 21%, y ≈ 34%, height ≈ 18vh, crimson at about 30% opacity, slight blur. It sits **behind** the title and overlaps it.
- **HARDIK GEHLOT**: left edge x ≈ 9%, baseline y ≈ 42%, cap height ≈ 5vh. Two words, one line on desktop (scale with `clamp()` so it never wraps above 1280 px).
- **Subtitle**: x ≈ 9%, y ≈ 47%, about 12 px, tracking about 0.6em.
- **Crimson rule**: x ≈ 9%, y ≈ 52%, 52 px × 1 px, `--crimson`.
- **Description**: x ≈ 9%, y ≈ 57.5%, about 16 px.
- **Explore My Work →**: x ≈ 9–21%, y ≈ 62.5–67.7%, 1 px bone border, square corners.
- **Vertical 暁の刃**: x ≈ 80.6%, y ≈ 24–34%, written vertically (`writing-mode: vertical-rl`), with a 1 px line below it from y ≈ 36.5% to 44%.
- **Scroll to Discover**: centered x = 50%, mouse icon y ≈ 84–87%, label y ≈ 90%, double chevron y ≈ 93.5%.
- **Counter "01 / 04"**: x ≈ 82.5%, y ≈ 91%, with a progress line x ≈ 86.5–90.5% (filled part bright, rest dim).

**3D scene (pin each element with `pointAtNdc`):**
- **Moon**: center ≈ (47.5%, 32%), radius ≈ 16% of viewport height. Dark crimson with visible maria and craters, darker toward its lower-left limb, sitting **behind and slightly left of** the sword's grip.
- **Moon ring**: thin arcs of a much larger circle, radius ≈ 30% of viewport height, centered on the moon. Exactly **three** faint segments (visible in the reference lower-left and right), drifting slowly around.
- **Katana**: diagonal. Pommel at about (54%, 9.5%), guard (tsuba) about (52%, 29%), tip about (43.5%, 84.5%), so the tip almost touches the water just left of center. The hilt wrap is black with red diamond ito, and the red tassel/cord hangs from just below the tsuba to the right (already in `KatanaTassels`).
- **Blade colour**: polished silver at the top. The lower third of the blade picks up a **crimson gradient toward the tip**, as if lit by the red moon and the water. Implement this as a restrained shader tint on the blade material (`onBeforeCompile`, a gradient along the blade's local axis that is multiplied into the specular/env response). Do **not** use emissive neon or bloom on it.
- **Water reflection**: a vertical crimson-and-silver streak under the tip, broken up by ripples. It must come from the existing live reflection in `Water.tsx`, not from a painted streak.
- **Blossom branch**: enters from the top-left corner and covers roughly x 0–35%, y 0–33%. The blossoms are crimson and pink-red, and some hang below the main limb. It must not cover the logo or the title.
- **Left rocks**: dark wet boulders x 0–24%, y 82–95%, half in water.
- **Right cliff**: a large layered rock mass rising from x ≈ 57% to the right edge, y ≈ 64–100%, with a flat slab near center-right (≈ 57–75%) and a higher cliff to the far right.
- **Torii gate**: use `torii.glb`, standing on top of the right cliff at about (89%, 58%), small and partly veiled in fog, vermilion but desaturated by the atmosphere. Check whether `Environment.tsx` already places it; if not, add it there.
- **Fog**: the heaviest band is low (y ≈ 75–92%), with wisps curling up the right cliff around the torii. It is thinner in the center so the blade tip and reflection stay readable.
- **Floating maple leaves**: only about 4–6 red leaves visible at once (reference spots: (89%, 36%), (28%, 74%), (73%, 69%), (92%, 76%)). Reuse `FallingLeaves` with `leaf.glb` and reduce the count.
- **Stars**: very few. Reuse or add instanced stars as in the previous spec.
- **Vignette**: soft, darker toward the corners, as in the reference.

**Mobile (<768 px):** stack the layout. The sword sits centered and smaller behind the text; the title wraps to two lines (HARDIK / GEHLOT); the vertical kanji, counter and branch scale down; the nav collapses into a minimal menu button that opens a full-screen overlay menu, using the same reveal language.

---

## 4. Preloader: "Fog Parting" (user choice)

The katana is heavy, so the preloader hides asset loading and becomes the opening shot.

1. **Black screen** (`#030304`). Mist (the shader fog or `fog1–5` layers) is already drifting slowly. A tiny 侍 sits in the center at about 20% opacity, with a thin percentage counter (`000 → 100`) in small tracked type below it. The counter follows real loading progress (drei `useProgress`) and is eased so it never jumps.
2. **When loading reaches 100%:** the counter and 侍 fade out (0.4 s), and the **mist parts horizontally from the center outward** (about 1.6 s, `power3.inOut`). This is a shader uniform that pushes fog density away from the screen center, not a CSS mask. As it parts, the **moon fades and brightens in** behind it.
3. Hand off directly into the hero intro (§5). There must be no cut and no flash of unstyled content.
- Do not show the preloader again on internal navigation.
- Make sure the GPU has compiled all shaders before the reveal (`gl.compile(scene, camera)` / warm-up render), so the first frames don't hitch.
- Reduced motion: a simple 0.6 s crossfade.

---

## 5. Hero intro choreography (one master GSAP timeline)

Times are relative to the end of the fog parting. Every HTML text reveal uses **masked line reveals** (SplitText lines with `overflow: hidden` wrappers, translating y 110% → 0), never plain fades.

| t (s) | Event |
|---|---|
| 0.0 | Moon reaches full presence; the ring segments fade from 0 and start drifting |
| 0.2 | **Katana rises out of the water** (existing intro): tip first, water ripples outward from the entry point, the reflection forms as it rises. Duration about 2.4 s, `expo.out`. No scaling. |
| 0.6 | Blossom branch eases in from beyond the top-left corner (a small rotation plus translate, 1.8 s) and starts its idle sway |
| 1.0 | **Giant 侍 ink reveal**: an ink-brush stroke reveal (SVG stroke-dashoffset mask or a shader noise-threshold dissolve), stroke order respected, 1.4 s |
| 1.3 | **HARDIK GEHLOT**: per-character mask reveal with a 0.035 s stagger and slight letter-spacing settle (0.2em → 0.12em), 1.2 s `expo.out` |
| 1.7 | Subtitle: characters fade up with a very wide → final tracking settle |
| 1.9 | Crimson rule draws left → right (scaleX 0 → 1, origin left) |
| 2.0 | Description line mask reveal |
| 2.2 | Button: the border draws around the rectangle (four sides in sequence), then the label and arrow fade in |
| 2.3 | Nav: logo, links (staggered 0.06 s) and Enquire pill drop in from y −12 px |
| 2.5 | Vertical 暁の刃 reveals top → bottom one character at a time, then its line draws downward |
| 2.8 | Scroll indicator, counter and progress line fade in; the mouse wheel dot starts a slow loop |
| 2.8+ | Fog, water, stars, leaves and the moon continue their idle motion forever |

Skip and compress the timeline when `prefers-reduced-motion` is on.

---

## 6. Sections, navigation and the "01 / 04" counter

Map the four reference nav labels to real sections (update `App.tsx`, `Navigation.tsx` and the section ids):

| # | Nav label | Section id | Content |
|---|---|---|---|
| 01 | **The Blade** | `#hero` | The hero above |
| 02 | **Craftsmanship** | `#craft` | NEW. What Hardik does: video editing, motion graphics, colour grading, sound design / pacing, real estate films, documentary storytelling, AI-assisted visuals. Use editable cards and copy, with short honest descriptions and no fake stats. Optionally add an editable "tools" row (Premiere Pro, After Effects, DaVinci Resolve…) for Hardik to confirm. |
| 03 | **Legacy** | `#work` | Selected Work grid (existing `SelectedWork`, upgraded in §9) |
| 04 | **Gallery** | `#gallery` | NEW. A horizontal-scroll strip of stills/frames ("frames from the edit"), pinned with ScrollTrigger and scrubbed by vertical scroll. Use editable placeholders. |
| — | **Enquire ↗** | `#contact` | Existing Contact, restyled as the finale (§8) |

- The **counter** shows the active section (`01`–`04`) and animates digit changes with a vertical roll: the old digit slides up and out while the new one slides up and in. The progress line fills according to `sceneStore.progress`.
- The active nav link gets a thin crimson underline that **slides** between links (one shared element, FLIP-animated), not separate underlines toggling on and off.
- The nav compresses on scroll (smaller padding, faint blurred dark backdrop) and hides on scroll-down / reveals on scroll-up after the hero.

---

## 7. Transition system: "mix of all" (user choice)

Three layers that work together. Each one owns different properties, so they never fight over the same transform.

### 7a. Camera journey (the base layer, scroll-scrubbed)
The 3D canvas stays fixed behind everything. Scroll drives a **camera path** stored in `sceneStore` (for example `sceneStore.cameraT`), damped in `useFrame`:
- **Hero → Craftsmanship:** the camera dollies slowly forward and down toward the water while the katana completes its scroll rotation, then **sinks into the water** (ripples and reflection break up). The moon drifts up and partially out of frame, and the fog thickens to frame the text.
- **Craftsmanship → Legacy:** the camera glides laterally along the waterline past the right cliff and torii (parallax between rocks, fog layers and the torii). The scene darkens about 30% so the cards read clearly.
- **Legacy → Gallery:** the camera tilts up toward the sky; the stars and moon ring become the backdrop.
- **Gallery → Contact (finale):** the camera returns to a framing close to the original hero, and **the katana returns** (§8).
- Use only the camera and per-object uniforms for this. No full-page CSS transforms on the canvas.
- When a section's HTML fully covers the canvas, lower the render cost (the existing `active` flag and frameloop logic) but do **not** stop the time-based idle animations when it becomes visible again.

### 7b. Blade-slash wipe (nav clicks only)
When a nav link, Enquire or the hero button is clicked:
1. A thin **diagonal crimson-silver slash line** (matching the sword angle, about −62°) streaks across the screen in about 0.35 s.
2. The screen splits along that diagonal: two halves slide apart (`clip-path` polygons on an overlay of the current view, or a full-screen shader pass), while Lenis jumps to the target underneath.
3. The halves close back onto the new section, which is already in place, and the new section's text reveals play.
4. Total ≤ 1.1 s. Normal scrolling never triggers it, and fast repeated clicks must not queue up or break it.

### 7c. Ink-bleed reveals (images and section headings)
- Every image or video thumbnail enters through an **organic ink/smoke mask**: a noise-threshold dissolve shader on a WebGL plane, or an SVG `feTurbulence` + `feDisplacementMap` mask animated with GSAP. It expands from one corner with soft, feathered, uneven edges.
- Section headings: the kanji/number label ink-reveals first, then the heading does a masked line reveal.
- Body text: line-by-line masked reveals with a 0.08 s stagger, triggered once at about 80% viewport.

---

## 8. Katana returns at the end (user choice)

- After the hero, the katana **sinks into the water** (scroll-scrubbed, with a ripple burst and the reflection breaking up). It is then hidden and costs nothing to render.
- In the **Contact / Enquire** finale it **rises out of the water again**, this time more upright and closer to center, with its spin settling to a calm rest pose. The moon is fully visible behind it, the ring segments brighten slightly, and the blossom branch drifts back into the top-left.
- Contact layout: big serif "Let's create something" (or the existing heading) on the left, contact links on the right, with the katana in the composition between them. Links get a hover with a slide-through underline and an arrow that exits right and re-enters from the left.
- Reversing the scroll reverses everything smoothly. The sword is **never scaled**.
- The existing scroll-spin spring and cursor-tilt layers stay intact; add the sink/rise as a **separate** position offset layer.

---

## 9. Legacy (Selected Work) upgrade

Keep the existing GSAP single-timeline hover architecture and upgrade it:
- Use 16:9 cards in an asymmetric editorial grid (one large featured card, then a 2-column stagger with offset vertical rhythm), not a uniform template grid.
- Each card has a big index number ("01") in thin serif, the title, the category, a year field (editable, empty for now) and an arrow.
- Use **editable placeholders only** (user has no material yet): 6 projects covering Cinematic Edit, Motion Graphics, Real Estate Film, Documentary / Story Edit, Brand / Commercial Edit, AI-assisted Visuals. Make them dark, moody generated SVG or gradient artwork consistent with the palette (the existing `renderArtwork` approach), with clear `// TODO: replace` comments for `poster`, `videoSrc` and `href`. Add a short README section explaining how to add real projects.
- **Hover** (keep the existing behaviour, refine it): image scale ≤ 1.045 inside the clip, quickTo pointer parallax, overlay fade, a "View project" indicator, a title/category shift, a crimson hairline frame drawing around the card, and a muted video preview after a 250 ms delay with a crossfade (only when `videoSrc` exists). Leave reverses with a settle and never gets stuck.
- **Scroll entrance:** ink-bleed reveal (§7c) per card, staggered, plus a very subtle per-card scroll parallax (±20 px) at different speeds per column.
- Optional **project overlay**: clicking a card opens a full-screen case view with a FLIP transition from the card's thumbnail into a hero-size media frame. Close with Esc or the close button, and the transition reverses. Build it so that it works with placeholder content.

---

## 10. Craftsmanship and Gallery details

**Craftsmanship (`#craft`):**
- Left: label "02 — Craftsmanship" with the kanji 技 ink-revealed, a heading, and a short intro paragraph (editable).
- Right: a list of disciplines as large thin-serif rows. On hover, a row slides right 8 px, a crimson index appears, and a one-line description expands with a height animation.
- Background: the 3D camera journey (fog and water at a low angle). No extra flat images.

**Gallery (`#gallery`):**
- A pinned horizontal track of 6–8 editable frames in mixed aspect ratios (16:9, 4:5, 2.39:1 "cinemascope").
- Vertical scroll scrubs the track. Each frame has a slight skew/velocity response to scroll speed (Lenis velocity, clamped and damped), plus a caption reveal.
- Show a progress hairline at the bottom of the section.

---

## 11. Micro-interactions (no custom cursor; user choice)

Keep the **normal system cursor**. Do not add a custom cursor, cursor follower or magnetic cursor. The katana's existing subtle cursor tilt stays.
- **Buttons:** on hover, the outlined button fills from left to right with a dark crimson wash behind the text, the label shifts 2 px, and the arrow slides out right and back in from the left. Press: scale 0.98. Keyboard focus: a visible 1 px crimson outline offset 4 px.
- **Nav links:** a letter-roll hover (the text duplicates and rolls up one line).
- **Enquire pill:** the border brightens and the ↗ arrow slides diagonally out and back in.
- **Scroll indicator:** the mouse wheel dot loops slowly, the chevrons pulse in sequence, and it all fades out after the first scroll.
- **Counter:** the digit roll on section change.
- **Text selection colour:** crimson at 40% with bone text.

---

## 12. Sound: none (user choice)

- Remove `AudioPlayer` (`.tsx` and `.css`) from the app and the bundle, and remove `public/audio/theme.mp3` from anything that loads it.
- Do not add any sound effects.

---

## 13. Motion language: rules for everything

- **One clock:** GSAP ticker + Lenis + R3F `useFrame`. All idle motion is time-based and keeps running when the mouse and scroll are idle.
- **Easing vocabulary:** reveals `expo.out` / `power4.out`, transitions `power3.inOut`, idle sine-based noise. No `bounce`, no `elastic`, no overshoot on text.
- **Durations:** micro 0.25–0.4 s, reveals 0.9–1.4 s, transitions 1.0–1.6 s, idle loops 6–40 s.
- **One owner per property.** Never animate the same property from two systems (GSAP vs. CSS transition vs. `useFrame`).
- No per-frame React state. Scroll and transition values go through `sceneStore` and refs.
- Reversible: every scroll-linked animation reverses cleanly.
- `prefers-reduced-motion`: keep the layout and fades, but remove the camera journey, slash wipes, parallax and skew. Idle 3D motion drops to about 15% (`ambientMotion()`).

---

## 14. Cleanup and performance (do this, it affects how premium the site feels)

- **Dead code:** check whether `CinematicPostProcessing.tsx` and `VolumetricFogPrototype.tsx` (`?prototype=fog`) are used. Remove them or merge them into `PostFX` / `GroundFog`. Don't leave two post-processing stacks.
- **Assets:**
  - The torii textures are 4K PNGs (`Concrete025_4K_*`, over 250 MB). Downscale to 1K–2K and convert to **KTX2** (or WebP/JPG for colour), then bake or assign them onto `torii.glb`.
  - Run all GLBs through `gltf-transform` (meshopt or Draco + KTX2). Make sure `katana.glb` (49 MB) is never fetched; only `katana.opt.glb` should load.
  - Convert `fog1–5.png` (≈2.6 MB each) to WebP or KTX2, or replace them with procedural noise if the shader fog already covers that look.
  - Make sure the moon textures in use are the 2K ones, and that duplicates are not all loaded.
  - Remove the unused `src/assets/react.svg`, `vite.svg` and `hero.png` if they're unreferenced.
- **Budgets:** 60 fps on a mid-range desktop GPU at 1440p, first meaningful paint under 2 s with the preloader masking the 3D load, and a JS bundle with code-split heavy sections.
- Keep adaptive quality (the existing FPS sampler) and the WebGL fallback (a static styled hero with the same typography; a still is acceptable **only** as that fallback).
- Replace the boilerplate README with project docs: how to run, how to add projects, where the scene constants live.

---

## 15. Implementation order

1. Audit: confirm the stack, list which components are actually rendered, and note what differs from the reference (send a short list before editing).
2. Assets and cleanup (§14) and fonts (§2).
3. Hero layout: HTML overlay to the measurements in §3.
4. 3D composition: moon, ring, katana pose and blade gradient, rocks, torii, branch, fog, leaves, matched to §3.
5. Preloader (§4) and the hero intro timeline (§5).
6. New sections, nav and counter (§6, §10).
7. Transition system (§7), then the katana sink/return (§8).
8. Legacy upgrade (§9) and micro-interactions (§11).
9. Reduced motion, mobile and performance pass.
10. Visual QA (§16).

---

## 16. Verification (in a real browser, not just a successful build)

- [ ] At 1600×900, take a screenshot of the hero after the intro settles and overlay `reference/hero-reference.jpg` at 50% opacity. Logo, nav, title, subtitle, rule, description, button, moon, ring, sword pommel/guard/tip, vertical kanji, rocks, torii, scroll indicator and counter should all line up to within about 2% of the viewport. List the remaining differences and fix the biggest ones.
- [ ] Re-check at 1440×900, 1920×1080 and 390×844 (mobile).
- [ ] The reference image is not used as a background or texture anywhere (`grep` for it).
- [ ] The fog-parting preloader reflects real load progress and hands off into the intro with no flash or hitch.
- [ ] The intro timeline plays in the order in §5.
- [ ] Scrolling: the katana spins with spring settle and never scales, sinks after the hero, and rises again at Contact; all of it reverses on scroll-up.
- [ ] The camera journey is smooth, with no jumps when scrolling fast or reversing.
- [ ] Nav clicks trigger the blade-slash wipe; normal scroll does not; rapid clicks don't break it.
- [ ] Ink-bleed reveals on cards and headings have soft, organic edges (no rectangles).
- [ ] The counter and the sliding nav underline track the active section.
- [ ] Card hovers enter and exit cleanly and never get stuck; placeholders are clearly marked TODO.
- [ ] The system cursor is unchanged; there is no audio anywhere.
- [ ] Fog, water, moon, sky, stars, branch and leaves keep moving while the mouse and page are idle.
- [ ] Reduced motion works, the WebGL fallback works, and keyboard navigation and focus states work.
- [ ] Performance: 60 fps desktop, no console errors, the 49 MB katana and 4K PNGs are not downloaded (check the Network tab).

Do not mark an item done unless you actually saw it working in the browser.

---

**Priorities, in order:** faithful composition → smooth, choreographed motion → coherent materials and light → performance. When in doubt, choose fewer, better-timed animations over more effects.
