'use client';

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Environment, Lightformer, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Warm ember glow from below-front — sells the grill. The flicker is a slow
 * two-sine wobble, subtle enough to read as firelight, not as a strobe.
 * Static intensity when reduced motion is preferred.
 */
function EmberLight({ flicker }: { flicker: boolean }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame((state) => {
    const l = ref.current;
    if (!l || !flicker) return;
    const t = state.clock.elapsedTime;
    l.intensity = 0.55 + Math.sin(t * 7.3) * 0.045 + Math.sin(t * 13.7) * 0.025;
  });
  return (
    <pointLight
      ref={ref}
      color="#ff6a1a"
      position={[0.5, -1.1, 2.2]}
      intensity={0.55}
      decay={0}
    />
  );
}

/**
 * Cinematic warm lighting. The environment is built procedurally from
 * Lightformers (no external HDRI → self-contained, no network/CORS), giving the
 * cheese/bun/tomato believable reflections. Real lights add the cast shadows.
 */
export default function Lighting({
  mobile = false,
  reduced = false,
}: {
  mobile?: boolean;
  reduced?: boolean;
}) {
  return (
    <>
      {/* Procedural studio env map for reflections */}
      <Environment resolution={mobile ? 128 : 512} frames={1}>
        {/* warm-white key (soft, neutral so the bun reads golden not neon) */}
        <Lightformer intensity={2.2} color="#fff0dc" position={[3, 4, 4]} scale={[7, 7, 1]} />
        {/* warm side bounce */}
        <Lightformer intensity={0.8} color="#ffb877" position={[-5, 2, -2]} scale={[5, 6, 1]} />
        {/* deep-red rim behind, separates burger from the charcoal stage */}
        <Lightformer intensity={0.7} color="#c0271f" position={[0, -1, -6]} scale={[9, 5, 1]} />
        {/* cool top fill for form */}
        <Lightformer
          intensity={0.35}
          color="#2f3238"
          position={[0, 6, 0]}
          scale={[10, 10, 1]}
          rotation-x={Math.PI / 2}
        />
      </Environment>

      <hemisphereLight args={['#4a3a2e', '#0c0a09', 0.45]} />
      <ambientLight intensity={0.1} />

      {/* Key — warm (not orange) spot, casts the main shadow */}
      <spotLight
        color="#ffe0bd"
        position={[4.5, 6.5, 5]}
        angle={0.6}
        penumbra={0.9}
        intensity={mobile ? 3 : 4}
        decay={0}
        castShadow
        shadow-mapSize-width={mobile ? 1024 : 2048}
        shadow-mapSize-height={mobile ? 1024 : 2048}
        shadow-bias={-0.0005}
      />
      {/* Rim — deep red from behind */}
      <directionalLight color="#c0271f" position={[-4, 2, -5]} intensity={0.7} />
      {/* Cool kicker from high back-left — crisp edge separation from the stage */}
      <directionalLight color="#8a97ad" position={[-3, 5, -4]} intensity={0.35} />
      {/* Soft frontal fill so the front faces don't go black */}
      <directionalLight color="#ffe6c8" position={[0, 1.5, 6]} intensity={0.4} />
      {/* Ember underglow (desktop only — one extra light is real cost on mobile GPUs) */}
      {!mobile && <EmberLight flicker={!reduced} />}

      <ContactShadows
        position={[0, -1.55, 0]}
        scale={11}
        blur={mobile ? 3.2 : 2.8}
        opacity={mobile ? 0.5 : 0.62}
        far={5}
        resolution={512}
        // mobile: one static bake (the despiece silhouette shift is invisible at
        // phone size); desktop: dynamic but at half the previous target size —
        // the default is an unbounded every-frame re-render at 1024².
        frames={mobile ? 1 : Infinity}
        color="#000000"
      />
    </>
  );
}
