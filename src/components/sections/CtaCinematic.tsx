'use client';

import CtaButton from '@/components/ui/CtaButton';

export default function CtaCinematic() {
  return (
    <div className="pointer-events-none flex h-full items-center justify-end px-5 sm:px-8">
      <div className="max-w-lg text-right">
        <h2 className="text-section text-bone">
          Pide la tuya
          <br />
          <span className="text-ember">ahora</span>
        </h2>
        <p className="text-lead mt-4 text-ash">Delivery en minutos a toda Lima.</p>
        <div className="pointer-events-auto mt-6 flex flex-wrap justify-end gap-3">
          <CtaButton href="#delivery" variant="primary">
            Rappi
          </CtaButton>
          <CtaButton href="#delivery" variant="pill">
            DiDi Food
          </CtaButton>
          <CtaButton href="#delivery" variant="pill">
            PedidosYa
          </CtaButton>
          <CtaButton href="#delivery" variant="pill">
            WhatsApp
          </CtaButton>
        </div>
      </div>
    </div>
  );
}
