/**
 * Camera transform (sequential fold, ignores staged points) + renderFrame
 * composition pipeline (background → letterboxed zoomed frame → facecam PiP →
 * text overlays; staged text drawn amber #f59e0b).
 * Keyframe semantics: at k.t ease FROM current state TO k.to over k.dur, then hold.
 */
import { EASINGS, easeInCubic, easeInOutCubic, easeOutCubic, lerp } from "@panoptik/utils";
import type {
  Background,
  Facecam,
  Project,
  Segment,
  VideoTransition,
  ZoomPoint,
} from "@panoptik/schema";
import { mediaForSegment, primaryMedia } from "@panoptik/schema";
import type { Rect } from "./layout";
import { frameRect } from "./layout";
import { resolveSegment, segmentDuration } from "./timeline";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

function evalZoomPoint(k: ZoomPoint, startState: Transform, tau: number): Transform {
  const dur = Math.max(k.dur, 0.001);
  const hold = k.hold ?? 2.0;
  const inEnd = k.t + dur;
  const holdEnd = inEnd + hold;
  const ease = EASINGS[k.ease] ?? easeInOutCubic;

  if (tau <= k.t) return startState;
  if (tau < inEnd) {
    const p = Math.max(0, Math.min(1, (tau - k.t) / dur));
    const e = ease(p);
    return {
      scale: lerp(startState.scale, k.to.scale, e),
      x: lerp(startState.x, k.to.x, e),
      y: lerp(startState.y, k.to.y, e),
    };
  }
  if (tau < holdEnd) {
    return k.to;
  }
  // ease out towards IDENTITY
  const p = Math.max(0, Math.min(1, (tau - holdEnd) / dur));
  const e = ease(p);
  return {
    scale: lerp(k.to.scale, IDENTITY.scale, e),
    x: lerp(k.to.x, IDENTITY.x, e),
    y: lerp(k.to.y, IDENTITY.y, e),
  };
}

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  const active = points
    .filter((p) => !p.staged)
    .slice()
    .sort((a, b) => a.t - b.t);

  if (active.length === 0) return IDENTITY;

  // Compute the seamless starting transform for each active keyframe
  // (if keyframe k_i starts while k_{i-1} is still active in its zone, k_i starts from k_{i-1}'s state)
  const startStates: Transform[] = [];
  const outEnds: number[] = [];

  for (let i = 0; i < active.length; i++) {
    const k = active[i]!;
    const dur = Math.max(k.dur, 0.001);
    const hold = k.hold ?? 2.0;
    const outEnd = k.t + dur * 2 + hold;
    outEnds.push(outEnd);

    if (i === 0) {
      startStates.push(IDENTITY);
    } else {
      const prevOutEnd = outEnds[i - 1]!;
      if (k.t < prevOutEnd) {
        // Overlapping with previous zoom zone: transition smoothly from previous state
        const stateAtKStart = evalZoomPoint(active[i - 1]!, startStates[i - 1]!, k.t);
        startStates.push(stateAtKStart);
      } else {
        startStates.push(IDENTITY);
      }
    }
  }

  // Find the active zoom point governing time t
  // If multiple points overlap, the latest point that has already begun (k.t <= t) takes precedence
  let chosenIdx = -1;
  for (let i = active.length - 1; i >= 0; i--) {
    const k = active[i]!;
    if (t >= k.t && t < outEnds[i]!) {
      chosenIdx = i;
      break;
    }
  }

  if (chosenIdx === -1) {
    return IDENTITY;
  }

  const chosen = active[chosenIdx]!;
  const startState = startStates[chosenIdx]!;
  return evalZoomPoint(chosen, startState, t);
}

// Alias for spec naming — same deterministic function
export const getCameraStateAtTime = getCameraTransform;

/**
 * Resolves camera zoom & pan transforms globally across the entire project timeline.
 * Converts segment-relative source keyframes into on-timeline time so that zooms spanning
 * or overlapping across multiple clip cuts continue smoothly across clip boundaries.
 */
export function getProjectCameraTransform(project: Project, timelineT: number): Transform {
  let segStart = 0;
  const allTimelinePoints: ZoomPoint[] = [];

  for (const seg of project.segments) {
    const d = segmentDuration(seg);
    for (const zp of seg.zoomPoints) {
      if (zp.staged) continue;
      const speed = Math.max(0.1, seg.speed);
      const durTimeline = Math.max(zp.dur, 0.001) / speed;
      const holdTimeline = (zp.hold ?? 2.0) / speed;
      const tTimeline = segStart + (zp.t - seg.srcStart) / speed;
      allTimelinePoints.push({
        ...zp,
        t: tTimeline,
        dur: durTimeline,
        hold: holdTimeline,
      });
    }
    segStart += d;
  }

  if (allTimelinePoints.length === 0) return IDENTITY;
  return getCameraTransform(allTimelinePoints, timelineT);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export type Viewport = {
  /** Magnification actually applied, never below 1. */
  scale: number;
  /** Focal point in FRAME space, clamped so the view never leaves the frame. */
  cx: number;
  cy: number;
};

/**
 * Resolve a camera transform against a frame rect: the focal point lands at the
 * centre of the frame magnified by `scale`, pulled back just far enough that the
 * visible window stays inside the frame (no empty edges).
 */
export function cameraViewport(
  rect: { w: number; h: number },
  cam: Transform,
): Viewport {
  const scale = Math.max(1, cam.scale);
  const viewW = rect.w / scale;
  const viewH = rect.h / scale;
  return {
    scale,
    cx: clamp(cam.x * rect.w, viewW / 2, rect.w - viewW / 2),
    cy: clamp(cam.y * rect.h, viewH / 2, rect.h - viewH / 2),
  };
}

/** Frame-space point → canvas x, under the camera. Inverse of {@link canvasToFrame}. */
export function frameToCanvas(
  rect: { x: number; y: number; w: number; h: number },
  view: Viewport,
  fx: number,
  fy: number,
): { x: number; y: number } {
  return {
    x: rect.x + rect.w / 2 + (fx - view.cx) * view.scale,
    y: rect.y + rect.h / 2 + (fy - view.cy) * view.scale,
  };
}

/** Canvas point → frame-space, under the camera. Inverse of {@link frameToCanvas}. */
export function canvasToFrame(
  rect: { x: number; y: number; w: number; h: number },
  view: Viewport,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: view.cx + (px - rect.x - rect.w / 2) / view.scale,
    y: view.cy + (py - rect.y - rect.h / 2) / view.scale,
  };
}

// ── Decoded frame cache (set by decode.ts via setCurrentFrame) ──
let currentFrame: CanvasImageSource | null = null;

export function setCurrentFrame(frame: CanvasImageSource | null) {
  currentFrame = frame;
}

// Screen debug — enable via localStorage.setItem("panoptik:debugScreen","1")
let screenRenderFrames = 0;
let screenRenderLastLog = 0;
let screenRenderNoFrame = 0;

export function getCurrentFrame(): CanvasImageSource | null {
  return currentFrame;
}

export type RenderOptions = {
  isPlaying?: boolean;
  cameraOverride?: Transform;
};

/**
 * 4-layer synchronous composition. Preview and export share this exact codepath.
 * Layer order: background → frame (zoomed) → facecam PiP → text.
 * `timelineT` is ON-TIMELINE time: it is resolved to the active segment and its
 * source time, falling back to the last segment at media.duration when out of range.
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  timelineT: number,
  options?: RenderOptions,
): void {
  const r = resolveSegment(project, timelineT);
  const seg = r?.segment ?? project.segments[project.segments.length - 1];
  const srcT = r ? r.srcT : primaryMedia(project).duration;
  if (!seg) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (!currentFrame) screenRenderNoFrame++;

  // ── Layer 1: Background ──
  drawBackground(ctx, seg.background, w, h);

  // ── Layer 2: Letterboxed frame with camera zoom & screen video transition ──
  // The clip this segment cuts from — with several clips on the timeline the
  // frame rect follows whichever one is on screen.
  const media = mediaForSegment(project, seg);
  const paddingPx = (seg.stagePadding ?? 0) * (h / 1080) * 1.5;
  const rect = frameRect(w, h, media, seg.aspectPreset, paddingPx);
  const trans = resolveVideoTransition(project, timelineT, seg, w, h);

  if (currentFrame) {
    const camTransform =
      options?.cameraOverride ??
      (options?.isPlaying === false
        ? IDENTITY
        : getProjectCameraTransform(project, timelineT));
    const view = cameraViewport(rect, camTransform);
    ctx.save();

    if (trans.active) {
      ctx.globalAlpha = trans.opacity;
    }

    // Clip with rounded corners when padded, or standard rect (with horizontal wipe support)
    ctx.beginPath();
    const cornerRadius = frameCornerRadius(seg, rect, h);
    const clipW = trans.active && trans.wipeProgress < 1 ? rect.w * trans.wipeProgress : rect.w;
    if (cornerRadius > 0 && typeof ctx.roundRect === "function") {
      ctx.roundRect(rect.x, rect.y, clipW, rect.h, cornerRadius);
    } else {
      ctx.rect(rect.x, rect.y, clipW, rect.h);
    }
    ctx.clip();

    if (trans.active) {
      if (trans.offsetX !== 0 || trans.offsetY !== 0) {
        ctx.translate(trans.offsetX, trans.offsetY);
      }
      if (trans.scale !== 1) {
        ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
        ctx.scale(trans.scale, trans.scale);
        ctx.translate(-(rect.x + rect.w / 2), -(rect.y + rect.h / 2));
      }
    }

    // Put the focal point at the centre of the frame, magnified by scale.
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(view.scale, view.scale);
    ctx.translate(-(rect.x + view.cx), -(rect.y + view.cy));
    ctx.drawImage(currentFrame, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();

    if (trans.active && trans.dipAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = trans.dipAlpha;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  } else {
    // No decoded frame yet — draw a dark placeholder inside the frame rect
    ctx.save();
    if (trans.active) {
      ctx.globalAlpha = trans.opacity;
    }
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  // ── Layer 3: Facecam PiP (screen space, smoothly animated across segment transitions) ──
  const resolvedFc = resolveInterpolatedFacecam(project, timelineT, seg);
  drawFacecam(ctx, seg.facecam, srcT, w, h, resolvedFc, options?.isPlaying, seg.speed);

  // ── Layer 4: Text overlays ──
  drawTextOverlays(ctx, seg, srcT, w, h);

  // ── Layer 5: Outer corner rounding ──
  //
  // Applied last, over everything, because it shapes the frame itself rather
  // than any one layer. Video has no alpha channel, so the area outside the
  // curve is filled black rather than left transparent — an encoder would
  // otherwise composite it against whatever it felt like.
  const outer = outerCornerRadius(seg, w, h);
  if (outer > 0 && typeof ctx.roundRect === "function") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, outer);
    ctx.fill();
    // Put an opaque backdrop behind what survived, so the corners read as
    // black in the file instead of undefined alpha.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

export type ResolvedVideoTransition = {
  active: boolean;
  type: VideoTransition;
  progress: number;
  eased: number;
  opacity: number;
  dipAlpha: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  wipeProgress: number;
};

export function resolveVideoTransition(
  project: Project,
  timelineT: number,
  seg: Segment,
  canvasW: number,
  canvasH: number,
): ResolvedVideoTransition {
  const defaultRes: ResolvedVideoTransition = {
    active: false,
    type: "cut",
    progress: 1,
    eased: 1,
    opacity: 1,
    dipAlpha: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    wipeProgress: 1,
  };

  const segIdx = project.segments.findIndex((s) => s.id === seg.id);
  if (segIdx < 0) return defaultRes;

  let segStartT = 0;
  for (let i = 0; i < segIdx; i++) {
    segStartT += segmentDuration(project.segments[i]!);
  }
  const segEndT = segStartT + segmentDuration(seg);

  // 1. Incoming Transition (at start of seg, from previous segment)
  if (segIdx > 0) {
    const transitionType = seg.transition ?? "cut";
    if (transitionType !== "cut") {
      const dur = Math.max(0.05, seg.transitionDuration ?? 0.45);
      const half = dur / 2;
      const timeInPhase = timelineT - segStartT;
      if (timeInPhase >= 0 && timeInPhase <= half) {
        // Second half of the transition (0.5 -> 1.0)
        const tPhase = Math.max(0, Math.min(1, timeInPhase / half));
        const progress = 0.5 + 0.5 * tPhase;
        const easedOut = easeOutCubic(tPhase);
        const easedInOut = easeInOutCubic(progress);

        let opacity = 1;
        let dipAlpha = 0;
        let offsetX = 0;
        let offsetY = 0;
        let scale = 1;
        let wipeProgress = 1;

        switch (transitionType) {
          case "fade":
            opacity = easedOut;
            break;
          case "dipToBlack":
            dipAlpha = 1 - easedOut;
            opacity = 0.5 + 0.5 * easedOut;
            break;
          case "slide-left":
            offsetX = (1 - easedOut) * canvasW * 0.5;
            opacity = 0.6 + 0.4 * easedOut;
            break;
          case "slide-right":
            offsetX = -(1 - easedOut) * canvasW * 0.5;
            opacity = 0.6 + 0.4 * easedOut;
            break;
          case "zoom-in":
            scale = 0.92 + 0.08 * easedOut;
            opacity = 0.5 + 0.5 * easedOut;
            break;
          case "wipe":
            wipeProgress = 0.5 + 0.5 * easedInOut;
            break;
        }

        return {
          active: true,
          type: transitionType,
          progress,
          eased: easedInOut,
          opacity: Math.max(0, Math.min(1, opacity)),
          dipAlpha: Math.max(0, Math.min(1, dipAlpha)),
          offsetX,
          offsetY,
          scale,
          wipeProgress: Math.max(0, Math.min(1, wipeProgress)),
        };
      }
    }
  }

  // 2. Outgoing Transition (at end of seg, transitioning toward next segment)
  if (segIdx < project.segments.length - 1) {
    const nextSeg = project.segments[segIdx + 1]!;
    const transitionType = nextSeg.transition ?? "cut";
    if (transitionType !== "cut") {
      const dur = Math.max(0.05, nextSeg.transitionDuration ?? 0.45);
      const half = dur / 2;
      const timeToBoundary = segEndT - timelineT;
      if (timeToBoundary >= 0 && timeToBoundary <= half) {
        // First half of the transition (0.0 -> 0.5)
        const tPhase = Math.max(0, Math.min(1, (half - timeToBoundary) / half));
        const progress = 0.5 * tPhase;
        const easedIn = easeInCubic(tPhase);
        const easedInOut = easeInOutCubic(progress);

        let opacity = 1;
        let dipAlpha = 0;
        let offsetX = 0;
        let offsetY = 0;
        let scale = 1;
        let wipeProgress = 1;

        switch (transitionType) {
          case "fade":
            opacity = 1 - easedIn;
            break;
          case "dipToBlack":
            dipAlpha = easedIn;
            opacity = 1 - 0.5 * easedIn;
            break;
          case "slide-left":
            offsetX = -easedIn * canvasW * 0.5;
            opacity = 1 - 0.4 * easedIn;
            break;
          case "slide-right":
            offsetX = easedIn * canvasW * 0.5;
            opacity = 1 - 0.4 * easedIn;
            break;
          case "zoom-in":
            scale = 1 + 0.08 * easedIn;
            opacity = 1 - 0.5 * easedIn;
            break;
          case "wipe":
            wipeProgress = 1 - 0.5 * easedInOut;
            break;
        }

        return {
          active: true,
          type: transitionType,
          progress,
          eased: easedInOut,
          opacity: Math.max(0, Math.min(1, opacity)),
          dipAlpha: Math.max(0, Math.min(1, dipAlpha)),
          offsetX,
          offsetY,
          scale,
          wipeProgress: Math.max(0, Math.min(1, wipeProgress)),
        };
      }
    }
  }

  return defaultRes;
}

export function resolveInterpolatedFacecam(
  project: Project,
  timelineT: number,
  seg: Segment,
): {
  x: number;
  y: number;
  size: number;
  shape: "circle" | "square";
  shapeProgress: number;
  opacity: number;
} {
  const current = seg.facecam;
  const shape = current.shape === "circle" ? "circle" : "square";
  const defaultProgress = shape === "circle" ? 1 : 0;
  if (!current.src) {
    return { x: current.x, y: current.y, size: 0, shape, shapeProgress: defaultProgress, opacity: 0 };
  }

  const segIdx = project.segments.findIndex((s) => s.id === seg.id);
  if (segIdx < 0) {
    return { x: current.x, y: current.y, size: current.size, shape, shapeProgress: defaultProgress, opacity: 1 };
  }

  let segStartT = 0;
  for (let i = 0; i < segIdx; i++) {
    segStartT += segmentDuration(project.segments[i]!);
  }
  const segEndT = segStartT + segmentDuration(seg);

  // 1. Incoming Facecam Transition (at start of seg, from prevSeg)
  if (segIdx > 0) {
    const prevSeg = project.segments[segIdx - 1]!;
    const transitionType = current.transition ?? "smooth";
    if (transitionType !== "cut") {
      const dur = Math.max(0.05, current.transitionDuration ?? 0.45);
      const half = dur / 2;
      const timeInPhase = timelineT - segStartT;
      if (timeInPhase >= 0 && timeInPhase <= half) {
        // Second half of transition (0.5 -> 1.0)
        const tPhase = Math.max(0, Math.min(1, timeInPhase / half));
        const progress = 0.5 + 0.5 * tPhase;

        if (!prevSeg.facecam.src) {
          const eased = easeOutCubic(progress);
          return {
            x: current.x,
            y: current.y,
            size: current.size * eased,
            shape,
            shapeProgress: defaultProgress,
            opacity: eased,
          };
        }

        let eased = easeInOutCubic(progress);
        if (transitionType === "spring") {
          eased = 1 + Math.sin(progress * Math.PI * 1.5) * Math.pow(1 - progress, 2) * 0.35;
        } else if (transitionType === "slide") {
          eased = easeOutCubic(progress);
        }

        const prev = prevSeg.facecam;
        const prevProgress = (prev.shape ?? "square") === "circle" ? 1 : 0;
        const currProgress = (current.shape ?? "square") === "circle" ? 1 : 0;
        const shapeProgress = Math.max(0, Math.min(1, prevProgress + (currProgress - prevProgress) * eased));

        return {
          x: prev.x + (current.x - prev.x) * eased,
          y: prev.y + (current.y - prev.y) * eased,
          size: Math.max(0.01, prev.size + (current.size - prev.size) * eased),
          shape,
          shapeProgress,
          opacity: transitionType === "fade" ? 0.3 + 0.7 * eased : 1,
        };
      }
    }
  }

  // 2. Outgoing Facecam Transition (at end of seg, transitioning into nextSeg)
  if (segIdx < project.segments.length - 1) {
    const nextSeg = project.segments[segIdx + 1]!;
    const transitionType = nextSeg.facecam.transition ?? "smooth";
    if (transitionType !== "cut") {
      const dur = Math.max(0.05, nextSeg.facecam.transitionDuration ?? 0.45);
      const half = dur / 2;
      const timeToBoundary = segEndT - timelineT;
      if (timeToBoundary >= 0 && timeToBoundary <= half) {
        // First half of transition (0.0 -> 0.5)
        const tPhase = Math.max(0, Math.min(1, (half - timeToBoundary) / half));
        const progress = 0.5 * tPhase;

        if (!nextSeg.facecam.src) {
          const eased = 1 - easeInCubic(tPhase);
          return {
            x: current.x,
            y: current.y,
            size: current.size * eased,
            shape,
            shapeProgress: defaultProgress,
            opacity: eased,
          };
        }

        let eased = easeInOutCubic(progress);
        if (transitionType === "spring") {
          eased = 1 + Math.sin(progress * Math.PI * 1.5) * Math.pow(1 - progress, 2) * 0.35;
        } else if (transitionType === "slide") {
          eased = easeOutCubic(progress);
        }

        const next = nextSeg.facecam;
        const currProgress = (current.shape ?? "square") === "circle" ? 1 : 0;
        const nextProgress = (next.shape ?? "square") === "circle" ? 1 : 0;
        const shapeProgress = Math.max(0, Math.min(1, currProgress + (nextProgress - currProgress) * eased));

        return {
          x: current.x + (next.x - current.x) * eased,
          y: current.y + (next.y - current.y) * eased,
          size: Math.max(0.01, current.size + (next.size - current.size) * eased),
          shape,
          shapeProgress,
          opacity: transitionType === "fade" ? 1 - 0.7 * (1 - eased) : 1,
        };
      }
    }
  }

  return {
    x: current.x,
    y: current.y,
    size: current.size,
    shape,
    shapeProgress: defaultProgress,
    opacity: 1,
  };
}

/**
 * Decoded background images, keyed by object URL.
 *
 * renderFrame is synchronous and is the one path shared by the preview and the
 * encoder, so an image has to be decoded before drawing rather than during it.
 * Callers preload through ensureBackgroundImages(); a miss here degrades to a
 * flat fill instead of dropping a frame.
 */
const bgImages = new Map<string, CanvasImageSource>();
const bgImageLoads = new Map<string, Promise<void>>();

/** Decode every image background a project references. Safe to call often. */
export async function ensureBackgroundImages(project: Project): Promise<void> {
  const srcs = new Set<string>();
  for (const seg of project.segments) {
    if (seg.background.kind === "image" && seg.background.src) srcs.add(seg.background.src);
  }
  await Promise.all([...srcs].map(loadBackgroundImage));
}

function loadBackgroundImage(src: string): Promise<void> {
  if (bgImages.has(src)) return Promise.resolve();
  const inFlight = bgImageLoads.get(src);
  if (inFlight) return inFlight;

  const load = (async () => {
    try {
      // createImageBitmap decodes off the main thread and gives the renderer a
      // ready-to-draw surface; <img> would still decode on first paint.
      const blob = await (await fetch(src)).blob();
      bgImages.set(src, await createImageBitmap(blob));
    } catch {
      /* unreadable or revoked — drawBackground falls back to a flat fill */
    } finally {
      bgImageLoads.delete(src);
    }
  })();
  bgImageLoads.set(src, load);
  return load;
}

/** Drop decoded images, closing bitmaps so their memory is released. */
export function clearBackgroundImages(keep?: Set<string>): void {
  for (const [src, img] of bgImages) {
    if (keep?.has(src)) continue;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) img.close();
    bgImages.delete(src);
  }
}

/**
 * Rounding applied to the recorded frame, in canvas pixels.
 *
 * Scaled off the canvas height like stagePadding, so the same setting looks the
 * same at 720p and 4K, and capped at half the shorter side — beyond that the
 * corners meet and the frame turns into a lozenge.
 *
 * With no explicit value this reproduces what the renderer did before the
 * control existed: rounded only when there is padding to reveal it.
 */
export function frameCornerRadius(
  seg: { stagePadding?: number; cornerRadius?: number },
  rect: Rect,
  canvasH: number,
): number {
  const units =
    seg.cornerRadius ?? ((seg.stagePadding ?? 0) > 0 ? DEFAULT_CORNER_RADIUS_UNITS : 0);
  if (units <= 0) return 0;
  const px = units * (canvasH / 1080) * 1.5;
  return Math.min(px, Math.min(rect.w, rect.h) / 2);
}

/**
 * Rounding on the outer edge of the frame, in canvas pixels.
 *
 * Scaled off canvas height like the inner radius, and capped at half the
 * shorter side of the whole canvas.
 */
export function outerCornerRadius(
  seg: { outerRadius?: number },
  canvasW: number,
  canvasH: number,
): number {
  const units = seg.outerRadius ?? 0;
  if (units <= 0) return 0;
  const px = units * (canvasH / 1080) * 1.5;
  return Math.min(px, Math.min(canvasW, canvasH) / 2);
}

/** Matches the radius the old hardcoded formula produced at 1080p. */
export const DEFAULT_CORNER_RADIUS_UNITS = 16;

function drawBackground(
  ctx: CanvasRenderingContext2D,
  bg: Background,
  w: number,
  h: number,
): void {
  if (bg.kind === "image") {
    const img = bgImages.get(bg.src);
    if (!img) {
      // Not decoded yet. A neutral fill reads better than a flash of white.
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const texW = (img as { width: number }).width || w;
    const texH = (img as { height: number }).height || h;
    // Cover crops to fill; contain fits the whole image and letterboxes.
    const scale =
      bg.fit === "contain"
        ? Math.min(w / texW, h / texH)
        : Math.max(w / texW, h / texH);
    const dw = texW * scale;
    const dh = texH * scale;
    if (bg.fit === "contain") {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return;
  }
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
    // blur: stretched + blurred current frame fills the letterbox padding
    if (currentFrame) {
      ctx.save();
      // @ts-ignore — filter is supported in Canvas2D
      ctx.filter = "blur(24px) brightness(0.85)";
      // Cover: scale to fill canvas, centered
      const texW = (currentFrame as { width?: number }).width ?? w;
      const texH = (currentFrame as { height?: number }).height ?? h;
      // Fallback when CanvasImageSource is an OffscreenCanvas without width/height props read differently
      const scale = Math.max(w / Math.max(texW, 1), h / Math.max(texH, 1));
      const dw = texW * scale;
      const dh = texH * scale;
      ctx.drawImage(currentFrame, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
      // Darken a bit so zooms remain readable
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, w, h);
    }
  }
}

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  seg: Segment,
  t: number,
  w: number,
  h: number,
): void {
  const all = [...seg.textOverlays, ...seg.stagedTextOverlays];
  const scaleRef = Math.min(w / 1920, h / 1080);
  const scale = Math.max(0.5, scaleRef);

  for (const to of all) {
    const duration = to.duration != null && to.duration > 0 ? to.duration : 3;
    if (t < to.timestamp || t > to.timestamp + duration) continue;

    const relT = t - to.timestamp;
    const remainT = to.timestamp + duration - t;
    const anim = to.animation ?? "fade";
    const animDur = Math.min(to.animationDuration ?? 0.35, duration / 2);

    let alpha = 1;
    let scaleAnim = 1;
    let animDx = 0;
    let animDy = 0;
    let displayText = to.text;

    // Enter & exit progress (0..1)
    const enterP = animDur > 0 ? Math.min(1, Math.max(0, relT / animDur)) : 1;
    const exitP = animDur > 0 ? Math.min(1, Math.max(0, remainT / animDur)) : 1;

    // Easing helpers
    const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
    const easeOutBack = (p: number) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);
    const easeOutBounce = (p: number) => {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (p < 1 / d1) return n1 * p * p;
      if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75;
      if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375;
      return n1 * (p -= 2.625 / d1) * p + 0.984375;
    };

    if (anim === "fade") {
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    } else if (anim === "pop") {
      scaleAnim = enterP < 1 ? Math.max(0.2, 0.4 + 0.6 * easeOutBack(enterP)) : Math.max(0.2, 0.4 + 0.6 * easeOutCubic(exitP));
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    } else if (anim === "slide-up") {
      animDy = (1 - easeOutCubic(enterP)) * (40 * scale) - (1 - easeOutCubic(exitP)) * (40 * scale);
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    } else if (anim === "slide-down") {
      animDy = -(1 - easeOutCubic(enterP)) * (40 * scale) + (1 - easeOutCubic(exitP)) * (40 * scale);
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    } else if (anim === "zoom-in") {
      scaleAnim = 0.8 + 0.2 * easeOutCubic(enterP);
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    } else if (anim === "typewriter") {
      const typeProgress = animDur > 0 ? Math.min(1, relT / (animDur * 1.8)) : 1;
      const charCount = Math.max(1, Math.floor(to.text.length * typeProgress));
      displayText = to.text.slice(0, charCount);
      alpha = easeOutCubic(exitP);
    } else if (anim === "bounce") {
      scaleAnim = enterP < 1 ? Math.max(0.1, easeOutBounce(enterP)) : Math.max(0.1, easeOutCubic(exitP));
      alpha = Math.min(easeOutCubic(enterP), easeOutCubic(exitP));
    }

    // Base position coordinates
    let anchorX = (to.x ?? 0.5) * w;
    let anchorY = (to.y ?? 0.5) * h;

    if (to.position === "top" && to.y == null) {
      anchorY = Math.max(60 * scale, 0.1 * h);
    } else if (to.position === "bottom" && to.y == null) {
      anchorY = Math.min(h - 60 * scale, 0.88 * h);
    } else if (to.position === "center" && to.y == null) {
      anchorY = 0.5 * h;
    }

    ctx.save();
    const finalAlpha = Math.max(0, Math.min(1, (to.opacity ?? 1) * alpha));
    ctx.globalAlpha = finalAlpha;

    // Apply animation transforms around the text anchor
    ctx.translate(anchorX + animDx, anchorY + animDy);
    if (scaleAnim !== 1) {
      ctx.scale(scaleAnim, scaleAnim);
    }

    const fontSizePx = Math.max(12, Math.round((to.fontSize ?? 36) * scale));
    const fontWeight = to.fontWeight ?? "bold";
    const fontStyle = to.fontStyle ?? "normal";
    const fontFamily = to.fontFamily ?? "Inter, system-ui, sans-serif";
    ctx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily}`;
    ctx.textAlign = (to.textAlign as CanvasTextAlign) ?? "center";
    ctx.textBaseline = "middle";

    const lines = displayText.split("\n");
    const lineHeight = fontSizePx * 1.28;
    const totalHeight = lines.length * lineHeight;

    // Measure maximum line width
    let maxLineWidth = 0;
    for (const line of lines) {
      const width =
        typeof ctx.measureText === "function"
          ? (ctx.measureText(line)?.width ?? line.length * (fontSizePx * 0.6))
          : line.length * (fontSizePx * 0.6);
      if (width > maxLineWidth) maxLineWidth = width;
    }

    // Draw background pill / container if requested
    const bg = to.backgroundColor;
    if (bg && bg !== "transparent") {
      const padX = (to.backgroundPadding ?? 14) * scale;
      const padY = (to.backgroundPadding ? to.backgroundPadding * 0.7 : 10) * scale;
      const pillW = maxLineWidth + padX * 2;
      const pillH = totalHeight + padY * 2;
      const pillR = Math.min((to.borderRadius ?? 10) * scale, pillH / 2);

      let pillX = -pillW / 2;
      if (to.textAlign === "left") pillX = -padX;
      else if (to.textAlign === "right") pillX = -pillW + padX;

      const pillY = -pillH / 2;

      ctx.save();
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
      } else {
        ctx.rect(pillX, pillY, pillW, pillH);
      }
      ctx.fillStyle = bg;
      ctx.fill();

      if (to.borderWidth && to.borderWidth > 0 && to.borderColor) {
        ctx.strokeStyle = to.borderColor;
        ctx.lineWidth = to.borderWidth * scale;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw text with shadow / outline
    if (to.shadowColor && (to.shadowBlur ?? 0) > 0) {
      ctx.shadowColor = to.shadowColor;
      ctx.shadowBlur = (to.shadowBlur ?? 4) * scale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2 * scale;
    }

    if (to.borderWidth && to.borderWidth > 0 && to.borderColor && (!bg || bg === "transparent")) {
      ctx.strokeStyle = to.borderColor;
      ctx.lineWidth = (to.borderWidth * 2) * scale;
      ctx.lineJoin = "round";
      let curY = -((lines.length - 1) * lineHeight) / 2;
      for (const line of lines) {
        ctx.strokeText(line, 0, curY);
        curY += lineHeight;
      }
    }

    ctx.fillStyle = to.staged ? "#f59e0b" : (to.color ?? "#ffffff");
    let curY = -((lines.length - 1) * lineHeight) / 2;
    for (const line of lines) {
      ctx.fillText(line, 0, curY);
      curY += lineHeight;
    }

    ctx.restore();
  }
}

// ── Facecam PiP ──────────────────────────────────────────────────────────────
// Lazy <video muted playsinline>; seek currentTime = t % duration pre-draw;
// rounded-corner PiP at facecam.x/y/size in screen space (never zoomed).
const facecamCache = new Map<string, HTMLVideoElement>();

// Injected by decode.ts. Kept as callbacks because decode.ts already imports
// this module, and importing it back would be circular.
let decodedFacecam: (() => CanvasImageSource | null) | null = null;
let decodedFacecamAspect: (() => number) | null = null;
let decodedFacecamSrc: (() => string | null) | null = null;

export function setFacecamFrameSource(
  frame: (() => CanvasImageSource | null) | null,
  aspect: (() => number) | null,
  currentSrc?: (() => string | null) | null,
): void {
  decodedFacecam = frame;
  decodedFacecamAspect = aspect;
  decodedFacecamSrc = currentSrc ?? null;
}
let lastFacecamT = 0;

function getFacecamVideo(src: string): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  const cached = facecamCache.get(src);
  if (cached) return cached;
  const v = document.createElement("video");
  v.muted = true;
  (v as unknown as { playsInline: boolean }).playsInline = true;
  v.preload = "auto";
  // No crossOrigin: the source is a same-origin blob: URL, and setting it puts
  // the element into a CORS fetch that a blob URL does not answer.
  v.src = src;
  // Chrome will not reliably decode a detached element, and we only ever read
  // it through drawImage — so park it in the document, invisible and inert.
  v.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
  v.setAttribute("aria-hidden", "true");
  try {
    document.body.appendChild(v);
  } catch { /* no body yet — the element still loads */ }
  try { v.load(); } catch { /* ignore */ }
  // Muted autoplay is permitted and forces a decoded first frame; we pause
  // immediately because the timeline, not the element, drives playback.
  v.play().then(() => v.pause()).catch(() => { /* seeking still works */ });
  if (typeof window !== "undefined") {
    const onReady = () => {
      window.dispatchEvent(new CustomEvent("panoptik:frame-dirty"));
    };
    v.addEventListener("loadeddata", onReady, { once: true });
    v.addEventListener("canplay", onReady, { once: true });
  }
  facecamCache.set(src, v);
  return v;
}

/** Drop cached facecam elements — call when the project's recording changes. */
export function clearFacecamCache(): void {
  for (const v of facecamCache.values()) {
    try {
      v.pause();
      v.removeAttribute("src");
      v.load();
      v.remove();
    } catch {
      /* ignore */
    }
  }
  facecamCache.clear();
}

function drawFacecam(
  ctx: CanvasRenderingContext2D,
  fc: Facecam,
  t: number,
  canvasW: number,
  canvasH: number,
  resolved?: {
    x: number;
    y: number;
    size: number;
    shape: "circle" | "square";
    shapeProgress?: number;
    opacity: number;
  },
  isPlaying?: boolean,
  speed?: number,
): void {
  if (!fc.src) return;
  const startT = fc.startT ?? 0;
  const facecamT = startT > 0 ? Math.max(0, t - startT) : t;

  const effectiveSize = resolved ? resolved.size : fc.size;
  const effectiveX = resolved ? resolved.x : fc.x;
  const effectiveY = resolved ? resolved.y : fc.y;
  const opacity = resolved ? resolved.opacity : 1;

  if (effectiveSize <= 0.001 || opacity <= 0.01) return;

  let source: CanvasImageSource | null = null;
  let aspect = 16 / 9;

  const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
  const activeSrc = decodedFacecamSrc?.() ?? null;
  const isDecodedSourceMatch = !activeSrc || !fc.src || fc.src === activeSrc;

  // During export, prioritize the deterministic WebCodecs decoded frame source
  if (isExporting && isDecodedSourceMatch) {
    source = decodedFacecam?.() ?? null;
    aspect = source ? decodedFacecamAspect?.() ?? 16 / 9 : 16 / 9;
  }

  if (!source) {
    const video = getFacecamVideo(fc.src);
    if (video) {
      const dur = video.duration;
      const target = Number.isFinite(dur) && dur > 0 ? Math.min(facecamT, dur - 1e-3) : facecamT;

      if (isPlaying) {
        if (video.paused) {
          video.currentTime = target;
          video.play().catch(() => {});
        } else if (Math.abs(video.currentTime - target) > 0.3) {
          video.currentTime = target;
        }
        if (speed && video.playbackRate !== speed) {
          video.playbackRate = speed;
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.05) {
          video.currentTime = target;
        }
      }

      if (video.videoWidth > 0 && video.videoHeight > 0) {
        source = video;
        aspect = video.videoWidth / video.videoHeight;
      }
    }
  }

  // Fallback to decoded frame source (used during headless mode / unit tests)
  if (!source && isDecodedSourceMatch) {
    source = decodedFacecam?.() ?? null;
    aspect = source ? decodedFacecamAspect?.() ?? 16 / 9 : 16 / 9;
  }

  // Pause other inactive videos to save resources
  for (const [s, v] of facecamCache.entries()) {
    if (s !== fc.src && !v.paused) {
      v.pause();
    }
  }

  if (!source) return;

  const curW = Math.round(canvasW * effectiveSize);
  const curH = curW;
  const x = Math.round(canvasW * effectiveX);
  const y = Math.round(canvasH * effectiveY);
  // Clamp inside canvas
  const bX = clamp(x, 0, Math.max(0, canvasW - curW));
  const bY = clamp(y, 0, Math.max(0, canvasH - curH));

  const shapeProgress = resolved?.shapeProgress ?? (fc.shape === "circle" ? 1 : 0);
  const rSquare = Math.round(curW * 0.16);
  const rCircle = curW / 2;
  const curR = Math.min(curW / 2, rSquare + (rCircle - rSquare) * shapeProgress);

  const buildPath = () => {
    ctx.beginPath();
    if (typeof (ctx as unknown as { roundRect?: unknown }).roundRect === "function") {
      (ctx as unknown as { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(
        bX,
        bY,
        curW,
        curH,
        curR,
      );
    } else {
      const r = Math.min(curR, curW / 2, curH / 2);
      ctx.moveTo(bX + r, bY);
      ctx.arcTo(bX + curW, bY, bX + curW, bY + curH, r);
      ctx.arcTo(bX + curW, bY + curH, bX, bY + curH, r);
      ctx.arcTo(bX, bY + curH, bX, bY, r);
      ctx.arcTo(bX, bY, bX + curW, bY, r);
      ctx.closePath();
    }
  };

  // Centered cover crop calculation for source image
  const sw = (source as HTMLVideoElement).videoWidth || (source as HTMLCanvasElement).width || curW;
  const sh = (source as HTMLVideoElement).videoHeight || (source as HTMLCanvasElement).height || curH;
  const srcAspect = sw / sh;
  const targetAspect = curW / curH;

  let sx = 0,
    sy = 0,
    sCropW = sw,
    sCropH = sh;
  if (srcAspect > targetAspect) {
    sCropW = sh * targetAspect;
    sx = (sw - sCropW) / 2;
  } else {
    sCropH = sw / targetAspect;
    sy = (sh - sCropH) / 2;
  }

  const scale = canvasH / 1080;
  const shadowBlur = fc.shadowBlur ?? 10;
  const shadowColor = fc.shadowColor ?? "rgba(0,0,0,0.3)";

  // 1. Drop shadow / glow behind facecam PiP
  if (shadowBlur > 0 && shadowColor && shadowColor !== "none" && shadowColor !== "transparent") {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = shadowBlur * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fillStyle = "rgba(0,0,0,1)";
    buildPath();
    if (typeof ctx.fill === "function") {
      ctx.fill();
    }
    ctx.restore();
  }

  // 2. Facecam video frame with morphed rounded-square / circle clipping
  ctx.save();
  ctx.globalAlpha = opacity;
  buildPath();
  if (typeof ctx.clip === "function") {
    ctx.clip();
  }
  try {
    ctx.drawImage(source, sx, sy, sCropW, sCropH, bX, bY, curW, curH);
  } catch {
    /* video frame not ready */
  }
  ctx.restore();

  // 3. Crisp border stroke — matches morphed clip shape and scales with canvas
  const borderWidth = fc.borderWidth ?? 2;
  const borderColor = fc.borderColor ?? "rgba(255,255,255,0.85)";
  const effectiveBorderW = borderWidth * scale;

  if (effectiveBorderW > 0 && borderColor && borderColor !== "none" && borderColor !== "transparent") {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = effectiveBorderW;
    buildPath();
    if (typeof ctx.stroke === "function") {
      ctx.stroke();
    }
    ctx.restore();
  }
}
