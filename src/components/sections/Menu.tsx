'use client';

import Reveal from '@/components/ui/Reveal';
import CtaButton from '@/components/ui/CtaButton';

const ITEMS = [
  { name: 'Carnívoro Clásica', price: 24, desc: 'El origen. 100% carne, queso y la salsa de la casa.', tag: 'Clásica' },
  { name: 'Royal', price: 29, desc: 'Doble carne, doble antojo.', tag: 'Especial' },
  { name: 'Cheese Bacon', price: 29, desc: 'Tocino crocante + queso fundido.', tag: 'Especial' },
  { name: 'Tejana Doble', price: 39, desc: 'Para los que no se rinden.', tag: 'Big' },
  { name: 'Carnívoro Triple', price: 43, desc: 'Tres pisos de pura carne.', tag: 'Big' },
  { name: 'Cheesy Onion Jack Daniels', price: 36, desc: 'Aros de cebolla + salsa Jack Daniels.', tag: 'Special' },
  { name: 'Salchicárnivoro XL', price: 42, desc: 'Salchipapa para compartir… o no.', tag: 'Salchipapa' },
  { name: 'Alitas BBQ', price: 29, desc: 'Bañadas en BBQ de la casa.', tag: 'Alitas' },
];

export default function Menu() {
  return (
    <section id="menu" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 sm:py-32">
      <Reveal>
        <p className="eyebrow">El menú</p>
        <h2 className="text-section mt-2 text-bone">La manada</h2>
      </Reveal>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((item, i) => (
          <Reveal
            key={item.name}
            delay={(i % 3) * 0.08}
            className="group rounded-2xl border border-surface2 bg-surface p-6 transition duration-300 hover:-translate-y-1 hover:border-ember hover:shadow-[0_0_32px_-8px_rgba(255,106,26,0.4)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="eyebrow text-ash">{item.tag}</span>
                <h3 className="mt-1 font-display text-2xl font-bold uppercase leading-tight tracking-tight text-bone">
                  {item.name}
                </h3>
              </div>
              <span className="tnum shrink-0 font-body text-xl font-bold text-ember">
                S/ {item.price}
              </span>
            </div>
            <p className="mt-3 font-body text-sm text-ash">{item.desc}</p>
          </Reveal>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CtaButton href="#delivery" variant="primary">
          Ver carta completa
        </CtaButton>
        <p className="font-body text-xs text-ash">Precios referenciales [verificar].</p>
      </div>
    </section>
  );
}
