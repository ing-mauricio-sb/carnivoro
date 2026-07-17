'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  makeBottomBun,
  makeTopBun,
  makePatty,
  makeCheese,
  makeTomato,
  makeLettuce,
  makeLettuceInner,
  sesameSeeds,
  makeSauceRing,
  greaseDrops,
} from './geometry';
import { useBurgerMaterials } from './materials';
import { scroll, useUI } from '@/lib/scroll';
import { clamp, damp, elasticOut, smoothstep, subProgress } from '@/lib/math';

const BASE_Y = -0.55;
const REUNION_ANGLE = Math.PI * 0.5;
/** Per-ingredient tumble rotation (rad) applied while exploded — keeps the
 * despiece feeling like ingredients float, not like a mechanical diagram. */
const TUMBLE = [0.45, -0.7, 0.6, -0.45, 0.75, -0.55];
/** Toasted sesame tones, picked per instance. */
const SEED_TONES = ['#f4e3b8', '#e0bd7f', '#c89a58'].map((c) => new THREE.Color(c));

interface IngredientDef {
  key: string;
  assembledY: number;
  explodedY: number;
  side: 1 | -1; // tooltip anchor side
  label: string;
  text: string;
}

// bottom → top. assembledY values stack snugly; explodedY spreads them apart.
const INGREDIENTS: IngredientDef[] = [
  { key: 'bottomBun', assembledY: 0.0, explodedY: -1.15, side: -1, label: 'BASE BRIOCHE', text: 'Aguanta todo el jugo sin rendirse.' },
  { key: 'patty', assembledY: 0.36, explodedY: -0.45, side: 1, label: '100% PURA CARNE', text: 'Blend de res sellado a la parrilla. Jugoso.' },
  { key: 'cheese', assembledY: 0.55, explodedY: 0.1, side: -1, label: 'QUESO EDAM', text: 'Fundido al momento sobre la carne.' },
  { key: 'tomato', assembledY: 0.66, explodedY: 0.6, side: 1, label: 'TOMATE', text: 'En rodajas, siempre fresco.' },
  { key: 'lettuce', assembledY: 0.78, explodedY: 1.12, side: -1, label: 'LECHUGA', text: 'Fresca y crocante, del mercado.' },
  { key: 'topBun', assembledY: 0.9, explodedY: 1.75, side: 1, label: 'PAN BRIOCHE', text: 'Horneado del día, con ajonjolí.' },
];

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
  const materials = useBurgerMaterials();
  const groupRef = useRef<THREE.Group>(null);
  // outer groups carry the animated Y; inner meshes carry the tumble rotation
  // (keeps tooltips — children of the outer group — from orbiting).
  const layerRefs = useRef<Array<THREE.Group | null>>([]);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const tipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const idle = useRef(0);
  const readySet = useRef(false);
  const sesameRef = useRef<THREE.InstancedMesh>(null);
  const greaseRef = useRef<THREE.InstancedMesh>(null);
  // Tooltips only exist visually inside the despiece window (fade 0.42–0.64).
  // Mounting the <Html> nodes just around it stops drei from projecting and
  // writing 6 DOM transforms per frame during the entire rest of the scroll.
  const [tipsActive, setTipsActive] = useState(false);
  const tipsActiveRef = useRef(false);

  const geoms = useMemo(
    () => ({
      bottomBun: makeBottomBun(),
      patty: makePatty(),
      cheese: makeCheese(),
      tomato: makeTomato(),
      lettuce: makeLettuce(),
      topBun: makeTopBun(),
    }),
    [],
  );
  const lettuceInnerGeo = useMemo(() => makeLettuceInner(), []);

  const seeds = useMemo(() => sesameSeeds(60), []);
  const sesameGeo = useMemo(() => new THREE.SphereGeometry(0.043, 12, 9), []);

  // sauce ooze band + grease droplets that ride on the patty
  const sauceGeo = useMemo(() => makeSauceRing(1.3, 0.15), []);
  const dropGeo = useMemo(() => new THREE.SphereGeometry(1, 12, 10), []);
  const greaseDroplets = useMemo(() => greaseDrops(24, 1.16, 0.22), []);

  const geomByKey = geoms as Record<string, THREE.BufferGeometry>;
  const matByKey: Record<string, THREE.Material> = {
    bottomBun: materials.bun,
    patty: materials.patty,
    cheese: materials.cheese,
    tomato: materials.tomato,
    lettuce: materials.lettuce,
    topBun: materials.bun,
  };

  // place sesame instances on the dome, tinting each a toast tone
  useLayoutEffect(() => {
    const inst = sesameRef.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const scl = new THREE.Vector3();
    seeds.forEach((s, i) => {
      pos.set(...s.position);
      nrm.set(...s.normal);
      q.setFromUnitVectors(up, nrm);
      const zrot = new THREE.Quaternion().setFromAxisAngle(nrm, s.rotation);
      q.premultiply(zrot);
      scl.set(s.scale, s.scale * 0.55, s.scale);
      m.compose(pos, q, scl);
      inst.setMatrixAt(i, m);
      inst.setColorAt(i, SEED_TONES[(Math.random() * SEED_TONES.length) | 0]);
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }, [seeds]);

  // place grease droplets on the patty top
  useLayoutEffect(() => {
    const inst = greaseRef.current;
    if (!inst) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    greaseDroplets.forEach((it, i) => {
      p.set(...it.position);
      q.setFromAxisAngle(yAxis, it.rotation);
      s.set(it.scale, it.scale * 0.5, it.scale);
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
  }, [greaseDroplets]);

  // dispose geometries on unmount
  useLayoutEffect(() => {
    return () => {
      Object.values(geoms).forEach((g) => g.dispose());
      lettuceInnerGeo.dispose();
      sesameGeo.dispose();
      sauceGeo.dispose();
      dropGeo.dispose();
    };
  }, [geoms, lettuceInnerGeo, sesameGeo, sauceGeo, dropGeo]);

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
    for (let i = 0; i < INGREDIENTS.length; i++) {
      const layer = layerRefs.current[i];
      if (!layer) continue;
      const def = INGREDIENTS[i];
      let spread: number;
      if (p < 0.4) {
        spread = 0;
      } else if (p < 0.65) {
        const local = clamp((dp - i * 0.05) / 0.75);
        spread = smoothstep(local);
      } else {
        const local = clamp((rp - (5 - i) * 0.04) / 0.82);
        spread = 1 - elasticOut(local);
      }
      const osc = motionScale > 0 ? Math.sin(t * 1.4 + i * 0.7) * 0.04 * clamp(spread) : 0;
      const targetY = THREE.MathUtils.lerp(def.assembledY, def.explodedY, spread) + osc;
      layer.position.y = damp(layer.position.y, targetY, 8, dt);
      const mesh = meshRefs.current[i];
      if (mesh) {
        mesh.rotation.y = damp(mesh.rotation.y, spread * TUMBLE[i], 3, dt);
        const wob = motionScale > 0 ? Math.sin(t * 0.9 + i * 1.3) * 0.06 * clamp(spread) : 0;
        mesh.rotation.x = damp(mesh.rotation.x, wob, 4, dt);
      }
    }

    // tooltip visibility (fully gone before the 90° turn at 0.66)
    const fadeIn = smoothstep(subProgress(p, 0.42, 0.48));
    const fadeOut = 1 - smoothstep(subProgress(p, 0.58, 0.64));
    const baseVis = p >= 0.4 && p <= 0.64 ? fadeIn * fadeOut : 0;
    for (let i = 0; i < tipRefs.current.length; i++) {
      const el = tipRefs.current[i];
      if (!el) continue;
      const reveal = clamp((dp - i * 0.05) / 0.4);
      const o = baseVis * smoothstep(reveal);
      el.style.opacity = String(o);
      el.style.transform = `translateY(${(1 - o) * 8}px)`;
      el.style.pointerEvents = 'none';
    }
  });

  return (
    <group ref={groupRef} position={[0, BASE_Y, 0]} scale={1}>
      {INGREDIENTS.map((def, i) => (
        <group
          key={def.key}
          ref={(el) => {
            layerRefs.current[i] = el;
          }}
          position={[0, def.assembledY, 0]}
        >
          <mesh
            ref={(el) => {
              meshRefs.current[i] = el;
            }}
            geometry={geomByKey[def.key]}
            material={matByKey[def.key]}
            castShadow
            receiveShadow
          >
            {def.key === 'topBun' && (
              <instancedMesh
                ref={sesameRef}
                args={[sesameGeo, materials.sesame, seeds.length]}
                castShadow
              />
            )}
            {def.key === 'lettuce' && (
              <mesh
                geometry={lettuceInnerGeo}
                material={materials.lettuce}
                position={[0, 0.05, 0]}
                rotation-y={0.55}
                castShadow
                receiveShadow
              />
            )}
            {def.key === 'patty' && (
              <>
                <mesh geometry={sauceGeo} material={materials.ketchup} position={[0, 0.19, 0]} />
                <instancedMesh
                  ref={greaseRef}
                  args={[dropGeo, materials.grease, greaseDroplets.length]}
                />
              </>
            )}
          </mesh>
          {tooltips && tipsActive && (
            <Html
              position={[def.side * 2.2, 0, 0.15]}
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
                  def.side === 1 ? 'text-left' : 'text-right'
                }`}
              >
                <p className="eyebrow mb-0.5">{def.label}</p>
                <p className="text-sm leading-snug text-bone">{def.text}</p>
              </div>
            </Html>
          )}
        </group>
      ))}
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
