'use client';

import { useEffect, useRef } from 'react';
import { scroll } from '@/lib/scroll';
import { clamp } from '@/lib/math';

/**
 * The giant hero word, fixed BEHIND the transparent 3D canvas (z-0) so the
 * burger renders in front of it. Opacity is driven straight from scroll
 * progress via rAF (no React re-renders).
 */
export default function HeroBackType() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = ref.current;
      if (el) {
        // fully visible in the hero, gone by ~18% scroll
        const o = 1 - clamp(scroll.progress / 0.18);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${scroll.progress * -60}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 flex flex-col items-center justify-center"
    >
      <div ref={ref} className="text-center leading-[0.82]">
        <span className="text-hero block text-bone">100%</span>
        <span className="text-hero block text-meat">Carne</span>
      </div>
    </div>
  );
}
