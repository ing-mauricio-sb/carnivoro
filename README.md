# Carnívoro — Landing inmersiva 3D

Landing page inmersiva y cinematográfica para **Carnívoro La Hamburguesería** (Perú), con una
hamburguesa 3D procedural, fotorrealista y jugosa que reacciona al scroll: gira, se traslada,
**se despieza capa por capa** y se reensambla con un rebote elástico — todo con humo de brasa,
chispas y materiales PBR mojados.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- **React Three Fiber** + **three.js** + **@react-three/drei** + **@react-three/postprocessing**
- **GSAP** + **ScrollTrigger** + **Lenis** (scroll cinematográfico)
- **Tailwind CSS v4**

## Características

- Hamburguesa 3D **100% procedural** (cada ingrediente es su propia malla → efecto despiece garantizado).
- Materiales PBR jugosos: albedo de pan horneado, normal maps procedurales, kétchup oozing, grasa,
  translucidez en tomate/queso/lechuga, ajonjolí instanciado.
- Atmósfera: humo de brasa (billboards), chispas incandescentes (`Sparkles`), post-proceso
  (N8AO, Bloom, Depth of Field, viñeta).
- Recorrido de scroll de 4 fases sincronizado (hero → propuesta de valor → despiece → CTA).
- Secciones de conversión: menú, Reto Carnívoro, sedes, delivery y franquicias.
- Responsive, accesible (`prefers-reduced-motion`, focus states) y 60fps.

> Nota: texturas y geometría son **self-contained** (generadas por código, sin assets externos).
> Los datos marcados `[verificar]` (precios, condiciones del reto, contactos) deben confirmarse
> con el cliente antes de producción.

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # build de producción
npm run typecheck
```

## Estructura

```
src/
  app/                 # layout, page, globals.css, icon
  components/
    three/             # Burger3D, Burger, geometry, materials, textures, Lighting, Effects, Smoke
    sections/          # Nav, Hero, Valor, Despiece, CTA, Menu, Reto, Sedes, Delivery, Franquicias, Footer
    ui/                # CtaButton, Reveal, Loader
  lib/                 # scroll store, Lenis+GSAP hook, math, media queries
```
