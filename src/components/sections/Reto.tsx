'use client';

import Reveal from '@/components/ui/Reveal';
import CtaButton from '@/components/ui/CtaButton';

export default function Reto() {
  return (
    <section
      id="reto"
      className="relative overflow-hidden border-y border-surface2"
      style={{ background: 'linear-gradient(180deg, #7a1410 0%, #0c0a09 100%)' }}
    >
      {/* marquee backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 select-none opacity-[0.06]"
      >
        <div className="marquee-track flex w-max whitespace-nowrap">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className="font-display text-[14vw] font-black uppercase leading-none text-bone"
            >
              Reto Carnívoro&nbsp;·&nbsp;
            </span>
          ))}
        </div>
      </div>

      <div className="relative mx-auto max-w-4xl px-5 py-28 text-center sm:px-8 sm:py-36">
        <Reveal>
          <p className="eyebrow">El desafío</p>
          <h2 className="text-section mt-2 text-bone">¿Te la bancas?</h2>
        </Reveal>
        <Reveal delay={0.15} as="p" className="text-lead mx-auto mt-5 max-w-2xl text-bone/90">
          El Reto Carnívoro te espera: una torre de carne contra el reloj. Termínala
          y la casa invita. <span className="text-ash">[verificar condiciones]</span>
        </Reveal>
        <Reveal delay={0.3}>
          <div className="mt-8 flex justify-center">
            <CtaButton href="#delivery" variant="primary">
              Acepto el reto
            </CtaButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
