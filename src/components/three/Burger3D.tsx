'use client';

import { Suspense, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Preload, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import Burger from './Burger';
import Lighting from './Lighting';
import Effects from './Effects';
import Smoke from './Smoke';
import { useIsMobile, usePrefersReducedMotion } from '@/lib/useMediaQuery';
import { useUI } from '@/lib/scroll';

/**
 * Pauses the render loop while the fixed canvas is fully hidden behind the
 * solid sections (Menu → Footer), so the GPU stops paying for an invisible
 * scene. `covered` flips only at the exact 100%-covered boundary (see the
 * coverGate ScrollTrigger), so freezing/unfreezing is never visible.
 */
function FrameloopGate() {
  const covered = useUI((s) => s.covered);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    setFrameloop(covered ? 'never' : 'always');
    if (!covered) invalidate();
  }, [covered, setFrameloop, invalidate]);
  return null;
}

export default function Burger3D() {
  // Sync init is safe here: this component only mounts client-side (ssr:false),
  // so the very first render — the one that creates the GL context — already
  // sees the real device values instead of a desktop-defaults first frame.
  const mobile = useIsMobile(true);
  const reduced = usePrefersReducedMotion(true);

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, mobile ? 1.5 : 2]}
      camera={{ fov: 35, position: [0, 0.35, 7] }}
      // With the EffectComposer active the scene is rasterised into its own
      // render targets (SMAA does the AA); default-framebuffer MSAA only costs
      // memory. Reduced-motion skips the composer, so only then keep MSAA on.
      gl={{ antialias: reduced, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
    >
      <FrameloopGate />
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
