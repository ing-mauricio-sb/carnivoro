'use client';

import { Environment, Lightformer, ContactShadows } from '@react-three/drei';

/**
 * Cinematic warm lighting. The environment is built procedurally from
 * Lightformers (no external HDRI → self-contained, no network/CORS), giving the
 * cheese/bun/tomato believable reflections. Real lights add the cast shadows.
 */
export default function Lighting({ mobile = false }: { mobile?: boolean }) {
  return (
    <>
      {/* Procedural studio env map for reflections */}
      <Environment resolution={mobile ? 128 : 256} frames={1}>
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
        intensity={mobile ? 3 : 3.6}
        decay={0}
        castShadow
        shadow-mapSize-width={mobile ? 1024 : 2048}
        shadow-mapSize-height={mobile ? 1024 : 2048}
        shadow-bias={-0.0005}
      />
      {/* Rim — deep red from behind */}
      <directionalLight color="#c0271f" position={[-4, 2, -5]} intensity={0.7} />
      {/* Soft frontal fill so the front faces don't go black */}
      <directionalLight color="#ffe6c8" position={[0, 1.5, 6]} intensity={0.4} />

      <ContactShadows
        position={[0, -1.55, 0]}
        scale={11}
        blur={3.2}
        opacity={0.5}
        far={5}
        resolution={mobile ? 512 : 1024}
        color="#000000"
      />
    </>
  );
}
