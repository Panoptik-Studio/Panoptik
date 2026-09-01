/**
 * @panoptik/schema — project types and migration.
 */

export type ZoomPoint = {
  id: string;
  t: number; // seconds
  to: { scale: number; x: number; y: number }; // focal point, normalized 0-1 relative to FRAME rect
  dur: number; // zoom-in (and zoom-out) easing duration, seconds
  hold?: number; // how long to stay zoomed at max, seconds (default 2.0)
  ease: string; // key of EASINGS, default "easeInOutCubic"
  staged: boolean; // true = ghost proposal (agent-staged), never affects rendering
};

export type TextAnimation =
  | "none"
  | "fade"
  | "pop"
  | "slide-up"
  | "slide-down"
  | "zoom-in"
  | "typewriter"
  | "bounce";

export type TextOverlay = {
  id: string;
  text: string;
  timestamp: number; // seconds; start time
  duration?: number; // seconds (defaults to 3s if not specified)
  position?: "top" | "bottom" | "center" | "custom";
  x?: number; // normalized 0..1 (default 0.5)
  y?: number; // normalized 0..1
  fontFamily?: string; // e.g. "Inter", "Outfit", "Poppins", "Montserrat", "Playfair Display", "Bebas Neue", "Fira Code", "Caveat"
  fontSize?: number; // font size in px (default 36)
  fontWeight?: "normal" | "bold" | "600" | "800" | "900";
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right";
  color?: string; // hex color or rgba, default "#ffffff"
  backgroundColor?: string; // background pill / box color, e.g. "rgba(0,0,0,0.6)" or "#000000" or "transparent"
  backgroundPadding?: number; // padding in px (default 12)
  borderRadius?: number; // rounded corners for pill in px (default 8)
  shadowColor?: string; // shadow color (e.g. "rgba(0,0,0,0.75)")
  shadowBlur?: number; // shadow blur in px (default 4)
  borderWidth?: number; // outline stroke width in px (default 0)
  borderColor?: string; // outline stroke color
  opacity?: number; // 0..1, default 1
  animation?: TextAnimation; // default "fade"
  animationDuration?: number; // transition duration in seconds (default 0.35s)
  staged: boolean;
  kind?: "caption" | "text"; // distinguishes subtitles/captions from regular text callouts
  speaker?: "Speaker" | "Screen" | string; // speaker group tag for subtitles
};

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; stops: [string, string] }
  | { kind: "blur" }
  /**
   * A still image behind the video.
   *
   * `src` is always an object URL for a blob held by this session — never a
   * remote address. A stored project's src is dead on reload, so it is re-minted
   * from the copy in OPFS rather than trusted from JSON.
   */
  | { kind: "image"; src: string; fit: "cover" | "contain" };

export type Facecam = {
  src: string | null;
  x: number;
  y: number;
  size: number;
  shape?: "circle" | "square";
  transition?: "smooth" | "spring" | "fade" | "slide" | "cut";
  transitionDuration?: number;
  startT?: number;
  audioVolume?: number; // 0.0 - 2.0 (1.0 = 100%)
  borderWidth?: number; // border stroke width in px (0 for none, 0-24)
  borderColor?: string; // border color hex/rgba
  shadowBlur?: number; // shadow/glow blur radius in px (0 for none, 0-48)
  shadowColor?: string; // shadow/glow color rgba/hex
}; // all normalized 0-1, shape for PiP

/**
 * An audio asset laid on the timeline at wall-clock speed (music, voiceover).
 * Ignores segment speed on purpose — background music must not be stretched.
 */
export type AudioTrack = {
  id: string;
  kind: "music" | "voiceover";
  name?: string;
  /** Object URL for this session; re-minted from OPFS on load (same rule as background images). */
  src: string;
  duration: number;
  /** 0–2 (1 = unchanged). */
  volume: number;
  /** Timeline seconds where the track begins. */
  startT: number;
  /** Fade-in/out in seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** 0–1: how much to duck under dialogue. null/undefined = off. Music only. */
  ducking?: number | null;
};

export type ClickEvent = {
  t: number;
  x: number; // normalized 0-1
  y: number;
  type: "click" | "scroll" | "move" | "manual";
};

/** "source" keeps the clip's own shape, so nothing is letterboxed. */
export type AspectPreset = "source" | "16:9" | "9:16" | "1:1" | "4:3";

export type Media = {
  /**
   * Stable identity, referenced by Segment.mediaId.
   *
   * Assigned deterministically on migration ("m1", "m2", …) rather than
   * randomly: a project is migrated on every load, and fresh ids each time
   * would break the segments that point at them.
   */
  id: string;
  src: string;
  duration: number;
  width: number;
  height: number;
};

export type VideoTransition =
  | "cut"
  | "fade"
  | "dipToBlack"
  | "slide-left"
  | "slide-right"
  | "zoom-in"
  | "wipe";

export type Segment = {
  id: string;
  /** Which clip in Project.media this segment cuts from. */
  mediaId: string;
  /** Chapter/scene name, shown on the timeline. */
  name?: string;
  /**
   * Corner rounding on the recorded frame, in the same units as stagePadding.
   *
   * Undefined keeps the old automatic behaviour — rounded only when padded —
   * so projects made before this control look exactly as they did.
   */
  cornerRadius?: number;
  /**
   * Rounding on the outer edge of the whole frame, in the same units.
   *
   * The exported file has no transparency, so the area outside the curve is
   * filled black. Defaults to 0 — square, which is what every export has
   * produced until now.
   */
  outerRadius?: number;
  srcStart: number;
  srcEnd: number;
  speed: number;
  stagePadding: number;
  aspectPreset: AspectPreset;
  background: Background;
  facecam: Facecam;
  /** Video transition applied when entering this segment from previous one (split video). */
  transition?: VideoTransition;
  /** Duration of the video transition in seconds (default 0.45s). */
  transitionDuration?: number;
  audioVolume?: number; // 0.0 - 2.0 (1.0 = 100%)
  zoomPoints: ZoomPoint[];
  stagedZoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
};

export type Project = {
  id: string;
  /** User-facing title, shown in the library. Absent until named. */
  name?: string;
  /**
   * Every clip in the project, in no particular order — the timeline order is
   * the segment order, not this one.
   */
  media: Media[];
  audioSrc?: string | null;
  segments: Segment[];
  clickLog: ClickEvent[];
  /** Always present at runtime (migration defaults it to `[]`); optional in the type so
   *  existing Project literals across the app need not change until they use it. */
  audioTracks?: AudioTrack[];
};

/** First media id. Deterministic so re-migrating the same file is a no-op. */
export const FIRST_MEDIA_ID = "m1";

/** Look a clip up by id. */
export function mediaById(project: Project, id: string): Media | undefined {
  return project.media.find((m) => m.id === id);
}

/**
 * The clip a segment cuts from.
 *
 * Falls back to the first clip rather than throwing: a segment pointing at a
 * removed media should degrade to something renderable, not take down the
 * editor. Callers that care can check mediaById directly.
 */
export function mediaForSegment(project: Project, segment: Segment): Media {
  return mediaById(project, segment.mediaId) ?? project.media[0]!;
}

/** The project's first clip — the only one until multi-clip import lands. */
export function primaryMedia(project: Project): Media {
  return project.media[0]!;
}

export function migrateProject(raw: unknown): Project {
  const r = (raw ?? {}) as Record<string, unknown>;

  // v1.3: media is an array. Checked before the v1.2 test below, because an
  // array is also `typeof "object"` and would otherwise pass as v1.2.
  if (Array.isArray(r.media) && Array.isArray(r.segments)) {
    const p = raw as Project;
    if (!Array.isArray(p.audioTracks)) p.audioTracks = [];
    return p;
  }

  // v1.2: one media object plus segments. Wrap the media in an array, give it
  // an id, and point every segment at it.
  if (Array.isArray(r.segments) && r.media && typeof r.media === "object") {
    const v12 = raw as Omit<Project, "media"> & { media: Omit<Media, "id"> & { id?: string } };
    const only: Media = { ...v12.media, id: v12.media.id ?? FIRST_MEDIA_ID };
    const audioTracks = Array.isArray((v12 as unknown as { audioTracks?: unknown }).audioTracks)
      ? (v12 as unknown as Project).audioTracks
      : ((r.audioTracks ?? []) as AudioTrack[]);
    return {
      ...v12,
      media: [only],
      audioTracks,
      segments: v12.segments.map((seg) => ({
        ...seg,
        mediaId: (seg as Segment).mediaId ?? only.id,
      })),
    };
  }
  // v1.1: a single top-level clip with the edits alongside it.
  const clip = (r.clip ?? {}) as Record<string, unknown>;
  const media: Media = {
    id: FIRST_MEDIA_ID,
    src: String(clip.src ?? ""),
    duration: num(clip.duration, 0),
    width: num(clip.width, 1920),
    height: num(clip.height, 1080),
  };
  const fc = (r.facecam ?? {}) as Record<string, unknown>;
  const baseZoom = (r.zoomPoints ?? []) as ZoomPoint[];
  const seg: Segment = {
    id: "s1",
    mediaId: media.id,
    srcStart: 0,
    srcEnd: media.duration,
    speed: num(r.playbackRate, 1, 0.25, 3),
    stagePadding: num(r.stagePadding, 0, 0, 48),
    aspectPreset: (r.aspectPreset as AspectPreset) ?? "source",
    background: (r.background as Background) ?? { kind: "solid", color: "#000000" },
    facecam: {
      src: fc.src ? String(fc.src) : null,
      x: num(fc.x, 0.8, 0, 1),
      y: num(fc.y, 0.8, 0, 1),
      size: num(fc.size, 0.2, 0.02, 1),
      shape: fc.shape === "circle" || fc.shape === "square" ? (fc.shape as Facecam["shape"]) : "square",
      audioVolume: num(fc.audioVolume, 1, 0, 2),
    },
    audioVolume: num(r.audioVolume, 1, 0, 2),
    zoomPoints: baseZoom.map((z) => ({ ...z })),
    stagedZoomPoints: ((r.stagedZoomPoints ?? []) as ZoomPoint[]).map((z) => ({ ...z })),
    textOverlays: ((r.textOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
    stagedTextOverlays: ((r.stagedTextOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
  };
  return {
    id: String(r.id ?? crypto.randomUUID()),
    media: [media],
    audioSrc: r.audioSrc ? String(r.audioSrc) : null,
    segments: [seg],
    clickLog: ((r.clickLog ?? []) as ClickEvent[]).map((e) => ({ ...e })),
    audioTracks: ((r.audioTracks ?? []) as AudioTrack[]).map((t) => ({ ...t })),
  };
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/**
 * Frame rates offered for export.
 *
 * 24 is the standard step down for a smaller file — a screen demo loses very
 * little at that rate, and the encoder derives its bitrate partly from frame
 * rate, so the saving is real rather than cosmetic.
 */
export type ExportFps = 24 | 30 | 60;
export const EXPORT_FPS_OPTIONS: ExportFps[] = [24, 30, 60];
export const DEFAULT_EXPORT_FPS: ExportFps = 30;

export type ExportOpts = {
  format: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  /** Frames per second in the written file. Defaults to 30. */
  fps?: ExportFps;
  playbackRate?: number; // 0.25–3, affects cam+screen together, preview & export
};
