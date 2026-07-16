'use client';

import { useEffect, useRef, useState } from 'react';
import { useUI } from '@/lib/scroll';

/**
 * Full-screen brand loader over the charcoal stage. Fills toward ~95% while the
 * scene boots, then completes and fades out once the 3D reports its first frame
 * (or a safety timeout elapses) — so there's never a blank flash.
 */
export default function Loader() {
  const ready = useUI((s) => s.ready);
  const effectsReady = useUI((s) => s.effectsReady);
  const [pct, setPct] = useState(4);
  const [gone, setGone] = useState(false);
  const done = useRef(false);

  // creep toward 95% while booting
  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p < 95 ? p + Math.max(0.5, (95 - p) * 0.06) : p));
    }, 90);
    return () => clearInterval(id);
  }, []);

  // complete + fade when ready (or safety timeout)
  useEffect(() => {
    const finish = () => {
      if (done.current) return;
      done.current = true;
      setPct(100);
      setTimeout(() => setGone(true), 650);
    };
    if (ready && effectsReady) finish();
    const safety = setTimeout(finish, 8000);
    return () => clearTimeout(safety);
  }, [ready, effectsReady]);

  if (gone) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg transition-opacity duration-500"
      style={{ opacity: done.current && pct >= 100 ? 0 : 1 }}
    >
      <p className="eyebrow mb-4">Carnívoro</p>
      <h1
        className="font-display font-black uppercase text-bone"
        style={{ fontSize: 'clamp(2.5rem, 9vw, 6rem)', lineHeight: 0.9 }}
      >
        100% <span className="text-meat">Carne</span>
      </h1>
      <div className="mt-8 h-[3px] w-56 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full bg-ember transition-[width] duration-150 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-3 font-body text-sm text-ash tnum">
        Encendiendo la parrilla… {Math.round(pct)}%
      </p>
    </div>
  );
}
