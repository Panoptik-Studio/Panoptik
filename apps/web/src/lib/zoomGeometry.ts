/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.1.
 * Pure geometry helpers for zoom interaction on the canvas.
 * All coords are FRAME-relative (normalized 0-1).
 */

import type { ZoomPoint } from "@panoptik/schema";

const GRAB_RADIUS_PX = 24;

/**
 * Test if a pixel position (in CSS pixels) is near a zoom focal point.
 * `frameW` is the display width of the frame rect in CSS pixels.
 */
export function hitTestFocal(
  px: number,
  py: number,
  zp: ZoomPoint,
  frameW: number,
): boolean {
  const dist = Math.hypot(px - zp.to.x, py - zp.to.y) * frameW;
  return dist < GRAB_RADIUS_PX;
}

/**
 * Convert clientX/clientY (CSS viewport coords) to normalized 0-1 coords
 * relative to the FRAME rect (letterboxed area), clamped to [0, 1].
 */
export function normalizeClick(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  frame: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const rawX = (clientX - rect.left - frame.x) / frame.w;
  const rawY = (clientY - rect.top - frame.y) / frame.h;
  return {
    x: Math.min(1, Math.max(0, rawX)),
    y: Math.min(1, Math.max(0, rawY)),
  };
}
