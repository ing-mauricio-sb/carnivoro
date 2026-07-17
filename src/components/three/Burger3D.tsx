'use client';

import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerformanceMonitor, Preload, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import Burger from './Burger';
import Lighting from './Lighting';
import Smoke from './Smoke';

// Splits postprocessing + n8ao into their own chunk so the burger's first
// frame doesn't wait for them; the composer mounts when the chunk lands and
// the Loader (which waits for effectsReady) hides the transition.
const Effects = lazy(() => import('./Effects'));
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
  const ready = useUI((s) => s.ready);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);
  const savedTime = useRef(0);
  const frozen = useRef(false);
  useEffect(() => {
    // Never freeze before the first frame flagged `ready`, or a deep-link boot
    // could pause the loop before setReady ever runs (Loader would stall).
    if (covered && ready && !frozen.current) {
      frozen.current = true;
      // setFrameloop resets clock.elapsedTime to 0 in BOTH directions; the
      // time-based bits (smoke, sparkles) would snap right as the canvas
      // re-emerges. Save/restore the clock across the freeze.
      savedTime.current = clock.elapsedTime;
      setFrameloop('never');
    } else if (!covered && frozen.current) {
      frozen.current = false;
      setFrameloop('always');
      clock.elapsedTime = savedTime.current;
      invalidate();
    }
  }, [covered, ready, setFrameloop, invalidate, clock]);
  return null;
}

/**
 * The postprocessing chunk is a cosmetic enhancement; if it fails to load
 * (flaky network, stale deploy cache) degrade to the raw render instead of
 * letting the error replace the whole page — and unblock the Loader.
 */
class EffectsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    useUI.getState().setEffectsReady(true);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function Burger3D() {
  // Sync init is safe here: this component only mounts client-side (ssr:false),
  // so the very first render — the one that creates the GL context — already
  // sees the real device values instead of a desktop-defaults first frame.
  const mobile = useIsMobile(true);
  const reduced = usePrefersReducedMotion(true);
  const covered = useUI((s) => s.covered);
  // Adaptive quality floor: full sharpness by default, steps down only under
  // sustained fps decline (user-approved trade: fluidity over DPR when weak).
  const [dprCap, setDprCap] = useState(2);

  // No composer under reduced motion — unblock the Loader immediately.
  useEffect(() => {
    if (reduced) useUI.getState().setEffectsReady(true);
  }, [reduced]);

  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={[1, Math.min(dprCap, mobile ? 1.5 : 2)]}
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
      {/* Unmounted while frozen: a paused loop would otherwise feed it
          poisoned ~0fps samples on resume. */}
      {!covered && (
        <PerformanceMonitor
          flipflops={2}
          onDecline={() => setDprCap((d) => Math.max(1, d - 0.25))}
          onIncline={() => setDprCap((d) => Math.min(2, d + 0.25))}
          // settle above the 1.0 hard floor: on oscillating hardware a mild
          // permanent cap beats repeated visible sharpness jumps
          onFallback={() => setDprCap(1.25)}
        />
      )}
      <Suspense fallback={null}>
        <Lighting mobile={mobile} reduced={reduced} />
        <Burger
          spreadScale={mobile ? 0.4 : 1}
          baseScale={mobile ? 0.62 : 1}
          motionScale={reduced ? 0 : 1}
          tooltips={!mobile}
          parallax={!mobile && !reduced}
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
      {/* Own boundary: sharing the scene's Suspense would let the chunk fetch
          defer (or retry) the already-booted scene siblings. */}
      {!reduced && (
        <EffectsBoundary>
          <Suspense fallback={null}>
            <Effects mobile={mobile} />
          </Suspense>
        </EffectsBoundary>
      )}
    </Canvas>
  );
}
