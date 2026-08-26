/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.3 + 2.1.
 * getCameraTransform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays → captions; staged text/captions drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInOutCubic, lerp } from "@panoptik/utils";
import type { Project, ZoomPoint } from "@panoptik/schema";
import { frameRect } from "./layout";

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

// ── Decoded frame cache (set by decode.ts via setCurrentFrame) ──
let currentFrame: CanvasImageSource | null = null;

export function setCurrentFrame(frame: CanvasImageSource | null) {
  currentFrame = frame;
}

export function getCurrentFrame(): CanvasImageSource | null {
  return currentFrame;
}

/**
 * 5-layer synchronous composition. Preview and export share this exact codepath.
 * Layer order: background → frame (zoomed) → facecam PiP → text → captions.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  // ── Layer 1: Background ──
  drawBackground(ctx, project, w, h);

  // ── Layer 2: Letterboxed frame with camera zoom ──
  const rect = frameRect(w, h, project.clip.width, project.clip.height, project.aspectPreset);
  if (currentFrame) {
    const tr = getCameraTransform(project.zoomPoints, t);
    const fx = rect.x + tr.x * rect.w;
    const fy = rect.y + tr.y * rect.h;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.scale(tr.scale, tr.scale);
    ctx.translate(-fx, -fy);
    ctx.drawImage(currentFrame, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  } else {
    // No decoded frame yet — draw a dark placeholder inside the frame rect
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // ── Layer 3: Facecam PiP (deferred to Task 2.2) ──

  // ── Layer 4: Text overlays ──
  drawTextOverlays(ctx, project, t, w, h);

  // ── Layer 5: Captions ──
  drawCaptions(ctx, project, t, w, h);
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  project: Project,
  w: number,
  h: number,
): void {
  const bg = project.background;
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.kind === "gradient") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, bg.stops[0]);
    g.addColorStop(1, bg.stops[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  } else {
    // blur — solid dark for now (real blur needs decoded frame)
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, w, h);
  }
}

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...project.textOverlays, ...project.stagedTextOverlays];
  for (const to of all) {
    if (t >= to.timestamp && t <= to.timestamp + 3) {
      ctx.fillStyle = to.staged ? "#f59e0b" : "#ffffff";
      ctx.font = "bold 32px sans-serif";
      ctx.textAlign = "center";
      const y = to.position === "top" ? 60 : to.position === "bottom" ? h - 60 : h / 2;
      ctx.fillText(to.text, w / 2, y);
    }
  }
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...project.captions, ...project.stagedCaptions];
  for (const c of all) {
    if (t >= c.start && t <= c.end) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "28px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(c.text, w / 2, h - 40);
    }
  }
}
