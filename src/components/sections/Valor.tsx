'use client';

const CARDS = [
  {
    title: '100% Pura Carne',
    body: 'Blend de res molido en casa, todos los días. Cero relleno, cero procesados.',
  },
  {
    title: 'Artesanal & Casero',
    body: 'Recetas propias, pan brioche del día y salsas de la casa.',
  },
  {
    title: 'Porciones sin miedo',
    body: 'De la Clásica al Triple. Aquí se viene con hambre de verdad.',
  },
];

export default function Valor() {
  return (
    <div className="pointer-events-none flex h-full items-center px-5 sm:px-8">
      <div className="max-w-xl">
        <h2 className="text-section text-bone">
          No es fast food.
          <br />
          <span className="text-meat">Es carne de verdad.</span>
        </h2>

        <div className="mt-8 flex flex-col gap-3">
          {CARDS.map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border border-surface2 bg-surface/80 p-5 backdrop-blur-sm"
            >
              <h3 className="font-display text-2xl font-bold uppercase tracking-tight text-bone">
                {c.title}
              </h3>
              <p className="mt-1 font-body text-sm text-ash">{c.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-body text-sm text-ash">
          <span className="font-bold text-ember">+20 sedes</span>
          <span aria-hidden>·</span>
          <span className="font-bold text-ember">10+ años</span>
          <span aria-hidden>·</span>
          <span>Marida con Inca Kola 🥤</span>
        </div>
      </div>
    </div>
  );
}
