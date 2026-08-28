/**
 * OWNER: DEV A — ROADMAP-A.md Task 2.1.
 * Letterbox math. All normalized coords (zoom focal, facecam, caption anchor)
 * are relative to this FRAME rect, never the raw canvas.
 */
import type { Media, AspectPreset } from "@panoptik/schema";

export type Rect = { x: number; y: number; w: number; h: number };

const ASPECT: Record<string, number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
};

/** The aspect a preset asks for. "source" defers to the media, so it never bars. */
export function presetAspect(preset: AspectPreset, media: Media): number {
  if (preset === "source" || !ASPECT[preset]) return media.width / media.height;
  return ASPECT[preset]!;
}

/**
 * The output frame for media at a preset — the size of both the preview canvas
 * and the exported video, so what you see is what is encoded.
 *
 * The frame takes the preset's shape, and the media is fitted inside it by
 * frameRect. Sizing the canvas to the media instead and *then* letterboxing to
 * the preset fits twice, which leaves black on all four sides.
 */
export function outputSize(
  media: Media,
  preset: AspectPreset,
  maxWidth = 1920,
): { width: number; height: number } {
  const aspect = presetAspect(preset, media);
  let width: number;
  let height: number;

  if (aspect < 1) {
    // Portrait (e.g. 9:16 vertical video) — max dimension is height
    height = Math.min(maxWidth, Math.max(media.width, media.height, 1080));
    width = Math.round(height * aspect);
  } else if (preset === "source") {
    width = Math.min(maxWidth, media.width);
    height = Math.round(width / aspect);
  } else {
    // Landscape or square (16:9, 4:3, 1:1)
    const baseH = Math.min(media.height, 1080);
    const candidateW = Math.round(baseH * aspect);
    width = Math.min(maxWidth, Math.max(candidateW, media.width <= maxWidth ? media.width : maxWidth));
    height = Math.round(width / aspect);
    if (height > 1080 && aspect >= 1) {
      height = 1080;
      width = Math.round(height * aspect);
    }
  }

  // Odd dimensions are rejected by several encoders.
  return { width: width - (width % 2), height: height - (height % 2) };
}

/**
 * Compute the letterboxed frame rect inside a canvas of (canvasW × canvasH)
 * for media of (media.width × media.height) at the given aspect preset and optional padding.
 * Returns { x, y, w, h } where x/y is the top-left offset of the frame.
 */
export function frameRect(
  canvasW: number,
  canvasH: number,
  media: Media,
  preset: AspectPreset,
  padding = 0,
): Rect {
  const pad = Math.max(0, padding);
  const availW = Math.max(10, canvasW - pad * 2);
  const availH = Math.max(10, canvasH - pad * 2);

  const target = presetAspect(preset, media);
  const boxW = Math.min(availW, availH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / media.width, boxH / media.height);
  const w = media.width * s;
  const h = media.height * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
