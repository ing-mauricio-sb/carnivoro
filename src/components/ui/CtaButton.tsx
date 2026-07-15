'use client';

import type { ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'pill';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-body font-bold uppercase tracking-wide transition duration-300 focus-visible:outline-none';

const variants: Record<Variant, string> = {
  primary:
    'bg-ember text-bg px-6 py-3 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(255,106,26,0.5)]',
  ghost:
    'border border-surface2 text-bone px-6 py-3 hover:border-ember hover:text-ember',
  pill: 'bg-surface text-bone px-5 py-2.5 text-sm border border-surface2 hover:border-ember hover:-translate-y-0.5',
};

export default function CtaButton({
  children,
  href,
  variant = 'primary',
  className = '',
  external = false,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  variant?: Variant;
  className?: string;
  external?: boolean;
  onClick?: () => void;
}) {
  const cls = `${base} ${variants[variant]} ${className}`;
  if (href) {
    return (
      <a
        href={href}
        className={cls}
        onClick={onClick}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      {children}
    </button>
  );
}
