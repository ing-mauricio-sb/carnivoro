'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
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
  sesameSeeds,
  makeSauceRing,
  greaseDrops,
} from './geometry';
import { useBurgerMaterials } from './materials';
import { scroll, useUI } from '@/lib/scroll';
import { clamp, damp, elasticOut, smoothstep, subProgress } from '@/lib/math';

const BASE_Y = -0.55;
const REUNION_ANGLE = Math.PI * 0.5;

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
}: {
  /** horizontal travel factor (smaller on mobile) */
  spreadScale?: number;
  /** 0 disables scroll motion (reduced-motion) */
  motionScale?: number;
  /** overall size factor (smaller on mobile so the burger fits portrait) */
  baseScale?: number;
  /** render per-ingredient tooltips (off on narrow screens) */
  tooltips?: boolean;
}) {
  const materials = useBurgerMaterials();
  const groupRef = useRef<THREE.Group>(null);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);
  const tipRefs = useRef<Array<HTMLDivElement | null>>([]);
  const idle = useRef(0);
  const readySet = useRef(false);
  const sesameRef = useRef<THREE.InstancedMesh>(null);
  const greaseRef = useRef<THREE.InstancedMesh>(null);

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

  const seeds = useMemo(() => sesameSeeds(60), []);
  const sesameGeo = useMemo(() => new THREE.SphereGeometry(0.043, 12, 9), []);

  // sauce ooze band + grease droplets that ride on the patty
  const sauceGeo = useMemo(() => makeSauceRing(1.31, 0.17), []);
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

  // place sesame instances on the dome
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
    });
    inst.instanceMatrix.needsUpdate = true;
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
      sesameGeo.dispose();
      sauceGeo.dispose();
      dropGeo.dispose();
    };
  }, [geoms, sesameGeo, sauceGeo, dropGeo]);

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
    group.scale.setScalar(s);

    // rotation — spin while whole (hero/valor), face forward to read the layers
    // during despiece (so tooltips stay put), then a deliberate 90° turn for the CTA.
    const TAU = Math.PI * 2;
    const face = Math.round(idle.current / TAU) * TAU;
    if (p < 0.4) {
      if (motionScale > 0) idle.current += dt * 0.28;
      group.rotation.y = damp(group.rotation.y, idle.current, 6, dt);
    } else if (p < 0.66) {
      group.rotation.y = damp(group.rotation.y, face, 4, dt);
    } else {
      group.rotation.y = damp(group.rotation.y, face + REUNION_ANGLE, 3.2, dt);
    }
    group.rotation.z = damp(group.rotation.z, p >= 0.66 ? -0.12 : 0, 3, dt);
    const tiltTarget = p >= 0.4 && p < 0.66 ? 0.16 : 0.03;
    group.rotation.x = damp(group.rotation.x, tiltTarget, 3, dt);

    // ingredients spread
    for (let i = 0; i < INGREDIENTS.length; i++) {
      const mesh = meshRefs.current[i];
      if (!mesh) continue;
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
      mesh.position.y = damp(mesh.position.y, targetY, 8, dt);
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
        <mesh
          key={def.key}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          geometry={geomByKey[def.key]}
          material={matByKey[def.key]}
          position={[0, def.assembledY, 0]}
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
          {def.key === 'patty' && (
            <>
              <mesh geometry={sauceGeo} material={materials.ketchup} position={[0, 0.19, 0]} />
              <instancedMesh
                ref={greaseRef}
                args={[dropGeo, materials.grease, greaseDroplets.length]}
              />
            </>
          )}
          {tooltips && (
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
        </mesh>
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
