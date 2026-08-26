/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
export {};

// import { EASINGS } from "@panoptik/utils";
// import type { Project, ZoomPoint } from "@panoptik/schema";
// export type Transform = { scale: number; x: number; y: number };
// export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };
// export function getCameraTransform(points: ZoomPoint[], t: number): Transform {}
// export function renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number): void {}
