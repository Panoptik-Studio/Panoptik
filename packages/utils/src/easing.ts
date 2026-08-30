/**
 * @panoptik/utils — easing functions + registry.
 * OWNER: DEV A (see ROADMAP-A.md ownership matrix).
 */

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const easeInCubic = (t: number): number => t * t * t;

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const EASINGS: Record<string, (t: number) => number> = {
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  linear: (t) => t,
};
