/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.2 + 2.4.
 * Interactive canvas: zoom click interaction, focal dot dragging, rAF playback loop.
 * Keyboard undo/redo (Cmd+Z / Cmd+Shift+Z).
 * Per-segment: everything the preview draws resolves the ACTIVE segment at the
 * playhead (renderFrame/compositing, audio speed, facecam, stage background);
 * the canvas is sized to the SELECTED segment's preset so it stays stable across
 * playback while other segments letterbox inside it.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useProjectStore } from "@/stores/projectStore";
import { engine } from "@/lib/engineProvider";
import { syncTrackPlayback, trackBufferMap } from "@/lib/trackPlayback";
import {
  IDENTITY,
  cameraViewport,
  ensureBackgroundImages,
  canvasToFrame,
  frameRect,
  frameToCanvas,
  getCameraTransform,
  getProjectCameraTransform,
  outputSize,
  projectDuration,
  resolveInterpolatedFacecam,
  resolveSegment,
} from "@panoptik/engine";
import type { Facecam, Project, Segment, ZoomPoint, TextOverlay } from "@panoptik/schema";
import { mediaForSegment, primaryMedia } from "@panoptik/schema";
import { segmentDuration } from "@panoptik/engine";
import { FIRST_MEDIA_ID } from "@panoptik/schema";

/** Preview compositing cap — matches the decode cap in the engine. */
const MAX_CANVAS_WIDTH = 1920;
/** Seconds either side of the playhead where a zoom's focal handle is editable. */
const MARKER_WINDOW = 2;
/** Depth a click-to-add zoom starts at. */
const DEFAULT_ZOOM_SCALE = 2.2;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** The segment active at on-timeline `t` + its source time, falling back to the
 *  last segment at media.duration past the end (matches renderFrame). */
function resolveActive(
  project: Project,
  t: number,
): { seg: Segment; srcT: number } {
  const r = resolveSegment(project, t);
  if (r) return { seg: r.segment, srcT: r.srcT };
  return {
    seg: project.segments[project.segments.length - 1]!,
    srcT: primaryMedia(project).duration,
  };
}

/**
 * NOTE on prefetch: the decode architecture holds exactly ONE pipeline, so a
 * true parallel "warm" would thrash — activateMedia closes the active pipeline
 * and the main loop would immediately swap back. Boundary swaps are a single
 * ~100ms close+open, handled by the loop's per-frame activateMedia instead.
 */

/**
 * Everything needed to place a focal handle: the letterboxed frame, the camera
 * resolved at `t`, and the marker radius. All in canvas backing pixels, which is
 * the space renderFrame draws in. The active segment supplies the frame preset
 * and its own zoomPoints so handles land exactly where the composite draws them.
 */
function canvasGeometry(
  canvas: HTMLCanvasElement,
  project: Project,
  t: number,
  isPlaying?: boolean,
) {
  const { seg, srcT } = resolveActive(project, t);
  const paddingPx = (seg.stagePadding ?? 0) * (canvas.height / 1080) * 1.5;
  const rect = frameRect(
    canvas.width,
    canvas.height,
    // The clip the active segment cuts from, so the frame follows whichever
    // one is on screen.
    mediaForSegment(project, seg),
    seg.aspectPreset,
    paddingPx,
  );
  // When paused, zoom out to 100% full scale so all zoom ticks are clearly visible
  const cam = isPlaying === false ? IDENTITY : getProjectCameraTransform(project, t);
  const view = cameraViewport(rect, cam);
  return { rect, view, srcT, radius: Math.max(10, rect.w * 0.014) };
}

/** Pointer position in canvas backing pixels. */
function pointerToCanvas(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const box = canvas.getBoundingClientRect();
  return {
    x: ((clientX - box.left) / box.width) * canvas.width,
    y: ((clientY - box.top) / box.height) * canvas.height,
  };
}

/** Zooms whose handle is on screen: all keyframes when paused, or near playhead when playing. */
function editableZooms(
  project: Project,
  t: number,
  selectedId: string | null,
  selectedSegmentId?: string | null,
  isPlaying?: boolean,
): ZoomPoint[] {
  const { seg, srcT } = resolveActive(project, t);
  const targetSeg = (selectedSegmentId ? project.segments.find((s) => s.id === selectedSegmentId) : null) ?? seg;

  const zoomMap = new Map<string, ZoomPoint>();
  for (const z of [
    ...seg.zoomPoints,
    ...seg.stagedZoomPoints,
    ...targetSeg.zoomPoints,
    ...targetSeg.stagedZoomPoints,
  ]) {
    zoomMap.set(z.id, z);
  }

  // If selectedId is in any segment, include it
  if (selectedId && !zoomMap.has(selectedId)) {
    for (const s of project.segments) {
      for (const z of [...s.zoomPoints, ...s.stagedZoomPoints]) {
        if (z.id === selectedId) zoomMap.set(z.id, z);
      }
    }
  }

  const all = Array.from(zoomMap.values());
  if (isPlaying === false) {
    return all;
  }
  return all.filter(
    (z) => z.id === selectedId || Math.abs(z.t - srcT) <= MARKER_WINDOW,
  );
}
/** The zoom handle under a canvas-space point, topmost (latest) first. */
function hitTestHandle(
  canvas: HTMLCanvasElement,
  project: Project,
  t: number,
  selectedId: string | null,
  px: number,
  py: number,
  selectedSegmentId?: string | null,
  isPlaying?: boolean,
): ZoomPoint | null {
  const { rect, view } = canvasGeometry(canvas, project, t, isPlaying);
  const baseRadius = Math.max(22, Math.round(rect.w * 0.016));
  const grab = baseRadius * 1.8;
  const candidates = editableZooms(project, t, selectedId, selectedSegmentId, isPlaying);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const z = candidates[i]!;
    const zx = z.to?.x ?? 0.5;
    const zy = z.to?.y ?? 0.5;
    const p = frameToCanvas(rect, view, zx * rect.w, zy * rect.h);
    // 1. Hit test circle/puck area
    if (Math.hypot(px - p.x, py - p.y) <= grab) return z;
    // 2. Hit test sequence pill badge (#1 · 2.2x) on the right of the handle
    const badgeW = 90;
    const badgeH = Math.max(22, Math.round(baseRadius * 1.1));
    const badgeX = p.x + baseRadius + 4;
    const badgeY = p.y - badgeH / 2;
    if (px >= badgeX && px <= badgeX + badgeW && py >= badgeY - 4 && py <= badgeY + badgeH + 4) {
      return z;
    }
  }
  return null;
}

/** Hit test for text overlays visible at current timeline time */
function hitTestTextOverlay(
  canvas: HTMLCanvasElement,
  project: Project,
  timelineT: number,
  px: number,
  py: number,
): TextOverlay | null {
  const active = resolveActive(project, timelineT);
  const seg = active.seg;
  const srcT = active.srcT;
  const cw = canvas.width;
  const ch = canvas.height;
  const scale = Math.max(0.5, Math.min(cw / 1920, ch / 1080));

  const all = [...seg.textOverlays, ...seg.stagedTextOverlays];
  // Iterate in reverse (topmost first)
  for (let i = all.length - 1; i >= 0; i--) {
    const to = all[i]!;
    const duration = to.duration != null && to.duration > 0 ? to.duration : 3;
    if (srcT < to.timestamp || srcT > to.timestamp + duration) continue;

    let anchorX = (to.x ?? 0.5) * cw;
    let anchorY = (to.y ?? 0.5) * ch;
    if (to.position === "top" && to.y == null) anchorY = Math.max(60 * scale, 0.1 * ch);
    else if (to.position === "bottom" && to.y == null) anchorY = Math.min(ch - 60 * scale, 0.88 * ch);
    else if (to.position === "center" && to.y == null) anchorY = 0.5 * ch;

    const fontSizePx = Math.max(12, Math.round((to.fontSize ?? 36) * scale));
    const lines = (to.text || "Text").split("\n");
    const lineHeight = fontSizePx * 1.28;
    const totalHeight = Math.max(36 * scale, lines.length * lineHeight);
    const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
    const padX = (to.backgroundPadding ?? 14) * scale;
    const totalWidth = Math.max(80 * scale, maxLineLen * (fontSizePx * 0.65) + padX * 2);

    const left = anchorX - totalWidth / 2 - 24 * scale;
    const right = anchorX + totalWidth / 2 + 24 * scale;
    const top = anchorY - totalHeight / 2 - 20 * scale;
    const bottom = anchorY + totalHeight / 2 + 20 * scale;

    if (px >= left && px <= right && py >= top && py <= bottom) {
      return to;
    }
  }
  return null;
}

/** Draws selection outline and handles around the active text overlay */
function drawTextOverlayHandles(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  selectedTextId: string | null,
  draggingTextId: string | null,
): void {
  if (!selectedTextId && !draggingTextId) return;
  const active = resolveActive(project, t);
  const seg = active.seg;
  const targetId = draggingTextId || selectedTextId;
  const to = [...seg.textOverlays, ...seg.stagedTextOverlays].find((x) => x.id === targetId);
  if (!to) return;
  const duration = to.duration != null && to.duration > 0 ? to.duration : 3;
  if (active.srcT < to.timestamp || active.srcT > to.timestamp + duration) return;

  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const scale = Math.max(0.5, Math.min(cw / 1920, ch / 1080));

  let anchorX = (to.x ?? 0.5) * cw;
  let anchorY = (to.y ?? 0.5) * ch;
  if (to.position === "top" && to.y == null) anchorY = Math.max(60 * scale, 0.1 * ch);
  else if (to.position === "bottom" && to.y == null) anchorY = Math.min(ch - 60 * scale, 0.88 * ch);
  else if (to.position === "center" && to.y == null) anchorY = 0.5 * ch;

  const fontSizePx = Math.max(12, Math.round((to.fontSize ?? 36) * scale));
  const lines = (to.text || "Text").split("\n");
  const lineHeight = fontSizePx * 1.28;
  const totalHeight = Math.max(30 * scale, lines.length * lineHeight);
  const maxLineLen = Math.max(1, ...lines.map((l) => l.length));
  const padX = (to.backgroundPadding ?? 14) * scale;
  const totalWidth = Math.max(60 * scale, maxLineLen * (fontSizePx * 0.6) + padX * 2);

  const boxW = totalWidth + 14 * scale;
  const boxH = totalHeight + 14 * scale;
  const boxX = anchorX - boxW / 2;
  const boxY = anchorY - boxH / 2;

  ctx.save();
  ctx.strokeStyle = to.staged ? "#f59e0b" : "#0070f3";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 6 * scale);
    ctx.stroke();
  } else {
    ctx.strokeRect(boxX, boxY, boxW, boxH);
  }

  // Corner handles
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = to.staged ? "#f59e0b" : "#0070f3";
  ctx.lineWidth = 1.5;
  const handleR = 3.5 * scale;
  const corners: [number, number][] = [
    [boxX, boxY],
    [boxX + boxW, boxY],
    [boxX, boxY + boxH],
    [boxX + boxW, boxY + boxH],
  ];
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, handleR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Group indicator badge
  if (to.kind === "caption") {
    const speakerGroup =
      to.speaker ||
      (to.text?.startsWith("Speaker:")
        ? "Speaker"
        : to.text?.startsWith("Screen:")
        ? "Screen"
        : "Subtitles");
    const badgeText = `${speakerGroup} Captions`;
    const fontPx = Math.max(10, Math.round(11 * scale));
    ctx.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    const textMetrics = ctx.measureText(badgeText);
    const badgeW = textMetrics.width + 12 * scale;
    const badgeH = 18 * scale;
    const badgeX = boxX;
    const badgeY = boxY - badgeH - 4 * scale;

    ctx.fillStyle = to.staged ? "#f59e0b" : "#0070f3";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4 * scale);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(badgeText, badgeX + 6 * scale, badgeY + badgeH / 2);
  }

  ctx.restore();
}

/**
 * Focal handles, drawn on top of the composed frame. Editor-only chrome — it
 * lives here rather than in the engine so exports stay clean.
 */
function drawHandles(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  selectedId: string | null,
  draggingId: string | null,
  selectedSegmentId?: string | null,
  isPlaying?: boolean,
): void {
  const { rect, view } = canvasGeometry(ctx.canvas, project, t, isPlaying);
  const zooms = editableZooms(project, t, selectedId, selectedSegmentId, isPlaying);

  // Chronological sequence index mapping (1, 2, 3...)
  const sortedZooms = zooms.slice().sort((a, b) => a.t - b.t);
  const zoomIndexMap = new Map<string, number>();
  sortedZooms.forEach((zp, idx) => {
    zoomIndexMap.set(zp.id, idx + 1);
  });

  const baseRadius = Math.max(22, Math.round(rect.w * 0.016));

  for (const z of zooms) {
    ctx.save();
    const zx = z.to?.x ?? 0.5;
    const zy = z.to?.y ?? 0.5;
    const p = frameToCanvas(rect, view, zx * rect.w, zy * rect.h);
    const active = z.id === selectedId || z.id === draggingId;
    const isStaged = !!z.staged;
    const seqNum = zoomIndexMap.get(z.id) ?? 1;

    const brandColor = isStaged ? "#f5a623" : "#0070f3"; // Electric Blue
    const r = active ? baseRadius * 1.15 : baseRadius;
    const scaleVal = z.to?.scale ?? 2.2;

    // 1. Magnification crop box & modern corner brackets (Figma / Screen Studio style)
    if (active) {
      const scale = Math.max(1, scaleVal);
      const cropW = rect.w / scale;
      const cropH = rect.h / scale;
      const cropX = Math.max(rect.x, Math.min(rect.x + rect.w - cropW, p.x - cropW / 2));
      const cropY = Math.max(rect.y, Math.min(rect.y + rect.h - cropH, p.y - cropH / 2));

      ctx.save();
      // Dashed boundary
      ctx.strokeStyle = isStaged ? "rgba(245, 166, 35, 0.45)" : "rgba(0, 112, 243, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(cropX, cropY, cropW, cropH, 8);
        ctx.stroke();
      } else {
        ctx.strokeRect(cropX, cropY, cropW, cropH);
      }

      // Sleek Corner Brackets
      const bLen = Math.min(16, cropW * 0.1);
      ctx.strokeStyle = brandColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([]);

      // Top-Left
      ctx.beginPath();
      ctx.moveTo(cropX, cropY + bLen);
      ctx.lineTo(cropX, cropY);
      ctx.lineTo(cropX + bLen, cropY);
      ctx.stroke();

      // Top-Right
      ctx.beginPath();
      ctx.moveTo(cropX + cropW - bLen, cropY);
      ctx.lineTo(cropX + cropW, cropY);
      ctx.lineTo(cropX + cropW, cropY + bLen);
      ctx.stroke();

      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(cropX, cropY + cropH - bLen);
      ctx.lineTo(cropX, cropY + cropH);
      ctx.lineTo(cropX + bLen, cropY + cropH);
      ctx.stroke();

      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(cropX + cropW - bLen, cropY + cropH);
      ctx.lineTo(cropX + cropW, cropY + cropH);
      ctx.lineTo(cropX + cropW, cropY + cropH - bLen);
      ctx.stroke();

      ctx.restore();
    }

    // 2. Soft ambient aura glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = isStaged
      ? "rgba(245, 166, 35, 0.12)"
      : active
        ? "rgba(0, 112, 243, 0.18)"
        : "rgba(0, 112, 243, 0.08)";
    ctx.fill();
    ctx.restore();

    // 3. Crisp Glassmorphic Focal Ring
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;

    // Semi-translucent glass fill
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? "rgba(0, 112, 243, 0.2)" : "rgba(15, 23, 42, 0.4)";
    ctx.fill();

    // Clean outer stroke
    ctx.strokeStyle = active ? "#ffffff" : brandColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Subtle inner accent ring
    ctx.beginPath();
    ctx.arc(p.x, p.y, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = active ? brandColor : "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 4. Center Bullseye Aperture Dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3.5, r * 0.22), 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = brandColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 5. Sequence Number Badge (top-left shoulder of focal ring)
    const seqBadgeR = Math.max(9, Math.round(r * 0.42));
    const seqBadgeX = p.x - r * 0.72;
    const seqBadgeY = p.y - r * 0.72;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;

    ctx.beginPath();
    ctx.arc(seqBadgeX, seqBadgeY, seqBadgeR, 0, Math.PI * 2);
    ctx.fillStyle = brandColor;
    ctx.fill();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(10, Math.round(seqBadgeR * 1.1))}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${seqNum}`, seqBadgeX, seqBadgeY + 0.5);
    ctx.restore();

    // 6. Minimal Modern Pill Badge (#1 · 2.2×)
    const scaleText = `#${seqNum} · ${scaleVal.toFixed(1)}×`;
    const fontSize = Math.max(12, Math.round(r * 0.52));
    ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
    const textW = ctx.measureText(scaleText).width;
    const badgeH = Math.max(20, Math.round(r * 0.95));
    const badgeW = textW + 16;
    const badgeX = p.x + r + 8;
    const badgeY = p.y - badgeH / 2;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 1;

    // Pill background
    ctx.fillStyle = active ? brandColor : "rgba(18, 18, 20, 0.85)";
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, badgeH / 2);
    } else {
      ctx.rect(badgeX, badgeY, badgeW, badgeH);
    }
    ctx.fill();

    // 1px hairline border
    ctx.strokeStyle = active ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Text label
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scaleText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5);

    ctx.restore();
  }
}

function drawFacecamGridGuides(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  fc: Facecam,
) {
  const pipW = canvasW * fc.size;
  const pipH = pipW;

  ctx.save();
  // 3x3 Grid Guidelines:
  // Left, Center, Right columns
  const colX = [0.03 * canvasW, (canvasW - pipW) / 2, canvasW * 0.97 - pipW];
  // Top, Middle, Bottom rows
  const rowY = [0.03 * canvasH, (canvasH - pipH) / 2, canvasH * 0.97 - pipH];

  // Center cross lines
  ctx.strokeStyle = "rgba(0, 112, 243, 0.25)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  ctx.beginPath();
  ctx.moveTo(canvasW / 2, 0);
  ctx.lineTo(canvasW / 2, canvasH);
  ctx.moveTo(0, canvasH / 2);
  ctx.lineTo(canvasW, canvasH / 2);
  ctx.stroke();

  // 9 preset target zones
  for (const gx of colX) {
    for (const gy of rowY) {
      const isCurrentZone =
        Math.abs(fc.x * canvasW - gx) < 14 && Math.abs(fc.y * canvasH - gy) < 14;

      ctx.strokeStyle = isCurrentZone ? "rgba(0, 112, 243, 0.9)" : "rgba(0, 112, 243, 0.22)";
      ctx.fillStyle = isCurrentZone ? "rgba(0, 112, 243, 0.08)" : "transparent";
      ctx.lineWidth = isCurrentZone ? 2 : 1;
      ctx.setLineDash(isCurrentZone ? [] : [3, 3]);

      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(gx, gy, pipW, pipH, fc.shape === "circle" ? pipW / 2 : Math.round(pipW * 0.16));
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.strokeRect(gx, gy, pipW, pipH);
      }
    }
  }

  ctx.restore();
}

export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const facecamAudioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  // Multiclip: the facecam source currently loaded by the engine — keyed on
  // the segment's facecam src, never the media id (two segments can share a
  // clip with different takes).
  const lastFacecamSrcRef = useRef<string | null>(null);

  // Selectors only — a full-store subscription would re-render this component
  // on every currentTime tick during playback.
  const project = useProjectStore((s) => s.project);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const currentTime = useProjectStore((s) => s.currentTime);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const addZoomPoint = useProjectStore((s) => s.addZoomPoint);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const commitDrag = useProjectStore((s) => s.commitDrag);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const setFacecam = useProjectStore((s) => s.setFacecam);
  const selectedTextOverlayId = useProjectStore((s) => s.selectedTextOverlayId);
  const setSelectedTextOverlay = useProjectStore((s) => s.setSelectedTextOverlay);
  const updateTextOverlay = useProjectStore((s) => s.updateTextOverlay);

  // Dragging state — `moved` separates a click-to-select from a real drag.
  const [dragging, setDragging] = useState<{
    id: string;
    moved: boolean;
  } | null>(null);
  const [draggingText, setDraggingText] = useState<string | null>(null);
  const textDragOffset = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const draggingTextRef = useRef<string | null>(null);
  draggingTextRef.current = draggingText;
  const [draggingFacecam, setDraggingFacecam] = useState(false);
  const facecamDragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const pointerDownRef = useRef<{
    clientX: number;
    clientY: number;
    px: number;
    py: number;
    time: number;
    isHit: boolean;
  } | null>(null);
  const lastAddZoomTimeRef = useRef(0);
  const lastDragTimeRef = useRef(0);
  const wasDraggingRef = useRef(false);
  // The rAF loop is built once per clip, so it reads the drag through a ref.
  const draggingIdRef = useRef<string | null>(null);
  draggingIdRef.current = dragging?.id ?? null;
  const draggingFacecamRef = useRef(false);
  draggingFacecamRef.current = draggingFacecam;

  // Toast state (moment mark feedback)
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(null);

  // ── Render loop ──
  // Keyed on whether a clip exists, not on project identity: the loop reads
  // fresh state every tick, so rebuilding it on each edit only churns the rAF.
  const hasProject = project !== null;
  useEffect(() => {
    if (!hasProject || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    let disposed = false;
    // Any store write (edit, seek, playhead tick) or a newly decoded frame
    // means the composite is stale. Idle ticks skip drawing entirely.
    let dirty = true;
    let requestedTime = NaN;
    let decodePending = false;
    const markDirty = () => {
      requestedTime = NaN;
      dirty = true;
    };
    const unsubscribe = useProjectStore.subscribe(markDirty);

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);

      const dt = lastTimeRef.current ? (now - lastTimeRef.current) / 1000 : 0;
      lastTimeRef.current = now;

      const state = useProjectStore.getState();
      if (!state.project) return;

      // An export drives the same decoder frame by frame. Requesting preview
      // frames alongside it would move the decode target out from under the
      // encoder and put the wrong pictures in the file.
      if (state.exportProgress !== null) return;

      // Playback advances on-timeline time in real seconds — the speed is
      // embedded in each segment's width, not multiplied here.
      const duration = projectDuration(state.project);
      if (state.isPlaying) {
        const newTime = state.currentTime + dt;
        if (newTime >= duration) {
          state.pause();
          state.setCurrentTime(duration);
        } else {
          state.setCurrentTime(newTime);
        }
      } else if (!dirty) {
        return;
      }

      dirty = false;
      const tEff = useProjectStore.getState().currentTime;
      const active = resolveActive(state.project, tEff);
      const tSrc = active.srcT;

      // Multiclip: point the decode pipeline at this segment's clip.
      // Idempotent when the segment is cut from the already-active clip.
      const segMedia = mediaForSegment(state.project, active.seg);
      engine
        .activateMedia(active.seg.mediaId ?? FIRST_MEDIA_ID, segMedia?.src ?? null)
        .catch((err) => console.warn("[Preview] activateMedia failed", err));

      // Facecam keying: swap the facecam source only when the segment's take
      // differs (two segments may share a clip with different camera takes).
      const wantFc = active.seg.facecam?.src ?? null;
      if (wantFc !== lastFacecamSrcRef.current) {
        lastFacecamSrcRef.current = wantFc;
        if (wantFc) {
          void (async () => {
            try {
              const blob = await (await fetch(wantFc)).blob();
              await engine.setFacecamBlob(blob);
            } catch {
              /* keep the previous take on failure */
            }
          })();
        } else {
          void engine.setFacecamBlob(null);
        }
      }

      // Audio elements run their own clock — keep rate and volume glued to the
      // active segment's speed, volume, and sources so they cross boundaries in sync.
      if (state.isPlaying) {
        const audio = audioRef.current;
        const fcAudio = facecamAudioRef.current;
        const segMedia = mediaForSegment(state.project, active.seg);
        const screenSrc = segMedia?.src ?? null;
        const fcSrc = active.seg.facecam?.src;

        // Screen audio
        if (audio) {
          if (audio.playbackRate !== active.seg.speed) audio.playbackRate = active.seg.speed;
          const targetVol = Math.max(0, Math.min(1, active.seg.audioVolume ?? 1));
          if (audio.volume !== targetVol) audio.volume = targetVol;
          if (screenSrc && audio.src !== screenSrc) {
            audio.src = screenSrc;
            audio.currentTime = tSrc;
            if (targetVol > 0) audio.play().catch(() => {});
          } else if (audio.paused && targetVol > 0) {
            audio.play().catch(() => {});
          }
        }

        // Facecam mic audio
        if (fcAudio) {
          if (fcAudio.playbackRate !== active.seg.speed) fcAudio.playbackRate = active.seg.speed;
          const targetFcVol = Math.max(0, Math.min(1, active.seg.facecam?.audioVolume ?? 1));
          if (fcAudio.volume !== targetFcVol) fcAudio.volume = targetFcVol;
          if (fcSrc) {
            const fcStartT = active.seg.facecam?.startT ?? 0;
            const targetFc = fcStartT > 0 ? Math.max(0, tEff - fcStartT) : tSrc;
            if (fcAudio.src !== fcSrc) {
              fcAudio.src = fcSrc;
              fcAudio.currentTime = targetFc;
              if (targetFcVol > 0) fcAudio.play().catch(() => {});
            } else if (fcAudio.paused && targetFcVol > 0) {
              fcAudio.play().catch(() => {});
            }
          } else if (!fcAudio.paused) {
            fcAudio.pause();
          }
        }
      }

      // Music/voiceover — wall-clock timeline time via Web Audio. Runs every
      // frame (not just while playing) so a pause stops the sources.
      {
        const audioTracks = state.project?.audioTracks ?? [];
        syncTrackPlayback(tEff, state.isPlaying, audioTracks, trackBufferMap(audioTracks));
      }

      // Don't contend with export's pump — it drives desiredTime at 30fps
      const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
      if (!isExporting && tSrc !== requestedTime) {
        requestedTime = tSrc;
        const seg = active.seg;
        const fcStartT = seg.facecam?.startT ?? 0;
        const fcT = fcStartT > 0 ? Math.max(0, tEff - fcStartT) : tSrc;
        // Coalesced inside the engine — repeat calls only move the decode target.
        // Use prepareAllFrames so cam+screen stay synced at speed
        const pending = (engine as unknown as { prepareAllFrames?: (t: number, fcT?: number) => Promise<void> }).prepareAllFrames
          ? (engine as unknown as { prepareAllFrames: (t: number, fcT?: number) => Promise<void> }).prepareAllFrames(tSrc, fcT)
          : engine.prepareFrame(tSrc);
        // One handler per in-flight decode; during playback the engine hands
        // back the same promise every tick and these would otherwise pile up.
        if (!decodePending) {
          decodePending = true;
          pending.then(
            () => {
              decodePending = false;
              if (!disposed) markDirty();
            },
            (err) => {
              decodePending = false;
              console.error("decode failed", err);
            },
          );
        }
      }
      engine.renderFrame(ctx, state.project, tEff, { isPlaying: state.isPlaying });
      // Editor chrome on top of the composed frame — hidden during playback so
      if (!state.isPlaying) {
        if (draggingFacecamRef.current && active.seg.facecam.src) {
          drawFacecamGridGuides(ctx, ctx.canvas.width, ctx.canvas.height, active.seg.facecam);
        }
        drawHandles(
          ctx,
          state.project,
          tEff,
          state.selectedZoomId,
          draggingIdRef.current,
          state.selectedSegmentId,
          state.isPlaying,
        );
        drawTextOverlayHandles(
          ctx,
          state.project,
          tEff,
          state.selectedTextOverlayId,
          draggingTextRef.current,
        );
      }
    };

    lastTimeRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, [hasProject]);

  // ── Preview audio — sync HTMLAudioElements to canvas time and volume ──
  useEffect(() => {
    const audio = audioRef.current;
    const fcAudio = facecamAudioRef.current;
    if (!project) return;
    const active = resolveActive(project, currentTime);
    const screenSrc = mediaForSegment(project, active.seg)?.src ?? null;
    const fcSrc = active.seg.facecam?.src;

    if (audio && screenSrc) {
      if (audio.src !== screenSrc) {
        audio.src = screenSrc;
        audio.currentTime = active.srcT;
      }
      audio.volume = Math.max(0, Math.min(1, active.seg.audioVolume ?? 1));
      if (isPlaying && audio.paused && audio.volume > 0) {
        audio.play().catch(() => {});
      }
    }

    if (fcAudio) {
      if (fcSrc) {
        const fcStartT = active.seg.facecam?.startT ?? 0;
        const targetFc = fcStartT > 0 ? Math.max(0, currentTime - fcStartT) : active.srcT;
        if (fcAudio.src !== fcSrc) {
          fcAudio.src = fcSrc;
          fcAudio.currentTime = targetFc;
        }
        fcAudio.volume = Math.max(0, Math.min(1, active.seg.facecam?.audioVolume ?? 1));
        if (isPlaying && fcAudio.paused && fcAudio.volume > 0) {
          fcAudio.play().catch(() => {});
        }
      } else if (!fcAudio.paused) {
        fcAudio.pause();
      }
    }
  }, [project?.media[0]?.src, currentTime, isPlaying]);

  // Keep audio elements pitch-preserved
  useEffect(() => {
    const audio = audioRef.current;
    const fcAudio = facecamAudioRef.current;
    if (!project) return;
    const active = resolveActive(project, currentTime);
    [audio, fcAudio].forEach((el) => {
      if (!el) return;
      el.playbackRate = active.seg.speed;
      try { (el as unknown as { preservesPitch: boolean }).preservesPitch = true; } catch { /* ignore */ }
      try { (el as unknown as { mozPreservesPitch: boolean }).mozPreservesPitch = true; } catch { /* ignore */ }
      try { (el as unknown as { webkitPreservesPitch: boolean }).webkitPreservesPitch = true; } catch { /* ignore */ }
    });
  }, [project?.id]);

  // Scrubbing while paused: follow the playhead
  useEffect(() => {
    const audio = audioRef.current;
    const fcAudio = facecamAudioRef.current;
    if (!project || isPlaying) return;
    const { seg, srcT } = resolveActive(project, currentTime);
    const screenSrc = mediaForSegment(project, seg)?.src ?? null;
    const fcSrc = seg.facecam?.src;

    if (audio && screenSrc) {
      if (audio.src !== screenSrc) audio.src = screenSrc;
      if (Math.abs(audio.currentTime - srcT) > 0.15) audio.currentTime = srcT;
      audio.volume = Math.max(0, Math.min(1, seg.audioVolume ?? 1));
    }

    if (fcAudio) {
      if (fcSrc) {
        if (fcAudio.src !== fcSrc) fcAudio.src = fcSrc;
        const fcStartT = seg.facecam?.startT ?? 0;
        const targetFc = fcStartT > 0 ? Math.max(0, currentTime - fcStartT) : srcT;
        if (Math.abs(fcAudio.currentTime - targetFc) > 0.15) fcAudio.currentTime = targetFc;
        fcAudio.volume = Math.max(0, Math.min(1, seg.facecam?.audioVolume ?? 1));
      } else if (!fcAudio.paused) {
        fcAudio.pause();
      }
    }
  }, [currentTime, isPlaying, project]);

  useEffect(() => {
    const audio = audioRef.current;
    const fcAudio = facecamAudioRef.current;
    if (!isPlaying) {
      audio?.pause();
      fcAudio?.pause();
      return;
    }

    // Line the elements up with the playhead before starting
    const state = useProjectStore.getState();
    if (!state.project) return;
    const active = resolveActive(state.project, state.currentTime);
    const screenSrc = mediaForSegment(state.project, active.seg)?.src ?? null;
    const fcSrc = active.seg.facecam?.src;

    if (audio && screenSrc) {
      if (audio.src !== screenSrc) audio.src = screenSrc;
      audio.playbackRate = active.seg.speed;
      audio.volume = Math.max(0, Math.min(1, active.seg.audioVolume ?? 1));
      if (Math.abs(audio.currentTime - active.srcT) > 0.15) audio.currentTime = active.srcT;
      if (audio.volume > 0) audio.play().catch(() => {});
    }

    if (fcAudio && fcSrc) {
      if (fcAudio.src !== fcSrc) fcAudio.src = fcSrc;
      fcAudio.playbackRate = active.seg.speed;
      fcAudio.volume = Math.max(0, Math.min(1, active.seg.facecam?.audioVolume ?? 1));
      const fcStartT = active.seg.facecam?.startT ?? 0;
      const targetFc = fcStartT > 0 ? Math.max(0, state.currentTime - fcStartT) : active.srcT;
      if (Math.abs(fcAudio.currentTime - targetFc) > 0.15) fcAudio.currentTime = targetFc;
      if (fcAudio.volume > 0) fcAudio.play().catch(() => {});
    }

    // Keep clocks aligned
    const id = window.setInterval(() => {
      const st = useProjectStore.getState();
      if (!st.project || !st.isPlaying) return;
      const r = resolveActive(st.project, st.currentTime);
      const curScreenSrc = mediaForSegment(st.project, r.seg)?.src ?? null;
      const curFcSrc = r.seg.facecam?.src;

      if (audio && curScreenSrc) {
        const drift = Math.abs(audio.currentTime - r.srcT);
        if (audio.src !== curScreenSrc) {
          audio.src = curScreenSrc;
          audio.currentTime = r.srcT;
          if (audio.volume > 0) audio.play().catch(() => {});
        } else if (audio.paused && (r.seg.audioVolume ?? 1) > 0) {
          audio.play().catch(() => {});
        } else if (drift > 1.0 && audio.readyState >= 2) {
          audio.currentTime = r.srcT;
        }
        // Drift correction without seek: nudge playbackRate to catch up.
        // Seeking WebM/Opus causes pre-skip glitch → high-freq static.
        const absDrift = r.srcT - audio.currentTime;
        if (Math.abs(absDrift) > 0.35 && Math.abs(absDrift) <= 1.0 && audio.readyState >= 2 && !audio.paused) {
          audio.playbackRate = absDrift > 0 ? 1.03 : 0.97;
        } else {
          audio.playbackRate = r.seg.speed;
        }
        audio.volume = Math.max(0, Math.min(1, r.seg.audioVolume ?? 1));
      }

      if (fcAudio && curFcSrc) {
        const fcStartT = r.seg.facecam?.startT ?? 0;
        const targetFc = fcStartT > 0 ? Math.max(0, st.currentTime - fcStartT) : r.srcT;
        const fcDrift = Math.abs(fcAudio.currentTime - targetFc);
        if (fcAudio.src !== curFcSrc) {
          fcAudio.src = curFcSrc;
          fcAudio.currentTime = targetFc;
          if (fcAudio.volume > 0) fcAudio.play().catch(() => {});
        } else if (fcAudio.paused && (r.seg.facecam?.audioVolume ?? 1) > 0) {
          fcAudio.play().catch(() => {});
        } else if (fcDrift > 1.0 && fcAudio.readyState >= 2) {
          fcAudio.currentTime = targetFc;
        }
        const fcAbsDrift = targetFc - fcAudio.currentTime;
        if (Math.abs(fcAbsDrift) > 0.35 && Math.abs(fcAbsDrift) <= 1.0 && fcAudio.readyState >= 2 && !fcAudio.paused) {
          fcAudio.playbackRate = fcAbsDrift > 0 ? 1.03 : 0.97;
        } else {
          fcAudio.playbackRate = r.seg.speed;
        }
        fcAudio.volume = Math.max(0, Math.min(1, r.seg.facecam?.audioVolume ?? 1));
      }
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying]);

  // Listen for background media ready events (e.g. video decoder ready)
  useEffect(() => {
    const onDirty = () => {
      if (canvasRef.current && project) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) engine.renderFrame(ctx, project, useProjectStore.getState().currentTime);
      }
    };
    window.addEventListener("panoptik:frame-dirty", onDirty);
    return () => window.removeEventListener("panoptik:frame-dirty", onDirty);
  }, [project]);

  // ── Keyboard undo/redo + moment mark (Phase 2.4 + 3.3) ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if (mod && e.key === "y") {
        e.preventDefault();
        redo();
      }
      // Space → play/pause (when not typing in an input)
      if (e.key === " " && !mod && !e.altKey && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
        e.preventDefault();
        useProjectStore.getState().togglePlay();
      }
      // Delete / Backspace key → delete selected zoom point or text overlay
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        !mod &&
        (e.target as HTMLElement).tagName !== "INPUT" &&
        (e.target as HTMLElement).tagName !== "TEXTAREA"
      ) {
        const st = useProjectStore.getState();
        if (st.selectedZoomId) {
          e.preventDefault();
          st.removeZoomPoint(st.selectedZoomId);
          st.setSelectedZoom(null);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast("Zoom deleted");
          toastTimerRef.current = setTimeout(() => setToast(null), 1500);
          return;
        }
        if (st.selectedTextOverlayId) {
          e.preventDefault();
          st.removeTextOverlay(st.selectedTextOverlayId);
          st.setSelectedTextOverlay(null);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast("Text overlay deleted");
          toastTimerRef.current = setTimeout(() => setToast(null), 1500);
          return;
        }
      }
      // M key during playback → mark moment
      if (
        e.key === "m" &&
        !mod &&
        !e.altKey &&
        !e.shiftKey &&
        (e.target as HTMLElement).tagName !== "INPUT" &&
        (e.target as HTMLElement).tagName !== "TEXTAREA"
      ) {
        const st = useProjectStore.getState();
        if (st.project && st.isPlaying) {
          st.markMoment(st.currentTime);
          // Show toast
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(`Moment marked at ${st.currentTime.toFixed(1)}s`);
          toastTimerRef.current = setTimeout(() => setToast(null), 1500);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  // A pending toast timer would call setToast after unmount.
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // ── Click / Drag handling for Zoom handles and Facecam ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying || state.exportProgress !== null) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
      wasDraggingRef.current = false;
      const active = resolveActive(state.project, state.currentTime);

      // 1. Zoom handles hit test FIRST — handles sit visually above everything, including facecam
      const hit = hitTestHandle(
        canvas,
        state.project,
        state.currentTime,
        state.selectedZoomId,
        px,
        py,
        state.selectedSegmentId,
        state.isPlaying,
      );
      if (hit) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
        setSelectedZoom(hit.id);
        setDragging({ id: hit.id, moved: false });
        pointerDownRef.current = { clientX: e.clientX, clientY: e.clientY, px, py, time: performance.now(), isHit: true };
        return;
      }

      // 2. Text overlay hit test SECOND — drag text anywhere on canvas
      const hitText = hitTestTextOverlay(canvas, state.project, state.currentTime, px, py);
      if (hitText) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
        setSelectedTextOverlay(hitText.id);
        const cw = canvas.width;
        const ch = canvas.height;
        const scale = Math.max(0.5, Math.min(cw / 1920, ch / 1080));
        let curAnchorX = (hitText.x ?? 0.5) * cw;
        let curAnchorY = (hitText.y ?? 0.5) * ch;
        if (hitText.position === "top" && hitText.y == null) curAnchorY = Math.max(60 * scale, 0.1 * ch);
        else if (hitText.position === "bottom" && hitText.y == null) curAnchorY = Math.min(ch - 60 * scale, 0.88 * ch);
        else if (hitText.position === "center" && hitText.y == null) curAnchorY = 0.5 * ch;

        textDragOffset.current = {
          id: hitText.id,
          dx: px - curAnchorX,
          dy: py - curAnchorY,
          moved: false,
        };
        setDraggingText(hitText.id);
        pointerDownRef.current = { clientX: e.clientX, clientY: e.clientY, px, py, time: performance.now(), isHit: true };
        return;
      }

      // 3. Facecam hit test third — if not clicking a zoom handle or text overlay over the camera
      const fc = active.seg.facecam;
      if (fc.src) {
        const resolved = resolveInterpolatedFacecam(state.project, state.currentTime, active.seg);
        const cw = canvas.width;
        const ch = canvas.height;
        const pipW = cw * resolved.size;
        const pipH = pipW;
        const fx = cw * resolved.x;
        const fy = ch * resolved.y;
        if (px >= fx && px <= fx + pipW && py >= fy && py <= fy + pipH) {
          e.preventDefault();
          canvas.setPointerCapture(e.pointerId);
          if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
          facecamDragOffset.current = { dx: px - fx, dy: py - fy };
          setDraggingFacecam(true);
          pointerDownRef.current = { clientX: e.clientX, clientY: e.clientY, px, py, time: performance.now(), isHit: true };
          return;
        }
      }

      // 3. Record canvas press on empty space
      pointerDownRef.current = { clientX: e.clientX, clientY: e.clientY, px, py, time: performance.now(), isHit: false };
    },
    [setSelectedZoom, selectSegment],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const state = useProjectStore.getState();
      if (!state.project) return;

      const active = resolveActive(state.project, state.currentTime);

      // Facecam drag — screen space, with 3x3 magnetic grid snapping and clamping
      if (draggingFacecam) {
        wasDraggingRef.current = true;
        const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
        const cw = canvas.width;
        const ch = canvas.height;
        const fc = active.seg.facecam;
        const pipW = cw * fc.size;
        const pipH = pipW;
        const off = facecamDragOffset.current;
        if (!off) return;
        let fx = px - off.dx;
        let fy = py - off.dy;

        // 3x3 Magnetic Snapping (Left, Center, Right & Top, Middle, Bottom)
        const snapThreshold = 18;
        const snapLeft = 0.03 * cw;
        const snapCenterX = (cw - pipW) / 2;
        const snapRight = cw * 0.97 - pipW;

        if (Math.abs(fx - snapLeft) < snapThreshold) fx = snapLeft;
        else if (Math.abs(fx - snapCenterX) < snapThreshold) fx = snapCenterX;
        else if (Math.abs(fx - snapRight) < snapThreshold) fx = snapRight;

        const snapTop = 0.03 * ch;
        const snapCenterY = (ch - pipH) / 2;
        const snapBottom = ch * 0.97 - pipH;

        if (Math.abs(fy - snapTop) < snapThreshold) fy = snapTop;
        else if (Math.abs(fy - snapCenterY) < snapThreshold) fy = snapCenterY;
        else if (Math.abs(fy - snapBottom) < snapThreshold) fy = snapBottom;

        const clampedX = Math.max(0, Math.min(cw - pipW, fx));
        const clampedY = Math.max(0, Math.min(ch - pipH, fy));
        setFacecam({ x: clampedX / cw, y: clampedY / ch });
        return;
      }

      if (dragging) {
        wasDraggingRef.current = true;
        const zoom =
          active.seg.zoomPoints.find((z) => z.id === dragging.id) ??
          active.seg.stagedZoomPoints.find((z) => z.id === dragging.id);
        if (!zoom) return;

        const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
        const { rect, view } = canvasGeometry(canvas, state.project, state.currentTime, state.isPlaying);
        const f = canvasToFrame(rect, view, px, py);
        // Keep the zoom's own depth — only the focal point moves.
        updateZoomPoint(dragging.id, {
          to: {
            scale: zoom.to.scale,
            x: clamp01(f.x / rect.w),
            y: clamp01(f.y / rect.h),
          },
        });
        if (!dragging.moved) setDragging({ ...dragging, moved: true });
        return;
      }

      // Text overlay drag on canvas
      const toff = textDragOffset.current;
      if (toff) {
        wasDraggingRef.current = true;
        toff.moved = true;
        const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
        const cw = canvas.width;
        const ch = canvas.height;
        const newX = Math.max(0.02, Math.min(0.98, (px - toff.dx) / cw));
        const newY = Math.max(0.02, Math.min(0.98, (py - toff.dy) / ch));
        updateTextOverlay(toff.id, {
          position: "custom",
          x: Number(newX.toFixed(3)),
          y: Number(newY.toFixed(3)),
        });
        return;
      }

      // Hover affordance: zoom grab beats facecam grab beats crosshair
      if (!state.isPlaying) {
        const { x: hx, y: hy } = pointerToCanvas(canvas, e.clientX, e.clientY);
        const over = hitTestHandle(
          canvas,
          state.project,
          state.currentTime,
          state.selectedZoomId,
          hx,
          hy,
          state.selectedSegmentId,
          state.isPlaying,
        );
        if (over) {
          canvas.style.cursor = "grab";
          return;
        }

        const overText = hitTestTextOverlay(canvas, state.project, state.currentTime, hx, hy);
        if (overText) {
          canvas.style.cursor = "grab";
          return;
        }

        const fc = active.seg.facecam;
        if (fc.src) {
          const resolved = resolveInterpolatedFacecam(state.project, state.currentTime, active.seg);
          const cw = canvas.width;
          const ch = canvas.height;
          const pipW = cw * resolved.size;
          const pipH = pipW;
          const fx = cw * resolved.x;
          const fy = ch * resolved.y;
          if (hx >= fx && hx <= fx + pipW && hy >= fy && hy <= fy + pipH) {
            canvas.style.cursor = "grab";
            return;
          }
        }
        canvas.style.cursor = "crosshair";
      }
    },
    [dragging, draggingFacecam, updateZoomPoint, setFacecam],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const toff = textDragOffset.current;
      if (toff) {
        if (toff.moved) {
          commitDrag();
        }
        textDragOffset.current = null;
        setDraggingText(null);
        lastDragTimeRef.current = performance.now();
        pointerDownRef.current = null;
        return;
      }
      if (draggingFacecam) {
        setDraggingFacecam(false);
        facecamDragOffset.current = null;
        commitDrag();
        lastDragTimeRef.current = performance.now();
        pointerDownRef.current = null;
        return;
      }
      if (dragging) {
        if (dragging.moved) {
          commitDrag();
        }
        setDragging(null);
        lastDragTimeRef.current = performance.now();
        pointerDownRef.current = null;
        return;
      }

      pointerDownRef.current = null;
    },
    [dragging, draggingFacecam, commitDrag],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      // Guard against drag completion or rapid double click
      if (wasDraggingRef.current) return;
      if (performance.now() - lastDragTimeRef.current < 400) return;
      if (performance.now() - lastAddZoomTimeRef.current < 400) return;
      if (textDragOffset.current) return;

      const state = useProjectStore.getState();
      if (!state.project || state.isPlaying || state.exportProgress !== null) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: px, y: py } = pointerToCanvas(canvas, e.clientX, e.clientY);
      const t = state.currentTime;
      const active = resolveActive(state.project, t);

      // Check if press landed on a known hit element (zoom, facecam, or text overlay)
      if (pointerDownRef.current?.isHit) {
        pointerDownRef.current = null;
        return;
      }

      // Check if click landed on facecam — if so, select segment and NEVER add zoom
      const fc = active.seg.facecam;
      if (fc.src) {
        const resolved = resolveInterpolatedFacecam(state.project, t, active.seg);
        const cw = canvas.width;
        const ch = canvas.height;
        const pipW = cw * resolved.size;
        const pipH = pipW;
        const fx = cw * resolved.x;
        const fy = ch * resolved.y;
        if (px >= fx && px <= fx + pipW && py >= fy && py <= fy + pipH) {
          if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
          return;
        }
      }

      // Check if click landed on a zoom handle — if so, select it and do not add zoom
      const hit = hitTestHandle(
        canvas,
        state.project,
        t,
        state.selectedZoomId,
        px,
        py,
        state.selectedSegmentId,
        state.isPlaying,
      );
      if (hit) {
        if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
        setSelectedZoom(hit.id);
        return;
      }

      // Check if click landed on a text overlay
      const hitText = hitTestTextOverlay(canvas, state.project, t, px, py);
      if (hitText) {
        if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
        setSelectedTextOverlay(hitText.id);
        return;
      }

      // Check if click landed within the video frame rect (ignore background padding clicks)
      const { rect, view } = canvasGeometry(canvas, state.project, t, state.isPlaying);
      if (px < rect.x || px > rect.x + rect.w || py < rect.y || py > rect.y + rect.h) {
        return;
      }

      const f = canvasToFrame(rect, view, px, py);
      if (active.seg.id !== state.selectedSegmentId) selectSegment(active.seg.id);
      lastAddZoomTimeRef.current = performance.now();
      addZoomPoint({
        t: active.srcT,
        to: {
          scale: DEFAULT_ZOOM_SCALE,
          x: clamp01(f.x / rect.w),
          y: clamp01(f.y / rect.h),
        },
        dur: 0.7,
        hold: 2.0,
        ease: "easeInOutCubic",
      });
    },
    [addZoomPoint, setSelectedZoom, selectSegment],
  );

  // ── Canvas sizing ──
  const [canvasSize, setCanvasSize] = useState({
    w: 1920,
    h: 1080,
  });

  const activePreset =
    project?.segments.find((s) => s.id === selectedSegmentId)?.aspectPreset ??
    project?.segments[0]?.aspectPreset ??
    "source";

  useEffect(() => {
    if (!project) return;
    // Multiclip: size to the active segment's clip, not media[0].
    const activeSeg = resolveSegment(project, useProjectStore.getState().currentTime)?.segment;
    const sizeMedia = activeSeg ? mediaForSegment(project, activeSeg) : null;
    const size = outputSize(
      sizeMedia ?? primaryMedia(project),
      activePreset,
      MAX_CANVAS_WIDTH,
    );
    setCanvasSize((prev) => {
      if (prev.w === size.width && prev.h === size.height) return prev;
      return { w: size.width, h: size.height };
    });
  }, [project?.media[0]?.width, project?.media[0]?.height, activePreset]);

  // Redraw when canvas dimensions change
  useEffect(() => {
    if (canvasRef.current && project) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) {
        engine.renderFrame(ctx, project, useProjectStore.getState().currentTime);
      }
    }
  }, [canvasSize.w, canvasSize.h, project?.id]);

  // ── Drop + click-to-import ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("video/")) {
        const proj = await engine.loadClip(file);
        useProjectStore.getState().setProject(proj);
      }
    },
    [],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleFilePick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("video/")) {
      const proj = await engine.loadClip(file);
      useProjectStore.getState().setProject(proj);
    }
    // reset so same file can be picked again
    e.target.value = "";
  }, []);

  // renderFrame draws image backgrounds synchronously from a decoded cache, so
  // a newly chosen image has to be decoded before the next paint, or the stage
  // shows the placeholder fill instead. Must sit above the early return below:
  // as a conditional hook it changed the hook count between renders.
  const bgImageKey = (project?.segments ?? [])
    .map((sg) => (sg.background.kind === "image" ? sg.background.src : ""))
    .filter(Boolean)
    .join("|");
  useEffect(() => {
    if (!bgImageKey) return;
    const current = useProjectStore.getState().project;
    if (!current) return;
    let cancelled = false;
    ensureBackgroundImages(current).then(() => {
      // Repaint once decoding finishes; without this the frame that triggered
      // the load keeps the placeholder fill it drew.
      if (cancelled || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) engine.renderFrame(ctx, current, useProjectStore.getState().currentTime);
    });
    return () => {
      cancelled = true;
    };
  }, [bgImageKey]);

  if (!project) {
    return (
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center p-8 bg-vercel-mesh"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFilePick} />
        <div
          className="pk-card relative flex w-full max-w-[520px] flex-col items-center px-10 py-12 text-center transition-all"
          style={{
            borderColor: isDragOver ? "#0070f3" : "#ebebeb",
            borderStyle: isDragOver ? "solid" : "dashed",
            borderWidth: 2,
            transform: isDragOver ? "scale(1.01)" : undefined,
            boxShadow: isDragOver
              ? "0 12px 40px rgba(0,112,243,0.16)"
              : "0 2px 12px rgba(0,0,0,0.04)",
          }}
        >
          {/* Soft halo, echoing the homepage hero. */}
          <div
            className="pointer-events-none absolute -top-20 left-1/2 h-44 w-[420px] -translate-x-1/2 rounded-full blur-3xl"
            style={{ background: "linear-gradient(90deg, #007cf0 0%, #7928ca 45%, #ff0080 85%)", opacity: isDragOver ? 0.16 : 0.07 }}
          />

          <div
            className="mb-6 flex h-14 w-14 items-center justify-center rounded-[16px] transition-colors"
            style={{ background: isDragOver ? "#0070f3" : "#1f1f1f", color: "#fff" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </div>

          <h3 className="pk-ui" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, color: "#1a1a1a" }}>
            Drop a video to <span className="pk-accent">begin</span>
          </h3>
          <p className="pk-help mt-2.5 max-w-[38ch]" style={{ fontSize: 14, lineHeight: 1.55 }}>
            MP4, WebM or MOV. Everything renders in your browser — no upload, no server.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
            <button onClick={() => fileInputRef.current?.click()} className="pk-btn pk-btn-primary pk-btn-lg">
              <span className="flex h-5 w-5 items-center justify-center rounded-md text-[15px] leading-none" style={{ background: "rgba(255,255,255,0.16)" }}>+</span>
              Browse video
            </button>
            <button onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))} className="pk-btn pk-btn-ghost pk-btn-lg">
              <span className="h-2 w-2 rounded-full" style={{ background: "#e11d48" }} />
              Record instead
            </button>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-1.5">
            <span className="pk-chip">MP4</span>
            <span className="pk-chip">WebM</span>
            <span className="pk-chip">MOV</span>
            <span className="pk-chip" style={{ background: "transparent", borderColor: "transparent" }}>up to 4K</span>
          </div>
        </div>
      </div>
    );
  }

  // The stage shows the ACTIVE segment's background and padding — as playback
  // crosses into another segment the surroundings follow it.
  const activeSeg = resolveActive(project, currentTime).seg;


  const stageStyle = (() => {
    const bg = activeSeg.background;
    if (bg.kind === "gradient") {
      const [a, b] = bg.stops;
      return { background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` };
    }
    if (bg.kind === "solid") return { background: bg.color };
    if (bg.kind === "image") {
      // The surround mirrors what the canvas draws, so the padding around the
      // video does not fall back to an unrelated gradient.
      return {
        backgroundImage: `url("${bg.src}")`,
        backgroundSize: bg.fit === "contain" ? "contain" : "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#111827",
      };
    }
    return { background: "linear-gradient(135deg, #007cf0 0%, #7928ca 45%, #ff4d4d 100%)" };
  })();

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center p-6 bg-[#fafafa]"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Vercel mesh halo behind stage */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ background: "radial-gradient(700px 420px at 50% 38%, rgba(0,124,240,0.18) 0%, transparent 60%), radial-gradient(560px 360px at 82% 78%, rgba(255,0,128,0.12) 0%, transparent 62%)" }} />
      {/* Stage canvas wrapper — WYSIWYG preview matching exported video */}
      <div
        /*
         * Sized against this container, not the viewport.
         *
         * It used to be measured in vh/vw, but the preview only owns what is
         * left after the toolbar and the timeline — and the timeline is
         * draggable. Pulled to its full height the stage still claimed ~64vh
         * and slid underneath the chrome. aspect-ratio plus max-h/max-w full
         * lets the browser fit it to whatever space there actually is, so it
         * tracks timeline drags and window resizes with no measuring code.
         */
        /*
         * The rounding here is editor chrome, not part of the video — a hard
         * rectangle looks unfinished on the stage. Kept deliberately small so
         * it reads as the frame of the preview rather than as the shape of the
         * output: the real outer corner is Segment.outerRadius, which the
         * renderer draws into the canvas and the exported file carries.
         */
        className="relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-xl border shadow-vercel-4 transition-all"
        style={{
          borderColor: "rgba(0,0,0,0.08)",
          aspectRatio: `${canvasSize.w} / ${canvasSize.h}`,
          boxShadow: "0 20px 48px rgba(0,0,0,0.14)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          className="block h-full w-full cursor-crosshair object-contain"
          onClick={handleCanvasClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      </div>
      {/* Hidden audio elements for preview — screen audio + camera mic audio */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="auto" className="hidden" crossOrigin="anonymous" />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={facecamAudioRef} preload="auto" className="hidden" crossOrigin="anonymous" />
      {toast && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full border bg-[#171717] px-3.5 py-1.5 text-xs font-medium text-white shadow-vercel-5" style={{ borderColor: "#2a2a2a" }}>
          {toast}
        </div>
      )}
    </div>
  );
}
