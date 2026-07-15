'use client';

import { useRef } from 'react';
import { useCinematicScroll } from '@/lib/useLenisGsap';
import { usePrefersReducedMotion } from '@/lib/useMediaQuery';

import Loader from '@/components/ui/Loader';
import Nav from '@/components/sections/Nav';
import HeroBackType from '@/components/sections/HeroBackType';
import CanvasStage from '@/components/three/CanvasStage';
import CinematicOverlay from '@/components/sections/CinematicOverlay';
import Menu from '@/components/sections/Menu';
import Reto from '@/components/sections/Reto';
import Sedes from '@/components/sections/Sedes';
import Delivery from '@/components/sections/Delivery';
import Franquicias from '@/components/sections/Franquicias';
import Footer from '@/components/sections/Footer';

export default function Home() {
  const cinematicRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useCinematicScroll(cinematicRef, reduced);

  return (
    <>
      <Loader />
      <Nav />

      <main id="top">
        {/* z-0 : giant type behind the transparent 3D canvas */}
        <HeroBackType />
        {/* z-1 : fixed 3D burger stage */}
        <CanvasStage />

        {/* z-10 : cinematic overlays scrolling over the burger (500vh),
            all synced to scroll.progress via CinematicOverlay's PhaseLayers */}
        <div ref={cinematicRef} className="relative z-10 h-[500vh]">
          <CinematicOverlay />
        </div>

        {/* z-10 : solid conversion sections that cover the fixed canvas */}
        <div className="relative z-10 bg-bg">
          <Menu />
          <Reto />
          <Sedes />
          <Delivery />
          <Franquicias />
          <Footer />
        </div>
      </main>
    </>
  );
}
