/**
 * OWNER: DEV A — ROADMAP-A.md Task 2.1.
 * Letterbox math. All normalized coords (zoom focal, facecam, caption anchor)
 * are relative to this FRAME rect, never the raw canvas.
 */
export type Rect = { x: number; y: number; w: number; h: number };

const ASPECT: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
};

/**
 * Compute the letterboxed frame rect inside a canvas of (canvasW × canvasH)
 * for a clip of (clipW × clipH) at the given aspect preset.
 * Returns { x, y, w, h } where x/y is the top-left offset of the frame.
 */
export function frameRect(
  canvasW: number,
  canvasH: number,
  clipW: number,
  clipH: number,
  preset: string,
): Rect {
  const target = ASPECT[preset] ?? canvasW / canvasH;
  const boxW = Math.min(canvasW, canvasH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / clipW, boxH / clipH);
  const w = clipW * s;
  const h = clipH * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
