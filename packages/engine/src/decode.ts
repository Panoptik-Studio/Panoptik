/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.4.
 * mediabunny CanvasSink decode path driven by one sequential pipeline.
 *
 * `prepareFrame(t)` is pull-based but strictly serialized: concurrent callers
 * coalesce onto a single in-flight pump that always chases the newest requested
 * time. Frames come from `CanvasSink.canvases()` — the iterator that decodes each
 * packet at most once — instead of per-frame `getSample()` seeks, and are blitted
 * onto one presentation canvas so the sink's pooled canvases are never held
 * across an await.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from "mediabunny";
import type { Project } from "@panoptik/schema";
import { clearFacecamCache, getCurrentFrame, setCurrentFrame, setFacecamFrameSource } from "./render";
import { setAudioSink } from "./audio";

/** Keep 1920 everywhere on canvas per request — export and preview share res. */
const MAX_DECODE_WIDTH = 1920;
/** The camera is drawn small; decoding it larger is wasted work. */
const MAX_FACECAM_WIDTH = 640;
/** Larger pool reduces backpressure when the rAF loop is 60fps and decode is ~30fps. */
const POOL_SIZE = 8;
/** One iterator should cover the whole clip — 1s caused a seek every ~2s → 140-720ms stall → 17fps. */
const SEEK_AHEAD_LIMIT = 5;
/** Stand-in frame duration for containers that report none. */
const NOMINAL_FRAME_DUR = 1 / 30;

let input: Input | null = null;
let sink: CanvasSink | null = null;
let duration = 0;
let objectUrl: string | null = null;
// Screen debug — enable via localStorage.setItem("panoptik:debugScreen","1")
let screenDebugLastLog = 0;
let screenDebugFrames = 0;
let screenDebugDecodes = 0;
function screenLog(msg: string, data?: Record<string, unknown>) {
  if (typeof localStorage === "undefined" || localStorage.getItem("panoptik:debugScreen") !== "1") return;
  const now = performance.now();
  if (now - screenDebugLastLog > 1000) {
    console.log(`[Screen] ${msg}`, data ?? "");
    screenDebugLastLog = now;
  }
}

let iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
let iteratorTime = -1;
let presented: { start: number; end: number } | null = null;

let surface: HTMLCanvasElement | OffscreenCanvas | null = null;
let surfaceCtx:
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;

let desiredTime = 0;
let pump: Promise<void> | null = null;
let facecamUrl: string | null = null;

let audioInput: Input | null = null;
let audioUrl: string | null = null;

/**
 * Take the project's audio from a different file than its video.
 *
 * A screen recording is captured with `audio: false` — the microphone is muxed
 * into the camera recording instead. Without this the audio sink would be read
 * from the screen file, which never has an audio track, so narration was
 * recorded and then silently dropped on import.
 */
export async function setAudioBlob(blob: Blob | null): Promise<string | null> {
  if (audioInput) {
    try {
      audioInput.dispose();
    } catch {
      /* already disposed */
    }
    audioInput = null;
  }
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  if (!blob || blob.size === 0) return null;
  try {
    audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await audioInput.getPrimaryAudioTrack();
    if (track && (await track.canDecode())) setAudioSink(track);
  } catch {
    /* keep whatever the clip itself provided */
  }
  // Playback uses a plain <audio> element, which needs its own URL.
  audioUrl = URL.createObjectURL(blob);
  return audioUrl;
}


// ── Facecam decode pipeline ──────────────────────────────────────────────────
// The camera used to be drawn from an <video> whose currentTime was assigned
// and then drawn in the same tick. Seeking a media element is asynchronous, so
// that drew the *previous* frame — during an export, where frames are stepped
// as fast as they encode, the camera lagged and stuttered. Decoding it the same
// way as the clip makes each frame deterministic and awaitable.
let fcInput: Input | null = null;
let fcSink: CanvasSink | null = null;
let fcIterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
let fcIteratorTime = -1;
let fcPresented: { start: number; end: number } | null = null;
let fcSurface: HTMLCanvasElement | OffscreenCanvas | null = null;
let fcSurfaceCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let fcAspect = 16 / 9;
let fcDesired = 0;
let fcPump: Promise<void> | null = null;

/** The decoded camera frame, or null when there is no camera track. */
export function getFacecamSurface(): CanvasImageSource | null {
  return fcPresented ? fcSurface : null;
}

setFacecamFrameSource(getFacecamSurface, getFacecamAspect);

/** Aspect of the camera track, for sizing the PiP. */
export function getFacecamAspect(): number {
  return fcAspect;
}

async function closeFacecamIterator(): Promise<void> {
  const it = fcIterator;
  fcIterator = null;
  fcIteratorTime = -1;
  if (it) {
    try {
      await it.return();
    } catch {
      /* already finished */
    }
  }
}

async function openFacecamSink(blob: Blob): Promise<void> {
  try {
    fcInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await fcInput.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return;
    const w = await track.getDisplayWidth();
    const h = await track.getDisplayHeight();
    fcAspect = h > 0 ? w / h : 16 / 9;
    // The PiP is small on screen; decoding the camera at full size would cost
    // far more than it shows.
    const dw = Math.max(2, Math.min(w, MAX_FACECAM_WIDTH));
    const dh = Math.max(2, Math.round(dw / fcAspect));
    fcSink = new CanvasSink(track, { width: dw, height: dh, fit: "fill", poolSize: 4 });
    if (typeof OffscreenCanvas !== "undefined") {
      const c = new OffscreenCanvas(dw, dh);
      fcSurface = c;
      fcSurfaceCtx = c.getContext("2d");
    } else if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = dw;
      c.height = dh;
      fcSurface = c;
      fcSurfaceCtx = c.getContext("2d");
    }
    if (!fcSurfaceCtx) fcSurface = null;
  } catch {
    fcSink = null;
  }
}

/** Decode the camera frame covering `t`. Coalesces like the clip's pump. */
export async function prepareFacecamFrame(t: number): Promise<void> {
  if (!fcSink) return;
  fcDesired = Math.max(0, t);
  if (!fcPump) {
    fcPump = runFacecamPump().finally(() => {
      fcPump = null;
    });
  }
  return fcPump;
}

async function runFacecamPump(): Promise<void> {
  while (fcSink) {
    const target = fcDesired;
    if (fcPresented && target >= fcPresented.start && target < fcPresented.end) return;

    const continuable =
      fcIterator !== null && target >= fcIteratorTime && target - fcIteratorTime <= SEEK_AHEAD_LIMIT;
    if (!continuable) {
      await closeFacecamIterator();
      if (!fcSink) return;
      fcIterator = fcSink.canvases(target);
      fcIteratorTime = target;
    }

    const active = fcIterator!;
    const { value, done } = await active.next();
    if (active !== fcIterator) continue;

    if (done || !value) {
      await closeFacecamIterator();
      // Past the camera's end, hold its last frame rather than re-seeking.
      if (fcPresented) fcPresented = { start: fcPresented.start, end: Infinity };
      return;
    }

    fcIteratorTime = value.timestamp;
    const end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
    if (!fcPresented || end > target) {
      if (fcSurface && fcSurfaceCtx) {
        fcSurfaceCtx.drawImage(value.canvas as CanvasImageSource, 0, 0, fcSurface.width, fcSurface.height);
      }
      fcPresented = { start: value.timestamp, end };
    }
  }
}

async function teardownFacecam(): Promise<void> {
  fcSink = null;
  const inflight = fcPump;
  await closeFacecamIterator();
  if (inflight) {
    try {
      await inflight;
    } catch {
      /* aborted */
    }
  }
  fcPresented = null;
  fcDesired = 0;
  fcSurface = null;
  fcSurfaceCtx = null;
  fcAspect = 16 / 9;
  if (fcInput) {
    try {
      fcInput.dispose();
    } catch {
      /* already disposed */
    }
    fcInput = null;
  }
}

/** Decode the clip and the camera together, so a frame is complete. */
export async function prepareAllFrames(t: number): Promise<void> {
  await Promise.all([prepareFrame(t), prepareFacecamFrame(t)]);
}

/**
 * Mint the facecam's object URL here so teardown can revoke it alongside the
 * clip's — otherwise every re-import pins another full recording in memory.
 */
export async function setFacecamBlob(blob: Blob | null): Promise<string | null> {
  if (facecamUrl) {
    URL.revokeObjectURL(facecamUrl);
    facecamUrl = null;
  }
  clearFacecamCache();
  await teardownFacecam();
  if (!blob || blob.size === 0) return null;
  facecamUrl = URL.createObjectURL(blob);
  await openFacecamSink(blob);
  return facecamUrl;
}

export async function loadClip(file: File): Promise<Project> {
  await teardown();

  if (file.size < 1024) {
    throw new Error(`File too small (${file.size} bytes) — recording failed or was too short. Try recording for at least 2-3 seconds.`);
  }

  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  } catch (e) {
    throw new Error(`Input has an unsupported or unrecognizable format (type=${file.type || "unknown"}, size=${file.size} bytes). Try a different browser (Chrome recommended) or import an MP4 file instead. Original: ${String(e)}`);
  }
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track found in file — the recording may be corrupted or too short.");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec. Try Chrome/Edge or re-export as MP4 Baseline.");

  const displayWidth = await track.getDisplayWidth();
  const displayHeight = await track.getDisplayHeight();
  const scale = Math.min(1, MAX_DECODE_WIDTH / displayWidth);
  const decodeW = Math.max(2, Math.round(displayWidth * scale));
  const decodeH = Math.max(2, Math.round(displayHeight * scale));

  sink = new CanvasSink(track, {
    width: decodeW,
    height: decodeH,
    fit: "fill",
    poolSize: POOL_SIZE,
  });
  duration = await track.computeDuration();
  createSurface(decodeW, decodeH);

  // ── Unified audio: same Input also yields audio track (single-pass demux) ──
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack && (await audioTrack.canDecode())) {
      setAudioSink(audioTrack);
    } else {
      setAudioSink(null);
    }
  } catch {
    setAudioSink(null);
  }

  objectUrl = URL.createObjectURL(file);
  return {
    id: crypto.randomUUID(),
    clip: { src: objectUrl, duration, width: displayWidth, height: displayHeight },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [], aspectPreset: "source",
  };
}

/**
 * Request the frame covering `t`. Safe to call every animation frame: repeat
 * calls while a decode is in flight only move the target, they never stack up.
 */
export async function prepareFrame(t: number): Promise<void> {
  if (!sink) return;
  screenDebugFrames++;
  if (presented && t >= presented.start && t < presented.end) {
    screenLog("prepareFrame cache hit", { t: t.toFixed(3), window: `${presented.start.toFixed(3)}-${presented.end.toFixed(3)}`, pending: !!pump });
  }
  desiredTime = Math.max(0, t);
  if (!pump) {
    const start = performance.now();
    pump = runPump().finally(() => {
      screenDebugDecodes++;
      screenLog("pump done", { decodes: screenDebugDecodes, frames: screenDebugFrames, took: `${(performance.now() - start).toFixed(1)}ms`, target: t.toFixed(3) });
      pump = null;
    });
  }
  return pump;
}

let pumpFramesDecoded = 0;
let pumpLastLog = 0;
async function runPump(): Promise<void> {
  const pumpStart = performance.now();
  let framesInThisPump = 0;
  while (sink) {
    const target = desiredTime;
    if (presented && target >= presented.start && target < presented.end) {
      if (typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1" && performance.now() - pumpLastLog > 1000) {
        console.log("[Screen] pump cache hit", { target: target.toFixed(3), window: `${presented.start.toFixed(3)}-${presented.end.toFixed(3)}`, framesInThisPump });
        pumpLastLog = performance.now();
      }
      return;
    }

    const continuable =
      iterator !== null &&
      target >= iteratorTime &&
      target - iteratorTime <= SEEK_AHEAD_LIMIT;

    if (!continuable) {
      const seekStart = performance.now();
      await closeIterator();
      if (!sink) return;
      iterator = sink.canvases(target);
      iteratorTime = target;
      if (typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1") {
        console.log("[Screen] seek new iterator", { target: target.toFixed(3), seekTook: `${(performance.now() - seekStart).toFixed(1)}ms` });
      }
    }

    const frameStart = performance.now();
    const active = iterator!;
    const { value, done } = await active.next();
    const frameTook = performance.now() - frameStart;
    if (frameTook > 50 && typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1") {
      console.log("[Screen] slow frame decode", { took: `${frameTook.toFixed(1)}ms`, target: target.toFixed(3), timestamp: value?.timestamp?.toFixed(3) });
    }
    if (active !== iterator) continue;

    if (done || !value) {
      await closeIterator();
      if (presented) presented = { start: presented.start, end: Infinity };
      return;
    }

    iteratorTime = value.timestamp;
    const end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
    if (!presented || end > target) {
      const presentStart = performance.now();
      present(value, end);
      framesInThisPump++;
      pumpFramesDecoded++;
      if (typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1" && performance.now() - pumpLastLog > 1000) {
        const fps = (pumpFramesDecoded / ((performance.now() - pumpStart) / 1000)).toFixed(1);
        console.log("[Screen] video fps", { fps, framesInThisPump, totalDecoded: pumpFramesDecoded, target: target.toFixed(3), presented: `${value.timestamp.toFixed(3)}-${end.toFixed(3)}`, blitTook: `${(performance.now() - presentStart).toFixed(1)}ms` });
        pumpLastLog = performance.now();
      }
    }
  }
}

function present(wrapped: WrappedCanvas, end: number): void {
  // Direct use — poolSize 8 means holding one canvas still leaves 7 for decode.
  // The previous blit to `surface` (drawImage per frame) was ~30% of the 1.8s/frame cost.
  setCurrentFrame(wrapped.canvas);
  presented = { start: wrapped.timestamp, end };
}

function createSurface(w: number, h: number): void {
  surface = null;
  surfaceCtx = null;
  if (typeof OffscreenCanvas !== "undefined") {
    const c = new OffscreenCanvas(w, h);
    surface = c;
    surfaceCtx = c.getContext("2d");
  } else if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    surface = c;
    surfaceCtx = c.getContext("2d");
  }
  if (!surfaceCtx) surface = null;
}

async function closeIterator(): Promise<void> {
  const it = iterator;
  iterator = null;
  iteratorTime = -1;
  if (it) {
    try {
      await it.return();
    } catch {
      /* generator already finished */
    }
  }
}

async function teardown(): Promise<void> {
  sink = null;
  const inflight = pump;
  await closeIterator();
  if (inflight) {
    try {
      await inflight;
    } catch {
      /* decode aborted by teardown */
    }
  }
  presented = null;
  desiredTime = 0;
  duration = 0;
  surface = null;
  surfaceCtx = null;
  setCurrentFrame(null);
  setAudioSink(null);
  await setFacecamBlob(null);
  await setAudioBlob(null);
  if (audioInput) {
    try {
      audioInput.dispose();
    } catch {
      /* already disposed */
    }
    audioInput = null;
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (input) {
    try {
      input.dispose();
    } catch {
      /* already disposed */
    }
    input = null;
  }
}

export function currentFrame(): CanvasImageSource | null {
  return getCurrentFrame();
}
