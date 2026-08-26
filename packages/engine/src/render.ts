/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInOutCubic, lerp } from "@panoptik/utils";
import type { ZoomPoint } from "@panoptik/schema";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  let state = IDENTITY;
  for (const k of [...points].filter((p) => !p.staged).sort((a, b) => a.t - b.t)) {
    if (k.t > t) break;
    const p = Math.min(1, (t - k.t) / Math.max(k.dur, 0.001));
    const e = (EASINGS[k.ease] ?? easeInOutCubic)(p);
    state = {
      scale: lerp(state.scale, k.to.scale, e),
      x: lerp(state.x, k.to.x, e),
      y: lerp(state.y, k.to.y, e),
    };
  }
  return state;
}
