'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { buildBurgerRig, STRATA, type StratumKey } from './model/burgerRig';
import { scroll, useUI } from '@/lib/scroll';
import { clamp, damp, elasticOut, smoothstep, subProgress } from '@/lib/math';

const BASE_Y = -0.55;
const REUNION_ANGLE = Math.PI * 0.5;
/** Per-ingredient tumble rotation (rad) applied while exploded — keeps the
 * despiece feeling like ingredients float, not like a mechanical diagram. */
const TUMBLE = [0.45, -0.7, 0.6, -0.5, 0.7, -0.45, 0.55, -0.6];

interface IngredientCopy {
  side: 1 | -1; // tooltip anchor side
  label: string;
  text: string;
}

/* TODO(Mauri): copy de marca por ingrediente — ajusta labels/textos a la carta
 * real de Carnívoro. El orden es el del stack (abajo → arriba). */
const COPY: Record<StratumKey, IngredientCopy> = {
  bottomBun: { side: -1, label: 'BASE CON AJONJOLÍ', text: 'Horneada del día, tostada a la plancha.' },
  lettuce: { side: 1, label: 'LECHUGA FRESCA', text: 'Crocante, del mercado.' },
  tomato: { side: -1, label: 'TOMATE', text: 'Dos rodajas, siempre frescas.' },
  onion: { side: 1, label: 'CEBOLLA MORADA', text: 'En aros, con su toque dulce.' },
  pickles: { side: -1, label: 'PEPINILLOS', text: 'Crocantes, en corte crinkle.' },
  patty: { side: 1, label: '100% PURA CARNE', text: 'Blend de res sellado a la parrilla. Jugoso.' },
  cheese: { side: -1, label: 'QUESO CHEDDAR', text: 'Fundido al momento sobre la carne.' },
  topBun: { side: 1, label: 'PAN ARTESANAL', text: 'Con ajonjolí y brillo de mantequilla.' },
};

export default function Burger({
  spreadScale = 1,
  motionScale = 1,
  baseScale = 1,
  tooltips = true,
  parallax = false,
}: {
  /** horizontal travel factor (smaller on mobile) */
  spreadScale?: number;
  /** 0 disables scroll motion (reduced-motion) */
  motionScale?: number;
  /** overall size factor (smaller on mobile so the burger fits portrait) */
  baseScale?: number;
  /** render per-ingredient tooltips (off on narrow screens) */
  tooltips?: boolean;
  /** subtle pointer-follow rotation during the hero phase (desktop only) */
  parallax?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const tipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const tipAnchorRefs = useRef<Array<THREE.Group | null>>([]);
  const idle = useRef(0);
  const readySet = useRef(false);
  // Tooltips only exist visually inside the despiece window (fade 0.42–0.64).
  // Mounting the <Html> nodes just around it stops drei from projecting and
  // writing 8 DOM transforms per frame during the entire rest of the scroll.
  const [tipsActive, setTipsActive] = useState(false);
  const tipsActiveRef = useRef(false);

  // img2threejs factory model + per-stratum pivots (see model/burgerRig.ts).
  const rig = useMemo(() => buildBurgerRig({ mobile: baseScale < 1 }), [baseScale]);
  // Tumble composes on top of each node's as-built rotation (onion/cheese carry
  // a baked X-rotation that lays them flat — never overwrite it).
  const baseRot = useMemo(
    () => rig.layers.map((l) => ({ x: l.node.rotation.x, y: l.node.rotation.y })),
    [rig],
  );

  useLayoutEffect(() => {
    return () => rig.dispose();
  }, [rig]);

  useFrame((state, dtRaw) => {
    const group = groupRef.current;
    if (!group) return;
    if (!readySet.current) {
      readySet.current = true;
      useUI.getState().setReady(true);
    }
    const dt = Math.min(dtRaw, 1 / 30); // stabilise damp on frame drops
    const t = state.clock.elapsedTime;
    const p = motionScale === 0 ? snapProgress(scroll.progress) : scroll.progress;

    if (tooltips) {
      const inWindow = p >= 0.38 && p <= 0.66;
      if (inWindow !== tipsActiveRef.current) {
        tipsActiveRef.current = inWindow;
        setTipsActive(inWindow);
      }
    }

    const vp = subProgress(p, 0.2, 0.4);
    const dp = subProgress(p, 0.4, 0.65);
    const rp = subProgress(p, 0.65, 0.85);
    const GROUP_RIGHT = 2.2 * spreadScale;
    const GROUP_LEFT = -1.7 * spreadScale;

    // group X — centre quickly at the start of despiece so the exploded view
    // (and its side tooltips) sit centred for most of the phase.
    let targetX = 0;
    if (p < 0.2) targetX = 0;
    else if (p < 0.4) targetX = THREE.MathUtils.lerp(0, GROUP_RIGHT, smoothstep(vp));
    else if (p < 0.65) targetX = THREE.MathUtils.lerp(GROUP_RIGHT, 0, smoothstep(clamp(dp / 0.35)));
    else targetX = THREE.MathUtils.lerp(0, GROUP_LEFT, smoothstep(rp));

    // group scale
    let targetScale = 1;
    if (p < 0.2) targetScale = 1;
    else if (p < 0.4) targetScale = THREE.MathUtils.lerp(1, 0.82, smoothstep(vp));
    else if (p < 0.65) targetScale = THREE.MathUtils.lerp(0.82, 0.8, smoothstep(dp));
    else targetScale = 0.9;

    const lambda = motionScale === 0 ? 1000 : 6;
    group.position.x = damp(group.position.x, targetX, lambda, dt);
    const bob = p < 0.2 && motionScale > 0 ? Math.sin(t * 0.6) * 0.03 : 0;
    group.position.y = damp(group.position.y, BASE_Y + bob, 5, dt);
    const s = damp(group.scale.x, targetScale * baseScale, lambda, dt);
    // Landing squash: the reassembly elastic overshoots, so squeeze the whole
    // burger vertically (and bulge horizontally) while it settles — juicy snap.
    let squashY = 1;
    let squashXZ = 1;
    if (motionScale > 0 && p >= 0.65) {
      const over = clamp(elasticOut(clamp((rp - 0.2) / 0.82)) - 1, -0.12, 0.3);
      squashY = 1 - over * 0.16;
      squashXZ = 1 + over * 0.08;
    }
    group.scale.set(s * squashXZ, s * squashY, s * squashXZ);

    // pointer parallax, hero only (fades out before the valor slide)
    const heroW = parallax && motionScale > 0 ? 1 - smoothstep(subProgress(p, 0.12, 0.22)) : 0;
    const parY = state.pointer.x * 0.12 * heroW;
    const parX = -state.pointer.y * 0.06 * heroW;

    // rotation — spin while whole (hero/valor), face forward to read the layers
    // during despiece (so tooltips stay put), then a deliberate 90° turn for the CTA.
    const TAU = Math.PI * 2;
    const face = Math.round(idle.current / TAU) * TAU;
    if (p < 0.4) {
      if (motionScale > 0) idle.current += dt * 0.28;
      group.rotation.y = damp(group.rotation.y, idle.current + parY, 6, dt);
    } else if (p < 0.66) {
      group.rotation.y = damp(group.rotation.y, face, 4, dt);
    } else {
      group.rotation.y = damp(group.rotation.y, face + REUNION_ANGLE, 3.2, dt);
    }
    group.rotation.z = damp(group.rotation.z, p >= 0.66 ? -0.12 : 0, 3, dt);
    const tiltTarget = (p >= 0.4 && p < 0.66 ? 0.16 : 0.03) + parX;
    group.rotation.x = damp(group.rotation.x, tiltTarget, 3, dt);

    // ingredients spread (+ slow tumble while separated → they float, naturally)
    const n = rig.layers.length;
    for (let i = 0; i < n; i++) {
      const layer = rig.layers[i];
      let spread: number;
      if (p < 0.4) {
        spread = 0;
      } else if (p < 0.65) {
        const local = clamp((dp - i * 0.04) / 0.72);
        spread = smoothstep(local);
      } else {
        const local = clamp((rp - (n - 1 - i) * 0.04) / 0.82);
        spread = 1 - elasticOut(local);
      }
      const osc = motionScale > 0 ? Math.sin(t * 1.4 + i * 0.7) * 0.04 * clamp(spread) : 0;
      const targetY = THREE.MathUtils.lerp(layer.assembledY, layer.explodedY, spread) + osc;
      layer.node.position.y = damp(layer.node.position.y, targetY, 8, dt);
      layer.node.rotation.y = damp(
        layer.node.rotation.y,
        baseRot[i].y + spread * TUMBLE[i],
        3,
        dt,
      );
      const wob = motionScale > 0 ? Math.sin(t * 0.9 + i * 1.3) * 0.06 * clamp(spread) : 0;
      layer.node.rotation.x = damp(layer.node.rotation.x, baseRot[i].x + wob, 4, dt);
      // tooltip anchors ride their stratum (siblings of the imperative model,
      // so tumble never orbits the DOM label)
      const anchor = tipAnchorRefs.current[i];
      if (anchor) anchor.position.y = layer.node.position.y;
    }

    // tooltip visibility (fully gone before the 90° turn at 0.66)
    const fadeIn = smoothstep(subProgress(p, 0.42, 0.48));
    const fadeOut = 1 - smoothstep(subProgress(p, 0.58, 0.64));
    const baseVis = p >= 0.4 && p <= 0.64 ? fadeIn * fadeOut : 0;
    for (let i = 0; i < tipRefs.current.length; i++) {
      const el = tipRefs.current[i];
      if (!el) continue;
      const reveal = clamp((dp - i * 0.04) / 0.4);
      const o = baseVis * smoothstep(reveal);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${(1 - o) * 8}px)`;
      el.style.pointerEvents = 'none';
    }
  });

  return (
    <group ref={groupRef} position={[0, BASE_Y, 0]} scale={1}>
      <primitive object={rig.model} />
      {tooltips &&
        tipsActive &&
        rig.layers.map((layer, i) => {
          const copy = COPY[layer.key];
          return (
            <group
              key={layer.key}
              ref={(el) => {
                tipAnchorRefs.current[i] = el;
              }}
              position={[0, layer.assembledY, 0]}
            >
              <Html
                position={[copy.side * 2.2, 0, 0.15]}
                center
                distanceFactor={undefined}
                zIndexRange={[40, 30]}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  ref={(el) => {
                    tipRefs.current[i] = el;
                  }}
                  style={{ opacity: 0 }}
                  className={`w-max max-w-[15rem] select-none rounded-xl border border-surface2 bg-surface/85 px-4 py-2 backdrop-blur-md ${
                    copy.side === 1 ? 'text-left' : 'text-right'
                  }`}
                >
                  <p className="eyebrow mb-0.5">{copy.label}</p>
                  <p className="text-sm leading-snug text-bone">{copy.text}</p>
                </div>
              </Html>
            </group>
          );
        })}
    </group>
  );
}

/** Reduced-motion: snap to the nearest phase's resting state instead of scrubbing. */
function snapProgress(p: number): number {
  if (p < 0.2) return 0.1;
  if (p < 0.4) return 0.3;
  if (p < 0.65) return 0.52;
  if (p < 0.85) return 0.75;
  return 0.92;
}

export type { StratumKey };
export { STRATA };
