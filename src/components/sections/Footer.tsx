'use client';

export default function Footer() {
  return (
    <footer className="border-t border-surface2 bg-bg">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <p
          className="font-display font-black uppercase leading-[0.85] tracking-tight text-transparent"
          style={{
            fontSize: 'clamp(3rem, 13vw, 11rem)',
            WebkitTextStroke: '1px #231a15',
          }}
        >
          Carnívoro
        </p>

        <div className="mt-8 flex flex-col gap-8 border-t border-surface2 pt-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-body text-sm text-ash">
              La mejor hamburguesa 100% pura carne.
            </p>
            <a
              href="https://www.instagram.com/carnivorolh/"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-body text-sm font-bold text-bone transition hover:text-ember"
            >
              @carnivorolh
            </a>
          </div>

          <div className="font-body text-sm text-ash">
            <p className="font-bold text-bone">Horario</p>
            <p className="mt-1">Lun – Dom · 12 p.m. – 11 p.m.</p>
          </div>

          <nav className="flex flex-col gap-1 font-body text-sm">
            <a href="#menu" className="text-ash transition hover:text-bone">Menú</a>
            <a href="#sedes" className="text-ash transition hover:text-bone">Sedes</a>
            <a href="#reto" className="text-ash transition hover:text-bone">Reto Carnívoro</a>
            <a href="#franquicias" className="text-ash transition hover:text-bone">Franquicias</a>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-surface2 pt-6 font-body text-xs text-ash sm:flex-row sm:items-center sm:justify-between">
          <p>© {2026} Carnívoro La Hamburguesería. Todos los derechos reservados.</p>
          <p>Hecho con 🔥 en el Perú.</p>
        </div>
      </div>
    </footer>
  );
}
