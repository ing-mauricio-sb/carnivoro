/** Frame-rate independent exponential smoothing (à la THREE.MathUtils.damp). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function clamp(v: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalised 0→1 progress of `p` inside the [a, b] window (clamped). */
export function subProgress(p: number, a: number, b: number): number {
  return clamp((p - a) / (b - a));
}

export function smoothstep(t: number): number {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
}

/** Elastic ease-out — the springy overshoot used when the burger reassembles. */
export function elasticOut(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

/** Cinematic scroll beats (fractions of the 500vh stage). */
export const PHASES = {
  hero: [0.0, 0.2],
  valor: [0.2, 0.4],
  despiece: [0.4, 0.65],
  reunion: [0.65, 0.85],
  settle: [0.85, 1.0],
} as const;
