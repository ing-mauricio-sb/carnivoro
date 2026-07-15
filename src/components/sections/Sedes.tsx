'use client';

import Reveal from '@/components/ui/Reveal';
import CtaButton from '@/components/ui/CtaButton';

const DISTRITOS = [
  'Barranco',
  'Chorrillos',
  'San Miguel',
  'Los Olivos',
  'Surco',
  'Surquillo',
  'La Molina',
  'La Victoria',
  'Punta Hermosa',
  'Miraflores',
  'San Juan de Lurigancho',
  'Comas',
];

const PROVINCIAS = ['Trujillo', 'Piura', 'Chiclayo', 'Arequipa', 'Cusco', 'Iquitos'];

export default function Sedes() {
  return (
    <section id="sedes" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <Reveal>
        <p className="eyebrow">Cerca de ti</p>
        <h2 className="text-section mt-2 text-bone">
          +20 sedes <span className="text-ember">en el Perú</span>
        </h2>
        <p className="text-lead mt-3 text-ash">Y seguimos creciendo.</p>
      </Reveal>

      <Reveal delay={0.1} className="mt-10 flex flex-wrap gap-2.5">
        {DISTRITOS.map((d) => (
          <span
            key={d}
            className="cursor-default rounded-full border border-surface2 bg-surface px-4 py-2 font-body text-sm text-bone transition hover:border-ember hover:text-ember"
          >
            {d}
          </span>
        ))}
      </Reveal>

      <Reveal delay={0.2} className="mt-6">
        <p className="font-body text-sm text-ash">
          <span className="font-bold text-bone">Provincias:</span>{' '}
          {PROVINCIAS.join(' · ')}{' '}
          <span className="text-ash/70">[verificar]</span>
        </p>
      </Reveal>

      <Reveal delay={0.3} className="mt-8">
        <CtaButton
          href="https://www.google.com/maps/search/Carn%C3%ADvoro+La+Hamburgueser%C3%ADa"
          variant="ghost"
          external
        >
          Encuentra tu sede más cercana
        </CtaButton>
      </Reveal>
    </section>
  );
}
