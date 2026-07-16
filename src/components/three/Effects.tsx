'use client';

import {
  EffectComposer,
  N8AO,
  Bloom,
  DepthOfField,
  Vignette,
  Noise,
  SMAA,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

/**
 * Cinematic post stack. AO deepens the contacts between the burger layers
 * (reads as solid), Bloom gives the grill-ember glow, DoF adds depth on desktop.
 */
export default function Effects({ mobile = false }: { mobile?: boolean }) {
  if (mobile) {
    return (
      <EffectComposer multisampling={0}>
        <N8AO aoRadius={0.5} intensity={1.2} distanceFalloff={1} quality="low" />
        <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.9} intensity={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.28} darkness={0.6} />
        <SMAA />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.8} intensity={1.8} distanceFalloff={1} quality="medium" />
      <Bloom luminanceThreshold={0.85} luminanceSmoothing={0.9} intensity={0.38} mipmapBlur />
      <DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.2} />
      <Vignette eskil={false} offset={0.28} darkness={0.62} />
      <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.035} />
      <SMAA />
    </EffectComposer>
  );
}
