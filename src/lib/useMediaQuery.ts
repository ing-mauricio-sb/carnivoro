'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media-query hook. Defaults to `false` until mounted.
 * Pass `initializeWithValue: true` ONLY from client-only subtrees (e.g. under
 * next/dynamic ssr:false) — it reads matchMedia synchronously on first render,
 * which would mismatch during SSR hydration elsewhere.
 */
export function useMediaQuery(query: string, initializeWithValue = false): boolean {
  const [matches, setMatches] = useState(
    () =>
      initializeWithValue &&
      typeof window !== 'undefined' &&
      window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(initializeWithValue = false): boolean {
  return useMediaQuery('(max-width: 767px)', initializeWithValue);
}

export function usePrefersReducedMotion(initializeWithValue = false): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', initializeWithValue);
}
