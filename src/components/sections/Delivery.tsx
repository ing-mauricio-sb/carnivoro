'use client';

import Reveal from '@/components/ui/Reveal';

const BRANDS = [
  { name: 'Rappi', href: '#', hover: 'hover:border-[#ff2d55] hover:text-[#ff2d55]' },
  { name: 'DiDi Food', href: '#', hover: 'hover:border-[#ff7a00] hover:text-[#ff7a00]' },
  { name: 'PedidosYa', href: '#', hover: 'hover:border-[#e33]/90 hover:text-[#ff4d4d]' },
  { name: 'WhatsApp', href: '#', hover: 'hover:border-[#25d366] hover:text-[#25d366]' },
];

export default function Delivery() {
  return (
    <section id="delivery" className="mx-auto max-w-5xl px-5 py-24 text-center sm:px-8 sm:py-32">
      <Reveal>
        <p className="eyebrow">Antojo inmediato</p>
        <h2 className="text-section mt-2 text-bone">Pídelo ya</h2>
      </Reveal>

      <Reveal delay={0.1} className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BRANDS.map((b) => (
          <a
            key={b.name}
            href={b.href}
            className={`flex items-center justify-center rounded-2xl border border-surface2 bg-surface px-6 py-6 font-display text-2xl font-bold uppercase tracking-tight text-bone transition duration-300 hover:-translate-y-1 ${b.hover}`}
          >
            {b.name}
          </a>
        ))}
      </Reveal>

      <Reveal delay={0.25} className="mt-8">
        <span className="inline-block rounded-full border border-surface2 bg-surface px-5 py-2 font-body text-sm text-ash">
          Todos los días · 12 p.m. – 11 p.m.
        </span>
      </Reveal>
    </section>
  );
}
