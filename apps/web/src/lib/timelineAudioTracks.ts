/**
 * Canvas drawing + geometry for the AudioTrack lane (music/voiceover) in the
 * timeline. The lane is drawn on the canvas like the zoom track; invisible DOM
 * hit-divs (positioned via audioBlockGeometry) handle dragging. Pure functions
 * so they can be unit-tested without the component.
 */
import type { AudioTrack } from "@panoptik/schema";

/** Y of the audio lane — just below the zoom track (ZOOM_TRACK_Y + 24 + gap). */
export const AUDIO_TRACK_Y = 184;
export const AUDIO_LANE_HEIGHT = 26;

/** Pixel box for a track block in the given lane. */
export function audioBlockGeometry(
  track: AudioTrack,
  timeToX: (t: number) => number,
): { left: number; width: number } {
  const left = timeToX(track.startT);
  const width = Math.max(2, timeToX(track.startT + track.duration) - left);
  return { left, width };
}

/** Draw every track as a rounded block from startT to startT + duration. */
export function drawAudioTracks(
  ctx: CanvasRenderingContext2D,
  tracks: AudioTrack[],
  timeToX: (t: number) => number,
  y: number,
  height = AUDIO_LANE_HEIGHT,
): void {
  for (const track of tracks) {
    const { left, width } = audioBlockGeometry(track, timeToX);
    if (left + width < 0 || left > ctx.canvas.width) continue;
    ctx.save();
    roundRectPath(ctx, left, y, width, height, 6);
    ctx.fillStyle = track.kind === "music" ? "rgba(0,112,243,0.16)" : "rgba(16,185,129,0.16)";
    ctx.fill();
    ctx.strokeStyle = track.kind === "music" ? "#0070f3" : "#10b981";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = track.kind === "music" ? "#0070f3" : "#0f9d76";
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(left + 4, y, Math.max(0, width - 8), height);
    ctx.clip();
    ctx.fillText(`${track.kind === "music" ? "♪" : "🎙"} ${track.name ?? track.kind}`, left + 7, y + height / 2);
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
