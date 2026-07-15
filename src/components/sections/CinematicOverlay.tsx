'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { scroll } from '@/lib/scroll';
import { clamp, smoothstep } from '@/lib/math';
import Hero from './Hero';
import Valor from './Valor';
import Despiece from './Despiece';
import CtaCinematic from './CtaCinematic';

/**
 * A cinematic text layer whose opacity is driven straight from scroll.progress
 * (the same value the 3D burger reads) — so text and burger phases stay locked
 * together no matter the scroll speed.
 */
function PhaseLayer({
  start,
  end,
  fade = 0.05,
  children,
}: {
  start: number;
  end: number;
  fade?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = ref.current;
      if (el) {
        const p = scroll.progress;
        let o = 0;
        if (p >= start && p <= end) {
          // first layer stays full at p=0; last layer stays full at p>=1
          const inn = start <= 0 ? 1 : smoothstep(clamp((p - start) / fade));
          const out = end >= 1 ? 1 : 1 - smoothstep(clamp((p - (end - fade)) / fade));
          o = inn * out;
        }
        el.style.opacity = String(o);
        el.style.transform = `translateY(${(1 - o) * 22}px)`;
        el.style.visibility = o <= 0.01 ? 'hidden' : 'visible';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [start, end, fade]);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" style={{ opacity: 0 }}>
      {children}
    </div>
  );
}

export default function CinematicOverlay() {
  return (
    <div className="sticky top-0 h-screen overflow-hidden">
      <PhaseLayer start={0} end={0.2}>
        <Hero />
      </PhaseLayer>
      <PhaseLayer start={0.2} end={0.4}>
        <Valor />
      </PhaseLayer>
      <PhaseLayer start={0.4} end={0.64}>
        <Despiece />
      </PhaseLayer>
      <PhaseLayer start={0.64} end={1.02}>
        <CtaCinematic />
      </PhaseLayer>
    </div>
  );
}
