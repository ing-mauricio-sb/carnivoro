'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import { scroll } from './scroll';

let registered = false;

/**
 * Wires the "Awwwards scroll stack": Lenis smooth-scroll driven by GSAP's
 * ticker, ScrollTrigger synced to Lenis, and one master ScrollTrigger over the
 * tall cinematic wrapper that writes normalized progress into `scroll.progress`.
 *
 * The 3D burger reads `scroll.progress` in useFrame and damps toward its
 * per-phase targets, so fast scrolling never snaps.
 */
export function useCinematicScroll(
  wrapperRef: React.RefObject<HTMLElement | null>,
  reducedMotion: boolean,
) {
  useEffect(() => {
    if (!registered) {
      gsap.registerPlugin(ScrollTrigger);
      registered = true;
    }

    let lenis: Lenis | null = null;
    const tickerFn = (time: number) => {
      lenis?.raf(time * 1000);
    };

    if (!reducedMotion) {
      lenis = new Lenis({ duration: 1.15, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(tickerFn);
      gsap.ticker.lagSmoothing(0);
    }

    const master = ScrollTrigger.create({
      trigger: wrapperRef.current ?? undefined,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => {
        scroll.progress = self.progress;
      },
    });

    // Make sure positions are correct once fonts/layout settle.
    const refresh = () => ScrollTrigger.refresh();
    const raf = requestAnimationFrame(refresh);

    return () => {
      cancelAnimationFrame(raf);
      master.kill();
      if (lenis) {
        gsap.ticker.remove(tickerFn);
        lenis.destroy();
      }
    };
  }, [wrapperRef, reducedMotion]);
}
