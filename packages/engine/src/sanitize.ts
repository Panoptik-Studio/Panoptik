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
  AudioTrack,
  Background,
  Media,
  Project,
  Segment,
  TextOverlay,
  VideoTransition,
  ZoomPoint,
} from "@panoptik/schema";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ASPECTS: AspectPreset[] = ["source", "16:9", "9:16", "1:1", "4:3"];
const VALID_VIDEO_TRANSITIONS: VideoTransition[] = [
  "cut",
  "fade",
  "dipToBlack",
  "slide-left",
  "slide-right",
  "zoom-in",
  "wipe",
];
const POSITIONS = ["top", "bottom", "center"] as const;

/** Ceilings that keep a corrupt file from stalling the renderer. */
const MAX_ZOOMS = 500;
const MAX_TEXT_OVERLAYS = 200;
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
    hold: typeof z.hold === "number" && Number.isFinite(z.hold) ? num(z.hold, 2.0, 0.01, 3600) : undefined,
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
    ...o,
    id: o.id.slice(0, 100),
    text: body,
    timestamp: num(o.timestamp, 0, lo, hi),
    position: POSITIONS.includes(o.position as (typeof POSITIONS)[number])
      ? (o.position as TextOverlay["position"])
      : "bottom",
    staged: o.staged === true,
    kind: o.kind === "caption" ? "caption" : "text",
    speaker: typeof o.speaker === "string" ? o.speaker.slice(0, 50) : undefined,
  };
}

/** Speed 0.25–3, quantized to the 0.05 grid the UI/engine uses. */
function speed(v: unknown, fallback: number): number {
  const raw = num(v, fallback, 0.25, 3);
  return Math.round(raw * 20) / 20;
}

function background(
  v: unknown,
  fallback: Background,
  imageSrc: string | null,
): Background {
  if (!v || typeof v !== "object") return fallback;
  const b = v as { kind?: string; color?: unknown; stops?: unknown; fit?: unknown };
  if (b.kind === "image") {
    // Same rule as every other media source: the stored src is a dead object
    // URL at best and attacker-controlled at worst, so the only accepted value
    // is the one minted from the blob we just read back out of OPFS.
    if (!imageSrc) return fallback;
    return { kind: "image", src: imageSrc, fit: b.fit === "contain" ? "contain" : "cover" };
  }
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
    startT: typeof fc.startT === "number" && Number.isFinite(fc.startT) ? fc.startT : fallback.startT,
    transition:
      fc.transition === "smooth" ||
      fc.transition === "spring" ||
      fc.transition === "fade" ||
      fc.transition === "slide" ||
      fc.transition === "cut"
        ? fc.transition
        : fallback.transition,
    transitionDuration:
      typeof fc.transitionDuration === "number" && Number.isFinite(fc.transitionDuration)
        ? num(fc.transitionDuration, fallback.transitionDuration ?? 0.6, 0.05, 5)
        : fallback.transitionDuration,
    audioVolume: num(fc.audioVolume, fallback.audioVolume ?? 1, 0, 2),
    borderWidth:
      typeof fc.borderWidth === "number" && Number.isFinite(fc.borderWidth)
        ? num(fc.borderWidth, fallback.borderWidth ?? 1.5, 0, 24)
        : fallback.borderWidth,
    borderColor:
      typeof fc.borderColor === "string" ? fc.borderColor.slice(0, 48) : fallback.borderColor,
    shadowBlur:
      typeof fc.shadowBlur === "number" && Number.isFinite(fc.shadowBlur)
        ? num(fc.shadowBlur, fallback.shadowBlur ?? 0, 0, 48)
        : fallback.shadowBlur,
    shadowColor:
      typeof fc.shadowColor === "string" ? fc.shadowColor.slice(0, 48) : fallback.shadowColor,
  };
}

/**
 * Sanitize a single saved segment onto the freshly re-opened one. `fresh`
 * supplies every source and hard range bounds (its [srcStart, srcEnd] window);
 * only settings and annotations are taken from `saved` when present.
 */
function mergeSegment(
  fresh: Segment,
  saved: Partial<Segment> | null | undefined,
  backgroundImageSrc: string | null = null,
): Segment {
  return sanitizeSegment(fresh, saved, fresh.facecam.src, backgroundImageSrc);
}

/**
 * Rebuild one saved segment for the restore path. The saved split topology is
 * the source of truth: each segment keeps its own identity and bounds (clamped
 * into the freshly re-opened media) plus its settings/annotations. Media sources
 * are NEVER taken from storage — the facecam source is the freshly re-opened
 * one, and the window otherwise only exists inside the fresh media's duration.
 * Returns null when the saved window is degenerate or entirely out of range.
 */
function restoreSegment(
  saved: Partial<Segment> | null | undefined,
  fresh: Segment,
  freshFacecamSrc: string | null,
  mediaDuration: number,
  backgroundImageSrc: string | null,
  knownMediaIds: Set<string>,
): Segment | null {
  if (!saved || typeof saved !== "object") return null;
  const srcStart = num(saved.srcStart, fresh.srcStart, 0, mediaDuration);
  const srcEnd = num(saved.srcEnd, fresh.srcEnd, srcStart, mediaDuration);
  if (!(srcEnd > srcStart)) return null; // reversed / zero-width / out of range
  return sanitizeSegment(
    {
      ...fresh,
      id: typeof saved.id === "string" ? saved.id.slice(0, 100) : fresh.id,
      // Which clip this segment cuts from has to survive a reload, or a
      // multi-clip project collapses onto whichever clip the template used.
      // Only ids that name a real clip are accepted.
      mediaId:
        typeof saved.mediaId === "string" && knownMediaIds.has(saved.mediaId)
          ? saved.mediaId
          : fresh.mediaId,
      srcStart,
      srcEnd,
      facecam: { ...fresh.facecam, src: freshFacecamSrc },
    },
    saved,
    freshFacecamSrc,
    backgroundImageSrc,
  );
}

/**
 * Core sanitizer shared by {@link mergeSegment} and {@link restoreSegment}.
 * `base` supplies the identity, the [srcStart, srcEnd] bounds annotations are
 * clamped into, and every fallback for fields `saved` does not carry.
 */
function sanitizeSegment(
  base: Segment,
  saved: Partial<Segment> | null | undefined,
  savedFacecamSrc: string | null,
  savedBackgroundImageSrc: string | null,
): Segment {
  const lo = base.srcStart;
  const hi = base.srcEnd;
  return {
    ...base,
    // Chapter/scene name (C2). Length-capped like every other stored string.
    name: typeof saved?.name === "string" ? saved.name.slice(0, 120) : base.name,
    speed: speed(saved?.speed, base.speed),
    stagePadding: num(saved?.stagePadding, base.stagePadding, 0, 48),
    // Undefined is meaningful here: it selects the automatic radius, so an
    // absent value must not become 0.
    cornerRadius:
      typeof saved?.cornerRadius === "number" && Number.isFinite(saved.cornerRadius)
        ? Math.min(64, Math.max(0, saved.cornerRadius))
        : base.cornerRadius,
    outerRadius:
      typeof saved?.outerRadius === "number" && Number.isFinite(saved.outerRadius)
        ? Math.min(64, Math.max(0, saved.outerRadius))
        : base.outerRadius,
    aspectPreset: aspectPreset(saved?.aspectPreset, base.aspectPreset),
    background: background(saved?.background, base.background, savedBackgroundImageSrc),
    facecam: facecam(saved?.facecam, { ...base.facecam, src: savedFacecamSrc }),
    transition:
      typeof saved?.transition === "string" &&
      VALID_VIDEO_TRANSITIONS.includes(saved.transition as VideoTransition)
        ? (saved.transition as VideoTransition)
        : base.transition,
    transitionDuration:
      typeof saved?.transitionDuration === "number" && Number.isFinite(saved.transitionDuration)
        ? num(saved.transitionDuration, base.transitionDuration ?? 0.45, 0.05, 5)
        : base.transitionDuration,
    audioVolume: num(saved?.audioVolume, base.audioVolume ?? 1, 0, 2),
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
  };
}

/**
 * Merge a project read from storage onto one whose media has just been re-opened.
 * `fresh` supplies every source (media, facecam); only edits are taken from
 * `saved`. Old v1.1 records are upgraded by migrateProject at the load boundary,
 * so `saved` is always the v1.2 shape here.
 *
 * Split topology: when the saved record carries explicit per-segment source
 * windows (i.e. the record was saved after a split), each saved segment is the
 * source of truth — its identity, boundaries (clamped into the freshly re-opened
 * media) and settings survive the round-trip. Segments whose window is degenerate
 * or out of range are dropped, and if none survive we fall back to the fresh
 * single segment rather than hand back zero segments. Patch-style records (a
 * bare annotations/settings object with no windows) merge by index onto the
 * fresh segments, exactly as before.
 */
export function mergeSavedProject(
  fresh: Project,
  saved: Partial<Project> | null | undefined,
  segmentFacecamSrcsOrBackgrounds?: (string | null)[],
  backgroundImageUrls?: (string | null)[],
): Project {
  if (!saved || typeof saved !== "object") return fresh;

  let segmentFacecamSrcs: (string | null)[] | undefined = undefined;
  let bgUrls: (string | null)[] = [];

  if (backgroundImageUrls !== undefined) {
    segmentFacecamSrcs = segmentFacecamSrcsOrBackgrounds;
    bgUrls = backgroundImageUrls;
  } else if (segmentFacecamSrcsOrBackgrounds !== undefined) {
    const savedSegs = Array.isArray(saved.segments) ? saved.segments : [];
    const hasImageBg = savedSegs.some((s) => (s as Partial<Segment>)?.background?.kind === "image");
    if (hasImageBg) {
      bgUrls = segmentFacecamSrcsOrBackgrounds;
    } else {
      segmentFacecamSrcs = segmentFacecamSrcsOrBackgrounds;
    }
  }

  // Per-clip merge. Dimensions are validated from storage; sources are always
  // the freshly re-opened ones, same rule as every other media source.
  const savedMedia = Array.isArray(saved.media) ? (saved.media as Partial<Media>[]) : [];
  const mergedMedia: Media[] = fresh.media.map((m, i) => {
    const stored = savedMedia.find((sm) => sm && sm.id === m.id) ?? savedMedia[i];
    return {
      ...m,
      width: num(stored?.width, m.width, 1, 100_000),
      height: num(stored?.height, m.height, 1, 100_000),
    };
  });
  /** How far into a given clip a segment may reach. */
  const durationOfMedia = (mediaId: unknown): number => {
    const found = typeof mediaId === "string" ? mergedMedia.find((m) => m.id === mediaId) : undefined;
    return (found ?? mergedMedia[0])?.duration ?? 0;
  };
  const mediaDuration = mergedMedia[0]?.duration ?? 0;
  const knownMediaIds = new Set(mergedMedia.map((m) => m.id));
  const savedSegs = Array.isArray(saved.segments) ? saved.segments : [];
  const freshSeg = fresh.segments[0];

  const hasWindows = savedSegs.every(
    (s) =>
      !!s &&
      typeof s === "object" &&
      typeof (s as Partial<Segment>).srcStart === "number" &&
      typeof (s as Partial<Segment>).srcEnd === "number" &&
      Number.isFinite((s as Partial<Segment>).srcStart!) &&
      Number.isFinite((s as Partial<Segment>).srcEnd!),
  );

  let segments: Segment[];
  if (freshSeg && savedSegs.length > 0 && hasWindows) {
    const restored = savedSegs
      .map((s, i) => {
        const segFcSrc = segmentFacecamSrcs ? segmentFacecamSrcs[i] ?? null : freshSeg.facecam.src;
        const bgUrl = bgUrls[i] ?? null;
        // Clamp against this segment's own clip, not the first one — a window
        // valid in a long clip would otherwise survive on a short one.
        const dur = durationOfMedia((s as Partial<Segment>)?.mediaId);
        return restoreSegment(s, freshSeg, segFcSrc, dur, bgUrl, knownMediaIds);
      })
      .filter((s): s is Segment => s !== null);
    segments =
      restored.length > 0 ? restored : [mergeSegment(freshSeg, savedSegs[0], bgUrls[0] ?? null)];
  } else {
    segments = fresh.segments.map((seg, i) => {
      const segFcSrc = segmentFacecamSrcs ? segmentFacecamSrcs[i] ?? null : seg.facecam.src;
      const bgUrl = bgUrls[i] ?? null;
      return sanitizeSegment(seg, savedSegs[i], segFcSrc, bgUrl);
    });
  }

  // Audio tracks — wall-clock assets, not per-segment. Keep saved metadata;
  // src blob URLs are re-minted from OPFS by restoreAudioTracks.
  const audioTracks: AudioTrack[] = Array.isArray(saved.audioTracks)
    ? (saved.audioTracks as AudioTrack[]).map((t) => ({
        id: typeof t.id === "string" ? t.id.slice(0, 100) : crypto.randomUUID(),
        kind: (t.kind === "voiceover" ? "voiceover" : "music") as AudioTrack["kind"],
        name: typeof t.name === "string" ? t.name.slice(0, 120) : undefined,
        src: typeof t.src === "string" ? t.src : "",
        duration: num((t as unknown as { duration: unknown }).duration, 0, 0, 100000),
        volume: num((t as unknown as { volume: unknown }).volume, 1, 0, 2),
        startT: num((t as unknown as { startT: unknown }).startT, 0, 0, 100000),
        fadeIn: (t as unknown as { fadeIn?: unknown }).fadeIn != null ? num((t as unknown as { fadeIn: unknown }).fadeIn as number, 0, 0, 30) : undefined,
        fadeOut: (t as unknown as { fadeOut?: unknown }).fadeOut != null ? num((t as unknown as { fadeOut: unknown }).fadeOut as number, 0, 0, 30) : undefined,
        ducking: (t as unknown as { ducking?: unknown }).ducking != null ? num((t as unknown as { ducking: unknown }).ducking as number, 0, 0, 1) : undefined,
      } as AudioTrack)).filter((t) => t.duration > 0)
    : ((fresh as unknown as { audioTracks?: AudioTrack[] }).audioTracks ?? []) as AudioTrack[];

  return {
    ...fresh,
    id: typeof saved.id === "string" ? saved.id.slice(0, 100) : fresh.id,
    // Shown as the card title in the library, so it is length-capped like any
    // other stored string.
    name: typeof saved.name === "string" ? saved.name.slice(0, 120) : fresh.name,
    media: mergedMedia,
    segments,
    audioTracks,
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
