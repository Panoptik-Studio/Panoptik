/**
 * Validation for project state that comes back from storage.
 *
 * project.json is same-origin data, but it is still input we did not produce in
 * this session: another script on the origin, an extension, or a half-written
 * file can all put arbitrary values in it. The colours in particular reach an
 * inline CSS gradient in the preview, where `url(...)` would fetch, so they are
 * checked rather than trusted. Media sources are never taken from storage at
 * all — those are minted fresh when the blobs are re-opened.
 */
import type {
  AspectPreset,
  Background,
  Caption,
  Media,
  Project,
  Segment,
  TextOverlay,
  ZoomPoint,
} from "@panoptik/schema";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ASPECTS: AspectPreset[] = ["source", "16:9", "9:16", "1:1", "4:3"];
const POSITIONS = ["top", "bottom", "center"] as const;

/** Ceilings that keep a corrupt file from stalling the renderer. */
const MAX_ZOOMS = 500;
const MAX_TEXT_OVERLAYS = 200;
const MAX_CAPTIONS = 5000;
const MAX_CLICKS = 5000;
const MAX_TEXT_LENGTH = 500;

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const color = (v: unknown, fallback: string): string =>
  typeof v === "string" && HEX_COLOR.test(v.trim()) ? v.trim() : fallback;

const text = (v: unknown): string => (typeof v === "string" ? v.slice(0, MAX_TEXT_LENGTH) : "");

const arr = <T,>(v: unknown, cap: number): T[] => (Array.isArray(v) ? (v.slice(0, cap) as T[]) : []);

function zoomPoint(v: unknown, lo: number, hi: number): ZoomPoint | null {
  if (!v || typeof v !== "object") return null;
  const z = v as Partial<ZoomPoint>;
  if (typeof z.id !== "string") return null;
  const to = (z.to ?? {}) as Partial<ZoomPoint["to"]>;
  return {
    id: z.id.slice(0, 100),
    t: num(z.t, 0, lo, hi),
    to: {
      scale: num(to.scale, 1, 1, 10),
      x: num(to.x, 0.5, 0, 1),
      y: num(to.y, 0.5, 0, 1),
    },
    dur: num(z.dur, 0.7, 0.01, 30),
    ease: typeof z.ease === "string" ? z.ease.slice(0, 40) : "easeInOutCubic",
    staged: z.staged === true,
  };
}

function overlay(v: unknown, lo: number, hi: number): TextOverlay | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<TextOverlay>;
  if (typeof o.id !== "string") return null;
  const body = text(o.text);
  if (!body) return null;
  return {
    id: o.id.slice(0, 100),
    text: body,
    timestamp: num(o.timestamp, 0, lo, hi),
    position: POSITIONS.includes(o.position as (typeof POSITIONS)[number])
      ? (o.position as TextOverlay["position"])
      : "bottom",
    staged: o.staged === true,
  };
}

function caption(v: unknown, lo: number, hi: number): Caption | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Partial<Caption>;
  const body = text(c.text);
  if (!body) return null;
  const start = num(c.start, 0, lo, hi);
  return { text: body, start, end: num(c.end, start, start, hi) };
}

/** Speed 0.25–3, quantized to the 0.05 grid the UI/engine uses. */
function speed(v: unknown, fallback: number): number {
  const raw = num(v, fallback, 0.25, 3);
  return Math.round(raw * 20) / 20;
}

function background(v: unknown, fallback: Background): Background {
  if (!v || typeof v !== "object") return fallback;
  const b = v as { kind?: string; color?: unknown; stops?: unknown };
  if (b.kind === "solid") return { kind: "solid", color: color(b.color, "#000000") };
  if (b.kind === "gradient") {
    const stops = Array.isArray(b.stops) ? b.stops : [];
    return { kind: "gradient", stops: [color(stops[0], "#007cf0"), color(stops[1], "#7928ca")] };
  }
  if (b.kind === "blur") return { kind: "blur" };
  return fallback;
}

function aspectPreset(v: unknown, fallback: AspectPreset): AspectPreset {
  return ASPECTS.includes(v as AspectPreset) ? (v as AspectPreset) : fallback;
}

function facecam(v: unknown, fallback: Segment["facecam"]): Segment["facecam"] {
  const fc = (v ?? {}) as Partial<Segment["facecam"]>;
  return {
    // Source always comes from the freshly opened media, never from storage.
    src: fallback.src,
    x: num(fc.x, fallback.x, 0, 1),
    y: num(fc.y, fallback.y, 0, 1),
    size: num(fc.size, fallback.size, 0.02, 1),
    shape: fc.shape === "circle" || fc.shape === "square" ? fc.shape : fallback.shape,
  };
}

/**
 * Sanitize a single saved segment onto the freshly re-opened one. `fresh`
 * supplies every source and hard range bounds (its [srcStart, srcEnd] window);
 * only settings and annotations are taken from `saved` when present.
 */
function mergeSegment(fresh: Segment, saved: Partial<Segment> | null | undefined): Segment {
  const lo = fresh.srcStart;
  const hi = fresh.srcEnd;
  return {
    ...fresh,
    speed: speed(saved?.speed, fresh.speed),
    stagePadding: num(saved?.stagePadding, fresh.stagePadding, 0, 48),
    aspectPreset: aspectPreset(saved?.aspectPreset, fresh.aspectPreset),
    background: background(saved?.background, fresh.background),
    facecam: facecam(saved?.facecam, fresh.facecam),
    zoomPoints: arr<unknown>(saved?.zoomPoints, MAX_ZOOMS)
      .map((z) => zoomPoint(z, lo, hi))
      .filter((z): z is ZoomPoint => z !== null),
    stagedZoomPoints: arr<unknown>(saved?.stagedZoomPoints, MAX_ZOOMS)
      .map((z) => zoomPoint(z, lo, hi))
      .filter((z): z is ZoomPoint => z !== null),
    textOverlays: arr<unknown>(saved?.textOverlays, MAX_TEXT_OVERLAYS)
      .map((o) => overlay(o, lo, hi))
      .filter((o): o is TextOverlay => o !== null),
    stagedTextOverlays: arr<unknown>(saved?.stagedTextOverlays, MAX_TEXT_OVERLAYS)
      .map((o) => overlay(o, lo, hi))
      .filter((o): o is TextOverlay => o !== null),
    captions: arr<unknown>(saved?.captions, MAX_CAPTIONS)
      .map((c) => caption(c, lo, hi))
      .filter((c): c is Caption => c !== null),
    stagedCaptions: arr<unknown>(saved?.stagedCaptions, MAX_CAPTIONS)
      .map((c) => caption(c, lo, hi))
      .filter((c): c is Caption => c !== null),
  };
}

/**
 * Merge a project read from storage onto one whose media has just been re-opened.
 * `fresh` supplies every source (media, id); only edits are taken from `saved`,
 * matched per-segment by index. Old v1.1 records are upgraded by migrateProject at
 * the load boundary, so `saved` is always the v1.2 shape here.
 */
export function mergeSavedProject(fresh: Project, saved: Partial<Project> | null | undefined): Project {
  if (!saved || typeof saved !== "object") return fresh;
  const media = (saved.media ?? {}) as Partial<Media>;
  const mediaDuration = fresh.media.duration;

  return {
    ...fresh,
    id: typeof saved.id === "string" ? saved.id.slice(0, 100) : fresh.id,
    media: {
      ...fresh.media,
      width: num(media.width, fresh.media.width, 1, 100_000),
      height: num(media.height, fresh.media.height, 1, 100_000),
    },
    segments: fresh.segments.map((seg, i) => mergeSegment(seg, saved.segments?.[i])),
    clickLog: arr<unknown>(saved.clickLog, MAX_CLICKS)
      .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
      .map((e) => ({
        t: num(e.t, 0, 0, mediaDuration),
        x: num(e.x, 0.5, 0, 1),
        y: num(e.y, 0.5, 0, 1),
        type: e.type === "click" || e.type === "scroll" || e.type === "move" ? e.type : "manual",
      })),
  };
}
