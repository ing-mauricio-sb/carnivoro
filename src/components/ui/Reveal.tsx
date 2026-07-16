'use client';

import {
  createElement,
  useEffect,
  useRef,
  type ElementType,
  type ReactNode,
} from 'react';

/** Blur-rise entrance when scrolled into view (CSS-driven, respects reduced-motion). */
export default function Reveal({
  children,
  as = 'div',
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  as?: ElementType;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // release will-change once the entrance finished (see .is-done in CSS)
    const onEnd = (e: Event) => {
      const ae = e as AnimationEvent;
      if (ae.target === el && ae.animationName === 'heroReveal') {
        el.classList.add('is-done');
        el.removeEventListener('animationend', onEnd);
      }
    };
    el.addEventListener('animationend', onEnd);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add('is-in');
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      el.removeEventListener('animationend', onEnd);
    };
  }, []);

  return createElement(
    as,
    {
      ref,
      className: `reveal ${className}`,
      style: { animationDelay: `${delay}s` },
    },
    children,
  );
}
