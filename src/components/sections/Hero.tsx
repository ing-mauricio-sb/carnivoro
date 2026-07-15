'use client';

import CtaButton from '@/components/ui/CtaButton';

/** Hero beat content (fade + sync handled by the parent PhaseLayer). */
export default function Hero() {
  return (
    <div className="pointer-events-none flex h-full flex-col justify-between px-5 pb-12 pt-28 sm:px-8 sm:pb-16">
      <p className="eyebrow">La hamburguesería artesanal del Perú</p>

      <div className="max-w-xl">
        <p className="text-lead text-ash">
          La mejor hamburguesa 100% pura carne. Artesanal, casera y sin miedo.
        </p>
        <div className="pointer-events-auto mt-6 flex flex-wrap gap-3">
          <CtaButton href="#delivery" variant="primary">
            Pídela ahora
          </CtaButton>
          <CtaButton href="#menu" variant="ghost">
            Ver el menú
          </CtaButton>
        </div>
        <p className="scroll-cue mt-10 font-body text-xs uppercase tracking-[0.2em] text-ash">
          Baja y arma tu Carnívoro ↓
        </p>
      </div>
    </div>
  );
}
