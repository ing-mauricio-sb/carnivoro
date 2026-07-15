'use client';

import Reveal from '@/components/ui/Reveal';
import CtaButton from '@/components/ui/CtaButton';

export default function Franquicias() {
  return (
    <section id="franquicias" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <Reveal className="overflow-hidden rounded-3xl border border-surface2 bg-surface p-8 sm:p-14">
        <div className="grid items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <p className="eyebrow">Oportunidad</p>
            <h2 className="text-section mt-2 text-bone">
              Únete a <span className="text-ember">la manada</span>
            </h2>
            <p className="text-lead mt-4 max-w-2xl text-ash">
              Carnívoro es una marca probada con +20 locales. Abre tu franquicia y
              lleva la mejor hamburguesa a tu ciudad.
            </p>
          </div>
          <div className="flex flex-col gap-4 lg:items-end">
            <div className="flex gap-8">
              <div>
                <p className="tnum font-display text-5xl font-black text-ember">+20</p>
                <p className="font-body text-sm text-ash">locales</p>
              </div>
              <div>
                <p className="tnum font-display text-5xl font-black text-ember">10+</p>
                <p className="font-body text-sm text-ash">años</p>
              </div>
            </div>
            <CtaButton
              href="mailto:franquicias@carnivoro.pe"
              variant="primary"
              className="mt-2"
            >
              Quiero mi franquicia
            </CtaButton>
            <p className="font-body text-xs text-ash">Contacto [verificar].</p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
