# CARNÍVORO — Immersive scroll-driven 3D burger landing

> Build prompt for Claude Code. The technical spec is in English for maximum reproducibility;
> every user-facing string is Spanish (verbatim). Values marked `[verificar]` should be confirmed
> with the client before launch. Paste this whole file into your coding agent (or into `spec.md`).

## Role
You are a **senior front-end engineer** expert in **Next.js 15 (App Router), React Three Fiber,
Three.js, GSAP/ScrollTrigger and premium motion design**. You ship award-winning, 60fps, Awwwards-grade
interfaces. Follow this spec to the letter — no improvised colors, fonts, geometry or layout, no
"sample from the statistical center" defaults. When a value is given, use it exactly.

## Context
- **What & who**: *Carnívoro La Hamburguesería* — a real Peruvian artisanal burger chain (+20 locales,
  franchise model). Audience: Peruvian families and young adults (segments B/C), foodies, gamers.
- **Goal of the page**: one immersive landing that (1) makes people crave the burger and (2) converts
  to **delivery orders** and **franchise leads**. Selling + showcase.
- **Where it lives**: a standalone **Next.js 15 App Router** app (TypeScript, Tailwind CSS v4).
- **Brand truths to honor**: tagline **"La mejor hamburguesa 100% pura carne"**; artisanal/homemade
  ("artesanal, casero"); generous portions; the viral **"Reto Carnívoro"**; pairs with Inca Kola;
  IG **@carnivorolh**. Voice: bold, carnivore, cheeky, Peruvian, confident — never corporate.

## Task
Build a **single immersive one-page landing** for Carnívoro. The centerpiece is a **procedurally-built,
photoreal-styled 3D burger** (built from Three.js primitives — every ingredient is its own mesh) that
is **driven by scroll**: it idles, translates, **explodes into its ingredients (despiece)**, and
**reassembles with an elastic snap**. Aesthetic direction: **Dark "Carne & Brasa"** — charcoal-black
stage, meat-red and incandescent-ember accents, one massive industrial display type; cinematic,
appetizing, premium. The signature interaction is the **scroll-scrubbed exploded-view burger with
per-ingredient tooltips**. Match every detail below exactly.

---

## Constraints — Global design system

### Fonts
Add to `src/app/globals.css` (top), and expose as Tailwind v4 tokens:
```css
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@500;700;800;900&family=Space+Grotesk:wght@400;500;700&display=swap');
:root {
  --font-display: 'Big Shoulders Display', system-ui, sans-serif; /* massive industrial headlines, uppercase */
  --font-body: 'Space Grotesk', system-ui, sans-serif;           /* UI, body, prices */
}
```
- Display (`Big Shoulders Display`, 800/900, UPPERCASE, tracking `-0.01em`): all hero words + section titles.
- Body (`Space Grotesk`): everything else. Prices/numbers use `font-body` 700 with `tabular-nums`.
- Do **not** introduce any other font. Do not fall back to Inter/Roboto for display.

### Color tokens (every color used must be one of these — no strays)
Define in `globals.css` via Tailwind v4 `@theme`:
```css
@theme {
  --color-bg:      #0C0A09; /* charcoal stage / page background */
  --color-surface: #17120F; /* warm coal — cards, panels */
  --color-surface2:#231A15; /* raised coal — hover, borders */
  --color-meat:    #C0271F; /* primary brand red (beef) */
  --color-sear:    #7A1410; /* dark seared red — depth, shadows */
  --color-ember:   #FF6A1A; /* incandescent grill orange — accent, CTAs, glow */
  --color-cheese:  #F2A83B; /* warm gold highlight (sparingly) */
  --color-bone:    #F6F1E7; /* primary text / cream on dark */
  --color-ash:     #9A8E83; /* secondary/muted warm gray text */
}
```
Contrast rules: body text `--color-bone` on `--color-bg`/`--color-surface`. Secondary text `--color-ash`.
Ember is for glow, focus rings, and primary CTAs only. Keep AA contrast (≥4.5:1 for body).

### Type scale (fluid)
- Hero mega-word: `clamp(4rem, 17vw, 19rem)`, line-height 0.86, `font-display` 900.
- Section title: `clamp(2.5rem, 7vw, 6rem)`, line-height 0.92, `font-display` 800, UPPERCASE.
- Lead/subhead: `clamp(1.05rem, 2.2vw, 1.5rem)`, `font-body` 500.
- Body: `clamp(0.95rem, 1.4vw, 1.075rem)`, `font-body` 400, `--color-ash`.
- Eyebrow/label: `0.8rem`, uppercase, tracking `0.22em`, `--color-ember`.

### Motion defaults
- UI reveals easing: `cubic-bezier(0.16, 1, 0.3, 1)`, duration `0.9s`.
- 3D scroll: GSAP **scrub `1.2`** (never instant) so the burger lerps and never snaps on fast scroll.
- Reassembly bounce easing: `elastic.out(1, 0.45)` (emulate in scrub via an elastic easing on sub-progress).
- Global smooth scroll via **Lenis** (`duration: 1.15`), wired to GSAP ticker.

### Root wrapper & meta
- `<html lang="es">`. Page `<title>`: **"Carnívoro — La mejor hamburguesa 100% pura carne"**.
- `<meta name="description">`: **"Hamburguesas artesanales 100% pura carne. +20 sedes en el Perú. Pide delivery o vive el Reto Carnívoro."**
- Body wrapper: `bg-[--color-bg] text-[--color-bone] font-body antialiased overflow-x-hidden selection:bg-[--color-ember] selection:text-[--color-bg]`.
- `<canvas>` for the 3D scene is decorative → `aria-hidden="true"`; all meaningful copy lives in real DOM for SEO/screen readers.

---

## Assets
- **No external 3D model.** The burger is **built in code** from Three.js primitives (spec below).
- **Optional realism textures** (CC0, only if easy to wire; otherwise use tuned material params as the
  guaranteed baseline): bread/bun albedo+normal+roughness and charred-meat normal from
  **ambientCG** (`https://ambientcg.com`) or **Poly Haven** (`https://polyhaven.com/textures`). Load via
  drei `useTexture` with graceful fallback if a fetch fails. Never block first paint on them.
- **Environment HDRI**: use drei `<Environment preset="warehouse" />` (or a warm studio HDRI) for
  realistic reflections on cheese/bun/patty. Keep environment intensity moderate so the dark stage stays dark.
- Logos/photos for menu/sedes: **placeholder** blocks with the exact copy below; mark
  `/* replace with client asset */`. Do not fetch random stock burgers.

---

## Section order
1. Hero  2. Propuesta de valor  3. **Despiece (exploded view)**  4. Reassembly + CTA cinematográfico
5. Menú destacado  6. Reto Carnívoro  7. Sedes  8. Delivery / Pídelo ya  9. Franquicias  10. Footer

**Layout model:** sections **1–4** are the *cinematic stage*: a single `<Canvas>` is
`position: fixed; inset: 0; z-index: 0` (the 3D burger), and the HTML for sections 1–4 scrolls **over**
it inside a **tall wrapper of `height: 500vh`** (`pointer-events-none`, except buttons which get
`pointer-events-auto`). Sections **5–10** are normal document flow on solid `--color-bg` (so the fixed
canvas does not bleed through) at `z-index: 10`.

---

## Signature system — Procedural 3D burger (THE STAR — build with maximum fidelity)

### 5.1 Scene setup (`<Canvas>`, client component)
- App Router: put the Canvas in a **`'use client'`** component and load it with
  `dynamic(() => import('./Burger3D'), { ssr: false })`.
- `<Canvas dpr={[1, 2]} shadows gl={{ antialias: true, powerPreference: 'high-performance' }}
  camera={{ fov: 35, position: [0, 0.35, 7] }}>` with `gl.toneMapping = ACESFilmicToneMapping`,
  `toneMappingExposure ≈ 1.05`, `outputColorSpace = SRGB`.
- Clamp `dpr` to `[1, 1.5]` on mobile via `useMediaQuery`.

### 5.2 Geometry — six independent ingredient meshes (bottom → top)
Build a `<group ref={burgerRef}>` centered at origin. Each ingredient is a **named, independent mesh**
so it can animate alone. Baseline **assembled** center-Y per mesh, and **exploded** target-Y:

| # | mesh name    | geometry (guaranteed baseline)                                                                 | assembled Y | exploded Y | material (MeshPhysicalMaterial) |
|---|--------------|------------------------------------------------------------------------------------------------|-------------|------------|---------------------------------|
| 1 | `bottomBun`  | `LatheGeometry` from a rounded profile (flat top, domed bottom), R≈1.3, H≈0.5, 64 segs          | `0.00`      | `-0.95`    | brioche `#C98A4B`, roughness 0.72, clearcoat 0.12, sheen 0.3 |
| 2 | `patty`      | `CylinderGeometry(1.28, 1.28, 0.30, 96)`, displace rim vertices ±0.04 (low-freq noise) for irregular grilled edge; bevel top/bottom | `0.42` | `-0.30` | seared beef `#4A2418`, roughness 0.88, normalScale 1.0 (char), clearcoat 0 |
| 3 | `cheese`     | `BoxGeometry(1.9, 0.05, 1.9)` rotated 45° (diamond over round patty; corners drip past edge)     | `0.60`      | `0.15`     | cheddar `#F2A83B`, roughness 0.32, clearcoat 0.45, transmission 0.05 (glossy melt) |
| 4 | `tomato`     | `CylinderGeometry(1.05, 1.05, 0.14, 48)`, darker emissive rim                                   | `0.72`      | `0.60`     | `#C0392B`, roughness 0.28, transmission 0.22 (juicy translucency) |
| 5 | `lettuce`    | ruffled ring: annulus/`LatheGeometry` with sinusoidal radial displacement (frill), R≈1.45, ±0.12 height, double-sided | `0.86` | `1.05` | fresh green `#4E8B3A`, roughness 0.68, transmission 0.12, `side: DoubleSide` |
| 6 | `topBun`     | domed `SphereGeometry(1.3, 64, 48, 0, TAU, 0, PI/2)` scaled `(1, 0.7, 1)` + **`InstancedMesh` of ~40 sesame seeds** (`SphereGeometry(0.035)` scaled `(1,0.5,1)`, `#F0E2C0`) placed on the dome, parented to the bun | `1.35` | `1.80` | brioche `#C98A4B`, roughness 0.72, clearcoat 0.12, sheen 0.3 |

Notes:
- Compute sesame positions on the hemisphere (spherical → cartesian), skip the lowest band; seeds move with the bun.
- If CC0 textures are wired: apply bread normal/roughness to buns, char normal to patty; else the tuned
  params above are the final look. Keep polycount reasonable (buns ≤ 64 segs) for 60fps.

### 5.3 Lighting rig (cinematic, warm)
- `<Environment preset="warehouse" />` for reflections (moderate intensity).
- **Key**: `SpotLight` warm ember `#FF8A3D`, intensity high, position `[4, 6, 5]`, angle `0.5`,
  penumbra `0.85`, `castShadow`, `shadow-mapSize {2048,2048}`, bias `-0.0005`.
- **Rim/back**: light behind the burger in deep red `#C0271F`, low intensity, to separate it from the
  charcoal background.
- **Fill**: soft `hemisphereLight` (sky `#3a2a20`, ground `#0c0a09`) low intensity to lift shadows.
- **Ground**: drei `<ContactShadows position={[0,-1.15,0]} blur={2.6} opacity={0.55} scale={9} />`
  (or `<AccumulativeShadows>` for extra realism) to anchor the burger.

### 5.4 Postprocessing (`@react-three/postprocessing`) — cinematic realism
Compose `<EffectComposer>` (disable/reduce heavy passes on mobile via `matchMedia`):
- **N8AO** (or `SSAO`) — deep ambient occlusion between ingredient layers (critical for realism/contact).
- **Bloom** — `luminanceThreshold ≈ 0.72`, `intensity ≈ 0.6`, `mipmapBlur` → ember/highlight glow.
- **DepthOfField** — focus on the burger, gentle background blur (`focusDistance` tuned, `bokehScale ≈ 2`); **desktop only**.
- **Vignette** — `darkness ≈ 0.6` to focus the center.
- **SMAA** antialiasing; very subtle `Noise` (film grain, opacity ≤ 0.04) + micro `ChromaticAberration` (≤ 0.0008).

### 5.5 The scroll bridge (GSAP ScrollTrigger ↔ R3F) — reproducible algorithm
Goal: the tall DOM wrapper drives a single normalized progress; R3F reads it every frame and **lerps**
toward targets (so fast scrolling never snaps). Wire the Awwwards stack:
```js
// once, on mount (client)
import Lenis from 'lenis';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
gsap.registerPlugin(ScrollTrigger);
const lenis = new Lenis({ duration: 1.15 });
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((t) => lenis.raf(t * 1000));
gsap.ticker.lagSmoothing(0);
```
- Shared state: a module-scope `const scroll = { p: 0 }` (or a tiny zustand store / a ref via context).
- One ScrollTrigger on the `500vh` wrapper: `{ start:'top top', end:'bottom bottom', scrub:1.2,
  onUpdate: self => { scroll.p = self.progress } }`.
- In `useFrame((state, dt) => { ... })` inside the Canvas, read `scroll.p` and drive the burger. Map the
  4 cinematic beats onto sub-ranges of `p`:

| phase | `p` range | burger group | ingredients | DOM |
|-------|-----------|--------------|-------------|-----|
| Hero        | `0.00–0.20` | pos→`(0,0,0)`, scale→`1.0`; **idle** `rotY += dt*0.25`; gentle bob `y = sin(t*0.6)*0.03` | assembled (§5.2 assembled Y) | hero copy |
| Valor       | `0.20–0.40` | pos.x lerp→`+2.2`, scale lerp→`0.82`, slow rotY continues | assembled | value cards slide in from left |
| **Despiece**| `0.40–0.65` | pos.x lerp→`0`, scale `0.9` | each mesh Y lerps assembled→exploded (§5.2), **staggered** by index using sub-progress; add per-frame oscillation `+= sin(t*1.4 + i*0.7)*0.035` | tooltips fade in (§5.6) |
| Reunión+CTA | `0.65–0.85` | rotY lerp→`+PI/2` (turn 90°), pos.x lerp→`-1.6` | Y lerps exploded→assembled with **elastic overshoot** (apply `elasticOut` to the local sub-progress) | giant CTA appears right |
| Settle      | `0.85–1.00` | hold pose | assembled | CTA locked, fade toward section 5 |

- Lerp helper: `v += (target - v) * min(1, dt * 6)` (frame-rate independent). Apply to position, scale, rotation, and each ingredient Y.
- Cleanup on unmount: `ScrollTrigger.getAll().forEach(t=>t.kill())`, remove Lenis + gsap ticker fn.

### 5.6 Tooltips (per-ingredient, only during Despiece)
Use drei **`<Html>`** attached to each ingredient mesh (auto-anchors to its 3D position, no manual
projection). Card style: `bg-[--color-surface]/85 backdrop-blur-md border border-[--color-surface2]
rounded-xl px-4 py-2 text-sm` with a thin ember leader line; `--color-ember` eyebrow label + `--color-bone` text.
Fade/scale in as phase enters `0.40`, out at `0.65`. Copy (verbatim, Spanish):
- `topBun`  → label **"PAN BRIOCHE"** · "Horneado del día, con ajonjolí."
- `lettuce` → label **"LECHUGA"** · "Fresca y crocante, del mercado."
- `tomato`  → label **"TOMATE"** · "En rodajas, siempre fresco."
- `cheese`  → label **"QUESO EDAM"** · "Fundido al momento sobre la carne."
- `patty`   → label **"100% PURA CARNE"** · "Blend de res sellado a la parrilla. Jugoso."
- `bottomBun`→ label **"BASE BRIOCHE"** · "Aguanta todo el jugo sin rendirse."

---

## Section copy & layout (verbatim Spanish copy)

### Section 1 — Hero  (`h-screen`, `100dvh`, content `z-10 pointer-events-none`)
- Layers by z: `z-0` fixed Canvas (burger, centered) · `z-10` giant type behind/around burger · `z-20` nav.
- **Nav** (`fixed top-0`, `pointer-events-auto`): left wordmark **"CARNÍVORO"** (`font-display` 900,
  tracking tight, `--color-bone`); right links "Menú · Sedes · Reto · Franquicias" + ember pill button
  **"Pide delivery"**.
- **Eyebrow**: "LA HAMBURGUESERÍA ARTESANAL DEL PERÚ" (`--color-ember`).
- **Mega-word** (behind the burger, split so burger overlaps): **"100% CARNE"** — hero scale, `font-display`
  900, `--color-bone`, one word `--color-meat`. (Optionally kinetic char reveal on load.)
- **Sub**: "La mejor hamburguesa 100% pura carne. Artesanal, casera y sin miedo."
- **CTA** (`pointer-events-auto`): primary **"Pídela ahora"** (bg `--color-ember`, text `--color-bg`,
  hover lift + glow) · ghost **"Ver el menú"** (border `--color-surface2`).
- **Scroll cue**: small "Baja y arma tu Carnívoro ↓" bottom-center, `--color-ash`, subtle bob.
- Entrance: blur-rise on eyebrow→word→sub→CTA, staggered `animationDelay` 0.15/0.3/0.45/0.6s.

### Section 2 — Propuesta de valor  (burger has moved right; content column on left, `max-w-xl`)
- Title: **"NO ES FAST FOOD. ES CARNE DE VERDAD."**
- Three value cards (`bg-[--color-surface] border-[--color-surface2] rounded-2xl`), slide in from left, staggered:
  1. **"100% PURA CARNE"** — "Blend de res molido en casa, todos los días. Cero relleno, cero procesados."
  2. **"ARTESANAL & CASERO"** — "Recetas propias, pan brioche del día y salsas de la casa."
  3. **"PORCIONES SIN MIEDO"** — "De la Clásica al Triple. Aquí se viene con hambre de verdad."
- Footnote stat row: "+20 sedes" · "10+ años" · "Marida con Inca Kola 🥤".

### Section 3 — Despiece  (burger centered & exploding; §5.6 tooltips)
- Title top-center, small: **"MÍRALA POR DENTRO"** eyebrow + **"CAPA POR CAPA, TODO FRESCO"**.
- All ingredient info comes from the floating tooltips (§5.6). Keep DOM minimal here so the 3D reads.

### Section 4 — Reassembly + CTA cinematográfico  (burger snaps back, rotates 90°, moves left)
- Right-side giant CTA: **"PIDE LA TUYA AHORA"** (`font-display` 900) + sub "Delivery en minutos a toda Lima."
- Buttons (`pointer-events-auto`): **"Rappi"** · **"DiDi Food"** · **"PedidosYa"** · WhatsApp
  **"Pedir por WhatsApp"** (each a pill; ember primary on the first).

--- (end of cinematic stage; sections below are normal flow on `--color-bg`, `z-10`) ---

### Section 5 — Menú destacado  (real items + real prices, `tabular-nums`)
- Title: **"LA MANADA"** eyebrow "EL MENÚ" · Cards grid (responsive `grid` 1/2/3 cols).
- Real items (draft prices in S/, mark `[verificar precios]`):
  - **Carnívoro Clásica** — S/ 24 · "El origen. 100% carne, queso, la salsa de la casa."
  - **Royal** — S/ 29 · "Doble carne, doble antojo."
  - **Cheese Bacon** — S/ 29 · "Tocino crocante + queso fundido."
  - **Tejana Doble** — S/ 39 · "Para los que no se rinden."
  - **Carnívoro Triple** — S/ 43 · "Tres pisos de pura carne."
  - **Cheesy Onion Jack Daniels** — S/ 36 · "Aros de cebolla + salsa Jack Daniels."
  - **Salchicárnivoro XL** (salchipapa) — S/ 42 · "Para compartir… o no."
  - **Alitas BBQ** — S/ 29 · "Bañadas en BBQ de la casa."
- Card style: `--color-surface` panel, ember price, hover raises + ember border glow. CTA "Ver carta completa".

### Section 6 — Reto Carnívoro  (full-bleed band, `--color-sear`→`--color-bg` gradient)
- Eyebrow "EL DESAFÍO" · Title **"¿TE LA BANCAS?"** · Copy: "El Reto Carnívoro te espera: una torre de
  carne contra el reloj. Termínala y la casa invita. [verificar condiciones]" · CTA **"Acepto el reto"**.
- Optional scroll-linked marquee "RETO CARNÍVORO · RETO CARNÍVORO ·" in outline `font-display`.

### Section 7 — Sedes  (`+20 sedes`)
- Title **"+20 SEDES EN EL PERÚ"** · sub "Y seguimos creciendo." · Chip grid of districts (`--color-surface`
  pills, ember on hover): Barranco · Chorrillos · San Miguel · Los Olivos · Surco · Surquillo · La Molina ·
  La Victoria · Punta Hermosa · … + "Provincias: Trujillo, Piura, Chiclayo, Arequipa, Cusco, Iquitos [verificar]".
- CTA "Encuentra tu sede más cercana" (link to maps / `/locales`).

### Section 8 — Delivery / Pídelo ya
- Title **"PÍDELO YA"** · four brand buttons: **Rappi · DiDi Food · PedidosYa · WhatsApp** (large pills,
  `--color-surface` with ember hover; WhatsApp uses its green on hover). Horario chip: "Todos los días, 12 p.m.–11 p.m.".

### Section 9 — Franquicias
- `--color-surface` panel · eyebrow "OPORTUNIDAD" · Title **"ÚNETE A LA MANADA"** · Copy: "Carnívoro es
  una marca probada con +20 locales. Abre tu franquicia y lleva la mejor hamburguesa a tu ciudad." · CTA
  **"Quiero mi franquicia"** (ember) → simple form or mailto `[verificar contacto]`.

### Section 10 — Footer
- Wordmark **"CARNÍVORO"** big outline · tagline "La mejor hamburguesa 100% pura carne." · IG
  **@carnivorolh** + social icons · horario · "Hecho con 🔥 en el Perú" · legal line. Dark `--color-bg`.

---

## Reusable components (fully specced)
- **`<Burger3D>`** (`'use client'`, dynamic `ssr:false`): the Canvas + scene per §5.
- **`<Ingredient>`**: props `{ name, geometry, materialProps, assembledY, explodedY, index }`; owns its
  lerp + oscillation; exposes ref to parent group.
- **`<Tooltip3D>`**: drei `<Html>` wrapper per §5.6 (label, text, visible flag).
- **`<CtaButton variant="primary|ghost|pill">`**: `rounded-full px-6 py-3 font-body 700`; primary
  `bg-[--color-ember] text-[--color-bg]` with `hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(255,106,26,0.5)]`
  transition `0.3s`; visible `focus-visible:ring-2 ring-[--color-ember] ring-offset-2 ring-offset-[--color-bg]`.
- **`<Reveal>`**: wrapper doing blur-rise on view (Framer `whileInView` or GSAP), respects reduced-motion.
- **`<Loader>`**: Suspense fallback — full-screen `--color-bg`, centered wordmark, thin ember progress bar
  fed by drei `useProgress()`, "%" counter, microcopy **"Encendiendo la parrilla… "**; unmount at 100% + first frame. Use `<Preload all />`.

## Responsiveness
- Breakpoints: Tailwind sm 640 / md 768 / lg 1024, mobile-first. Use `100dvh` (no mobile-chrome clip).
- **Mobile (<768px)**: `dpr [1,1.5]`; drop `DepthOfField` + reduce `N8AO`; simpler lighting (key + fill only);
  value cards stack full-width; menu grid → 1 col; tooltips reposition to avoid off-screen; nav collapses to
  a menu button. Consider a **lighter exploded** (smaller spread) so it fits portrait.
- Use `gsap.matchMedia()` to branch desktop/mobile timelines; fluid `clamp()` typography throughout.

## Accessibility & performance
- **`prefers-reduced-motion: reduce`**: disable Lenis smoothing + scrub scrubbing (snap the burger to each
  phase's end-state instead of scrubbing), stop idle rotation/oscillation, disable bloom/DoF, and show all
  content statically. Never trap content behind motion.
- Visible `focus-visible` ember ring on every interactive element; logical heading order (`h1` hero, `h2` per section).
- `canvas` is `aria-hidden`; equivalent text exists in DOM. Buttons are real `<button>`/`<a>`.
- 60fps target: clamp dpr, `powerPreference:'high-performance'`, dispose geometries/materials on unmount,
  passive listeners, `willChange:transform` on frequently animated DOM. Lazy-mount the Canvas (`ssr:false`).

## Dependencies (exact)
```
next@^15  react@^19  react-dom@^19  three@^0.171
@react-three/fiber@^9  @react-three/drei@^9  @react-three/postprocessing@^3
gsap@^3.13  lenis@^1.1  tailwindcss@^4  typescript@^5
```
App Router notes: any file using R3F/GSAP is `'use client'`; import the Canvas via
`next/dynamic` with `{ ssr:false }`; register `ScrollTrigger` once on the client.

## Format & acceptance criteria (build is "done" only when ALL pass)
- [ ] Fonts load; `Big Shoulders Display` on all headings, `Space Grotesk` on body/prices. No Inter fallback.
- [ ] Every color equals a defined token; charcoal stage + ember accents; no stray grays/blues.
- [ ] The burger is **6 independent meshes**; the **Despiece** cleanly separates them with tooltips, then
      **reassembles with an elastic snap** — verifiable by scrubbing.
- [ ] Burger reacts to scroll via GSAP ScrollTrigger (scrub 1.2) + Lenis, **lerped** (fast scroll → smooth catch-up, no snapping).
- [ ] Idle rotation in the hero; 90° rotation before the final CTA.
- [ ] PBR materials + HDRI env + contact shadows + N8AO/Bloom render an appetizing, realistic burger at 60fps desktop.
- [ ] Loader shows real progress; no white flash before the scene is ready.
- [ ] Real menu items/prices, +20 sedes, Reto Carnívoro, delivery buttons, and franquicias sections present with the copy above.
- [ ] Layout holds with no horizontal overflow at 375px, 768px, 1440px.
- [ ] `prefers-reduced-motion` disables scrub/idle/heavy effects and shows all content statically.
- [ ] Keyboard focus visible (ember ring) on every interactive element.

Match every detail above exactly.
