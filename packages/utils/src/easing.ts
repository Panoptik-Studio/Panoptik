/**
 * @panoptik/utils — shared pure helpers.
 * OWNER: DEV A (see ROADMAP-A.md ownership matrix).
 */

// Task: ROADMAP-A.md Task 1.2 — implement via TDD (easing.test.ts first).
// Required exports after implementation:
//   lerp(a,b,t), easeInOutCubic(t), easeOutCubic(t),
//   EASINGS: Record<string,(t:number)=>number> with keys
//   ["easeInOutCubic","easeOutCubic","linear"]

export const lerp = (_a: number, _b: number, _t: number): number => {
  throw new Error("TODO(DEV-A): implement in ROADMAP-A Task 1.2");
};

export const easeInOutCubic = (_t: number): number => {
  throw new Error("TODO(DEV-A): implement in ROADMAP-A Task 1.2");
};
