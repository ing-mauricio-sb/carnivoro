'use client';

import { create } from 'zustand';

/**
 * Module-scope mutable progress read every frame inside the R3F <Burger>.
 * Kept OUTSIDE React state on purpose: the 3D scene reads it in useFrame at
 * 60fps and must never trigger a React re-render.
 */
export const scroll = {
  progress: 0, // 0 → 1 across the whole 500vh cinematic stage
};

/** Small store for the few DOM bits that genuinely need React state. */
interface UIState {
  navOpen: boolean;
  setNavOpen: (v: boolean) => void;
  ready: boolean; // 3D scene has rendered its first frame
  setReady: (v: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  navOpen: false,
  setNavOpen: (v) => set({ navOpen: v }),
  ready: false,
  setReady: (v) => set({ ready: v }),
}));
