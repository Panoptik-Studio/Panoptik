/**
 * @panoptik/schema — THE LOCKED CONTRACT (v1.1)
 *
 * OWNER: JOINT — DEV A + DEV B. Changes require both devs present (ROADMAP Task 0.1).
 * Delta vs Spec.md: Background is a discriminated union, GIF cut from ExportOpts,
 * engine gains prepareFrame/getAudioBuffer, renderFrame is sync off an internal cache.
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

export type TextOverlay = {
  id: string;
  text: string;
  timestamp: number; // seconds; displays for a fixed 3s from timestamp
  position: "top" | "bottom" | "center";
  staged: boolean;
};

export type Caption = { text: string; start: number; end: number };

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
}; // all normalized 0-1, shape for PiP

export type ClickEvent = {
  t: number;
  x: number; // normalized 0-1
  y: number;
  type: "click" | "scroll" | "move" | "manual";
};

/** "source" keeps the clip's own shape, so nothing is letterboxed. */
export type AspectPreset = "source" | "16:9" | "9:16" | "1:1" | "4:3";

export type Media = { src: string; duration: number; width: number; height: number };

export type Segment = {
  id: string;
  srcStart: number;
  srcEnd: number;
  speed: number;
  stagePadding: number;
  aspectPreset: AspectPreset;
  background: Background;
  facecam: Facecam;
  zoomPoints: ZoomPoint[];
  stagedZoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
};

export type Project = {
  id: string;
  media: Media;
  audioSrc?: string | null;
  segments: Segment[];
  clickLog: ClickEvent[];
};

export function migrateProject(raw: unknown): Project {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(r.segments) && r.media && typeof r.media === "object") {
    return raw as Project; // already v1.2
  }
  const clip = (r.clip ?? {}) as Record<string, unknown>;
  const media: Media = {
    src: String(clip.src ?? ""),
    duration: num(clip.duration, 0),
    width: num(clip.width, 1920),
    height: num(clip.height, 1080),
  };
  const fc = (r.facecam ?? {}) as Record<string, unknown>;
  const baseZoom = (r.zoomPoints ?? []) as ZoomPoint[];
  const seg: Segment = {
    id: "s1",
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
    },
    zoomPoints: baseZoom.map((z) => ({ ...z })),
    stagedZoomPoints: ((r.stagedZoomPoints ?? []) as ZoomPoint[]).map((z) => ({ ...z })),
    textOverlays: ((r.textOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
    stagedTextOverlays: ((r.stagedTextOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
    captions: ((r.captions ?? []) as Caption[]).map((c) => ({ ...c })),
    stagedCaptions: ((r.stagedCaptions ?? []) as Caption[]).map((c) => ({ ...c })),
  };
  return {
    id: String(r.id ?? crypto.randomUUID()),
    media,
    audioSrc: r.audioSrc ? String(r.audioSrc) : null,
    segments: [seg],
    clickLog: ((r.clickLog ?? []) as ClickEvent[]).map((e) => ({ ...e })),
  };
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export type ExportOpts = {
  format: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  burnCaptions: boolean;
  playbackRate?: number; // 0.25–3, affects cam+screen together, preview & export
};
