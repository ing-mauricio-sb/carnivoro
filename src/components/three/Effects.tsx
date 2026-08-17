'use client';

import { useContext, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import {
  EffectComposer,
  EffectComposerContext,
  N8AO,
  Bloom,
  Vignette,
  Noise,
  SMAA,
  HueSaturation,
  BrightnessContrast,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { useUI } from '@/lib/scroll';

/**
 * The composer re-runs setSize only when the CSS size changes; a runtime DPR
 * change (adaptive PerformanceMonitor) resizes the renderer but would leave
 * every pass at the old buffer size. Re-sync whenever dpr moves.
 */
function DprSync() {
  const { composer } = useContext(EffectComposerContext);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  useEffect(() => {
    composer.setSize(size.width, size.height);
  }, [composer, size, dpr]);
  return null;
}

/**
 * Cinematic post stack. AO deepens the contacts between the burger layers
 * (reads as solid), Bloom gives the grill-ember glow, DoF adds depth on desktop.
 */
export default function Effects({ mobile = false }: { mobile?: boolean }) {
  // Signals the Loader that the lazy postprocessing chunk is live, so it never
  // reveals the scene mid-transition from raw render to composed render.
  useEffect(() => {
    useUI.getState().setEffectsReady(true);
  }, []);

  if (mobile) {
    return (
      <EffectComposer multisampling={0}>
        <DprSync />
        <N8AO aoRadius={0.5} intensity={1.2} distanceFalloff={1} quality="low" halfRes />
        <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.9} intensity={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.6} />
        <SMAA />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer multisampling={0}>
      <DprSync />
      <N8AO aoRadius={0.8} intensity={2.0} distanceFalloff={1} quality="high" halfRes />
      <Bloom luminanceThreshold={0.78} luminanceSmoothing={0.9} intensity={0.5} mipmapBlur />
      {/* DepthOfField removed: its legacy normalized values put the focus plane
          1.2cm from the camera under postprocessing v6's world units, blurring
          the entire burger (~7 units away) — and a single fixed-depth subject
          gains nothing from a bokeh pass. */}
      {/* appetizing grade — richer reds/golds, gentle contrast snap */}
      <HueSaturation saturation={0.08} />
      <BrightnessContrast brightness={0} contrast={0.08} />
      <Vignette eskil={false} offset={0.28} darkness={0.62} />
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.045} />
      <SMAA />
    </EffectComposer>
  );
}
