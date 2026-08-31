/**
 * Probe Frame Snapshot & 3x3 Grid Compositor for Panoptik.
 * Generates lightweight image snapshots and crops for VLM grounding & verification.
 */

import type { Project } from "@panoptik/schema";
import { renderFrame, ensureBackgroundImages } from "./render";
import { prepareFrame } from "./decode";

export interface ProbeSnapshotOptions {
  width?: number;
  height?: number;
  gridOverlay?: boolean;
  quality?: number; // 0.1 .. 1.0
}

/**
 * Draws a non-destructive 3x3 alphanumeric grid overlay (A1..C3) over a canvas context.
 */
export function draw3x3GridOverlay(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();

  // Grid partition lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = Math.max(1, Math.round(w / 800));
  // @ts-ignore
  if (typeof ctx.setLineDash === "function") ctx.setLineDash([6, 6]);

  const colW = w / 3;
  const rowH = h / 3;

  ctx.beginPath();
  // Vertical lines
  ctx.moveTo(colW, 0);
  ctx.lineTo(colW, h);
  ctx.moveTo(colW * 2, 0);
  ctx.lineTo(colW * 2, h);
  // Horizontal lines
  ctx.moveTo(0, rowH);
  ctx.lineTo(w, rowH);
  ctx.moveTo(0, rowH * 2);
  ctx.lineTo(w, rowH * 2);
  ctx.stroke();

  // Alphanumeric Badges (A1..C3)
  // @ts-ignore
  if (typeof ctx.setLineDash === "function") ctx.setLineDash([]);
  const rows = ["A", "B", "C"];
  const fontSize = Math.max(12, Math.round(w * 0.016));
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const label = `${rows[r]}${c + 1}`;
      const badgeX = c * colW + colW * 0.12;
      const badgeY = r * rowH + rowH * 0.14;
      const badgeR = fontSize * 0.9;

      ctx.beginPath();
      ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, badgeX, badgeY + 1);
    }
  }

  ctx.restore();
}

/**
 * Captures a lightweight base64 JPEG snapshot at timeline time `t`.
 */
export async function captureProbeSnapshot(
  project: Project,
  t: number,
  options: ProbeSnapshotOptions = {},
): Promise<string> {
  const w = options.width ?? 960;
  const h = options.height ?? 540;
  const quality = options.quality ?? 0.82;

  await ensureBackgroundImages(project);
  await prepareFrame(t);

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      renderFrame(ctx as unknown as CanvasRenderingContext2D, project, t);
      if (options.gridOverlay) {
        draw3x3GridOverlay(ctx, w, h);
      }
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    }
  }

  // DOM Canvas Fallback
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      renderFrame(ctx, project, t);
      if (options.gridOverlay) {
        draw3x3GridOverlay(ctx, w, h);
      }
      return canvas.toDataURL("image/jpeg", quality);
    }
  }

  return "";
}

/**
 * Crops a square region centered at normalized coordinate `(cx, cy)` for the 1-shot verify loop.
 */
export async function captureCropSnapshot(
  project: Project,
  t: number,
  cx: number,
  cy: number,
  cropSizePx = 300,
): Promise<string> {
  const baseW = 1920;
  const baseH = 1080;

  await ensureBackgroundImages(project);
  await prepareFrame(t);

  const fullCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(baseW, baseH) : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!fullCanvas) return "";

  fullCanvas.width = baseW;
  fullCanvas.height = baseH;
  const fullCtx = fullCanvas.getContext("2d");
  if (!fullCtx) return "";

  renderFrame(fullCtx as unknown as CanvasRenderingContext2D, project, t);

  // Target pixel center
  const pixelX = Math.max(0, Math.min(baseW, cx * baseW));
  const pixelY = Math.max(0, Math.min(baseH, cy * baseH));
  const halfSize = cropSizePx / 2;
  const srcX = Math.max(0, Math.min(baseW - cropSizePx, pixelX - halfSize));
  const srcY = Math.max(0, Math.min(baseH - cropSizePx, pixelY - halfSize));

  const cropCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cropSizePx, cropSizePx) : typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!cropCanvas) return "";
  cropCanvas.width = cropSizePx;
  cropCanvas.height = cropSizePx;
  const cropCtx = cropCanvas.getContext("2d");
  if (!cropCtx) return "";

  // @ts-ignore
  cropCtx.drawImage(fullCanvas, srcX, srcY, cropSizePx, cropSizePx, 0, 0, cropSizePx, cropSizePx);

  if (cropCanvas instanceof OffscreenCanvas) {
    const blob = await cropCanvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } else if (cropCanvas instanceof HTMLCanvasElement) {
    return cropCanvas.toDataURL("image/jpeg", 0.85);
  }

  return "";
}
