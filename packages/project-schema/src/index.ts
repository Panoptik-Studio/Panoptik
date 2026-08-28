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
  | { kind: "blur" };

export type Facecam = { src: string | null; x: number; y: number; size: number; shape?: "circle" | "square" }; // all normalized 0-1, shape for PiP

export type ClickEvent = {
  t: number;
  x: number; // normalized 0-1
  y: number;
  type: "click" | "scroll" | "move" | "manual";
};

export type AspectPreset = "16:9" | "9:16" | "1:1" | "4:3";

export type Project = {
  id: string;
  clip: { src: string; duration: number; width: number; height: number };
  /**
   * Where the audio lives, when that is not the clip itself. A screen recording
   * is captured silently and the microphone is muxed into the camera take, so
   * playback has to read audio from there.
   */
  audioSrc?: string | null;
  zoomPoints: ZoomPoint[]; // committed — THE ONLY input to the camera transform
  stagedZoomPoints: ZoomPoint[]; // ghosts
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
  background: Background;
  facecam: Facecam;
  clickLog: ClickEvent[];
  aspectPreset: AspectPreset;
};

export type ExportOpts = {
  format: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  burnCaptions: boolean;
};
