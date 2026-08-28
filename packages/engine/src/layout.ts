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
  // Cover the media's extent so nothing is upscaled needlessly, then cap.
  const width = Math.min(maxWidth, Math.max(media.width, Math.round(media.height * aspect)));
  const height = Math.round(width / aspect);
  // Odd dimensions are rejected by several encoders.
  return { width: width - (width % 2), height: height - (height % 2) };
}

/**
 * Compute the letterboxed frame rect inside a canvas of (canvasW × canvasH)
 * for media of (media.width × media.height) at the given aspect preset.
 * Returns { x, y, w, h } where x/y is the top-left offset of the frame.
 */
export function frameRect(
  canvasW: number,
  canvasH: number,
  media: Media,
  preset: AspectPreset,
): Rect {
  const target = presetAspect(preset, media);
  const boxW = Math.min(canvasW, canvasH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / media.width, boxH / media.height);
  const w = media.width * s;
  const h = media.height * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
