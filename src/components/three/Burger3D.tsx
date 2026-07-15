'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Preload, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import Burger from './Burger';
import Lighting from './Lighting';
import Effects from './Effects';
import Smoke from './Smoke';
import { useIsMobile, usePrefersReducedMotion } from '@/lib/useMediaQuery';

export default function Burger3D() {
  const mobile = useIsMobile();
  const reduced = usePrefersReducedMotion();

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, mobile ? 1.5 : 2]}
      camera={{ fov: 35, position: [0, 0.35, 7] }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <Suspense fallback={null}>
        <Lighting mobile={mobile} />
        <Burger
          spreadScale={mobile ? 0.4 : 1}
          baseScale={mobile ? 0.62 : 1}
          motionScale={reduced ? 0 : 1}
          tooltips={!mobile}
        />
        <Smoke
          count={mobile ? 7 : 14}
          frozen={reduced}
          origin={[0, -1.4, mobile ? -0.9 : -1.1]}
        />
        {!reduced && (
          <Sparkles
            count={mobile ? 16 : 34}
            scale={[5, 4.5, 3]}
            position={[0, 0.3, -0.3]}
            size={mobile ? 2 : 3}
            speed={0.3}
            opacity={0.7}
            color="#ff8a3d"
            noise={1.4}
          />
        )}
        <Preload all />
      </Suspense>
      {!reduced && <Effects mobile={mobile} />}
    </Canvas>
  );
}
