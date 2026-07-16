'use client';

import { scroll } from './scroll';

type ProgressSubscriber = (progress: number) => void;

const subs = new Set<ProgressSubscriber>();
let raf = 0;
let last = -1;

function loop() {
  raf = requestAnimationFrame(loop);
  const p = scroll.progress;
  // Pinned progress (idle page, or canvas covered past the stage) → zero
  // style writes / recalcs instead of one per subscriber per frame.
  if (p === last) return;
  last = p;
  subs.forEach((fn) => fn(p));
}

/**
 * Single rAF driver for every DOM overlay that reads scroll.progress.
 * Replaces one independent rAF loop per component (4 PhaseLayers + the hero
 * type ran five) with one loop that only fans out when progress changed.
 */
export function subscribeProgress(fn: ProgressSubscriber): () => void {
  subs.add(fn);
  fn(scroll.progress);
  if (subs.size === 1) {
    last = -1;
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subs.delete(fn);
    if (subs.size === 0) cancelAnimationFrame(raf);
  };
}
