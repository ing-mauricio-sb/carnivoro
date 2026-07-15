'use client';

import { useEffect, useState } from 'react';
import { useUI } from '@/lib/scroll';
import CtaButton from '@/components/ui/CtaButton';

const LINKS = [
  { label: 'Menú', href: '#menu' },
  { label: 'Sedes', href: '#sedes' },
  { label: 'Reto', href: '#reto' },
  { label: 'Franquicias', href: '#franquicias' },
];

export default function Nav() {
  const navOpen = useUI((s) => s.navOpen);
  const setNavOpen = useUI((s) => s.setNavOpen);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`pointer-events-auto fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        scrolled || navOpen
          ? 'border-b border-surface2 bg-bg/85 backdrop-blur-md'
          : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a
          href="#top"
          className="font-display text-2xl font-black uppercase tracking-tight text-bone"
        >
          Carnívoro
        </a>

        <div className="hidden items-center gap-7 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-body text-sm font-medium text-ash transition-colors hover:text-bone"
            >
              {l.label}
            </a>
          ))}
          <CtaButton href="#delivery" variant="primary" className="!px-5 !py-2 text-sm">
            Pide delivery
          </CtaButton>
        </div>

        <button
          type="button"
          aria-label="Abrir menú"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(!navOpen)}
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span
            className={`h-0.5 w-6 bg-bone transition ${navOpen ? 'translate-y-2 rotate-45' : ''}`}
          />
          <span className={`h-0.5 w-6 bg-bone transition ${navOpen ? 'opacity-0' : ''}`} />
          <span
            className={`h-0.5 w-6 bg-bone transition ${navOpen ? '-translate-y-2 -rotate-45' : ''}`}
          />
        </button>
      </nav>

      {navOpen && (
        <div className="border-t border-surface2 bg-bg/95 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-1 px-5 py-4">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setNavOpen(false)}
                className="rounded-lg px-3 py-3 font-body text-base text-bone hover:bg-surface"
              >
                {l.label}
              </a>
            ))}
            <CtaButton
              href="#delivery"
              variant="primary"
              className="mt-2"
              onClick={() => setNavOpen(false)}
            >
              Pide delivery
            </CtaButton>
          </div>
        </div>
      )}
    </header>
  );
}
