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
import { setAudioBlobFallback, setAudioSink } from "./audio";

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
let pendingFrame: WrappedCanvas | null = null;
let pendingFrameEnd = 0;

let surface: HTMLCanvasElement | OffscreenCanvas | null = null;
let surfaceCtx:
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D
  | null = null;

let desiredTime = 0;
let pump: Promise<void> | null = null;
let facecamUrl: string | null = null;
let exportIterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;

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
  // Keep fallback for export decodeAudioData path
  setAudioBlobFallback(blob);
  if (!blob || blob.size === 0) {
    console.log("[Audio] setAudioBlob: empty blob");
    return null;
  }
  try {
    audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await audioInput.getPrimaryAudioTrack();
    console.log("[Audio] setAudioBlob: track", !!track, "blob", `${blob.type} ${blob.size}`);
    if (track) {
      const can = await track.canDecode();
      console.log("[Audio] setAudioBlob: canDecode", can);
      if (can) setAudioSink(track);
      else {
        console.warn("[Audio] setAudioBlob: track cannot be decoded -> preview will work (blob URL) but export will be silent");
        setAudioSink(null);
      }
    } else {
      console.warn("[Audio] setAudioBlob: no audio track found");
      setAudioSink(null);
    }
  } catch (e) {
    console.warn("[Audio] setAudioBlob: exception", e);
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
let fcPendingFrame: WrappedCanvas | null = null;
let fcPendingFrameEnd = 0;
let fcSurface: HTMLCanvasElement | OffscreenCanvas | null = null;
let fcSurfaceCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
let fcAspect = 16 / 9;
let fcDesired = 0;
let fcPump: Promise<void> | null = null;
let fcExportIterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;

/** Drop the camera's export iterator so the next export starts from zero. */
export async function resetFacecamExportIterator(): Promise<void> {
  if (fcExportIterator) {
    try { await fcExportIterator.return(); } catch { /* already done */ }
    fcExportIterator = null;
  }
  fcPresented = null;
}

/** Blit a decoded camera frame onto the surface renderFrame reads. */
function presentFacecam(value: WrappedCanvas, end: number, start = value.timestamp): void {
  if (fcSurface && fcSurfaceCtx) {
    fcSurfaceCtx.drawImage(value.canvas as CanvasImageSource, 0, 0, fcSurface.width, fcSurface.height);
  }
  fcPresented = { start, end };
}

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
  fcPendingFrame = null;
  fcPendingFrameEnd = 0;
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
    if (!fcSurfaceCtx) {
      fcSurface = null;
    } else {
      // Decode initial frame right away so getFacecamSurface() is immediately available
      try {
        const it = fcSink.canvases(0);
        const first = await it.next();
        if (first.value) {
          presentFacecam(first.value, first.value.timestamp + (first.value.duration > 0 ? first.value.duration : NOMINAL_FRAME_DUR));
        }
        await it.return?.();
      } catch {
        /* ignore */
      }
    }
  } catch {
    fcSink = null;
  }
}

/** Decode the camera frame covering `t`. Coalesces like the clip's pump. */
export async function prepareFacecamFrame(t: number): Promise<void> {
  if (!fcSink) return;
  const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
  const qt = Math.max(0, t);
  if (isExporting) {
    // Same sequential sweep as the screen: one forward iterator over the whole
    // export, no seeking. The camera has to be stepped alongside the screen or
    // its surface keeps whatever frame the preview happened to leave there,
    // and every exported frame shows that one still image.
    if (!fcExportIterator) fcExportIterator = fcSink.canvases(0);
    else if (qt === 0) {
      await resetFacecamExportIterator();
      fcExportIterator = fcSink.canvases(0);
    } else if (fcPresented && qt < fcPresented.start) {
      await resetFacecamExportIterator();
      fcExportIterator = fcSink.canvases(0);
    }
    while (true) {
      if (fcPresented && qt >= fcPresented.start && qt < fcPresented.end) return;
      const { value, done } = await fcExportIterator.next();
      if (done || !value) {
        // The camera is usually shorter than the screen; hold its last frame
        // rather than spinning on done for the remaining screen frames.
        if (fcPresented) fcPresented = { start: fcPresented.start, end: Infinity };
        return;
      }
      const end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
      if (value.timestamp > qt) {
        // A hole: the camera recorded nothing at qt, so no frame will ever
        // contain it. Without this the loop drains the whole track hunting for
        // one and the camera freezes for the rest of the export — which is the
        // 2.7s stall the export timeout was working around.
        presentFacecam(value, end, Math.min(value.timestamp, qt));
        return;
      }
      presentFacecam(value, end);
      if (qt < end) return;
    }
  }
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

    // If we buffered the next frame while handling a hole, use it before pulling a new one.
    let value: WrappedCanvas | undefined;
    let done: boolean | undefined;
    let end: number;
    if (fcPendingFrame) {
      value = fcPendingFrame;
      done = false;
      end = fcPendingFrameEnd;
      fcPendingFrame = null;
      fcPendingFrameEnd = 0;
    } else {
      const active = fcIterator!;
      const res = await active.next();
      if (active !== fcIterator) continue;
      if (res.done || !res.value) {
        await closeFacecamIterator();
        // Past the camera's end, hold its last frame rather than re-seeking.
        if (fcPresented) {
          fcPresented = { start: fcPresented.start, end: Infinity };
        } else {
          try {
            const it0 = fcSink.canvases(0);
            const f0 = await it0.next();
            if (f0.value) {
              presentFacecam(f0.value, Infinity);
            }
            await it0.return?.();
          } catch {}
        }
        return;
      }
      value = res.value;
      done = res.done;
      fcIteratorTime = value.timestamp;
      end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
    }
    if (value) fcIteratorTime = value.timestamp;

    // Only the frame whose interval contains the target, and stop at the first
    // frame past it — the same seek-storm and hole hazards as the screen pump.
    if (value.timestamp <= target && target < end) {
      presentFacecam(value, end);
    } else if (value.timestamp > target) {
      if (!fcPresented) presentFacecam(value, end, Math.min(value.timestamp, target));
      else {
        fcPendingFrame = value;
        fcPendingFrameEnd = end;
        fcPresented = { start: fcPresented.start, end: value.timestamp };
      }
      return;
    }
  }
}

async function teardownFacecam(): Promise<void> {
  fcSink = null;
  await resetFacecamExportIterator();
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
export async function prepareAllFrames(t: number, fcT?: number): Promise<void> {
  await Promise.all([prepareFrame(t), prepareFacecamFrame(fcT !== undefined ? fcT : t)]);
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
    media: { src: objectUrl, duration, width: displayWidth, height: displayHeight },
    audioSrc: null,
    segments: [{
      id: crypto.randomUUID(),
      srcStart: 0,
      srcEnd: duration,
      speed: 1,
      stagePadding: 0,
      aspectPreset: "source",
      background: { kind: "solid", color: "#000000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
      captions: [], stagedCaptions: [],
    }],
    clickLog: [],
  };
}

/**
 * Request the frame covering `t`. Safe to call every animation frame: repeat
 * calls while a decode is in flight only move the target, they never stack up.
 */
export async function resetExportIterator(): Promise<void> {
  if (exportIterator) {
    try { await exportIterator.return(); } catch { /* already done */ }
    exportIterator = null;
  }
  // Don't clear `presented` here — the preview may be on a different t.
  // The next export will iterate from 0 and overwrite it as it steps.
}

export async function prepareFrame(t: number): Promise<void> {
  if (!sink) return;
  const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
  const qt = Math.max(0, t);
  if (isExporting) {
    // Sequential path avoids the SEEK_AHEAD_LIMIT seek-storm that on Linux
    // mp4/avc1 causes 130ms VideoDecoder re-init per frame at tail (14.8s).
    // One forward iterator from 0 covers the whole export with no seeks.
    if (!exportIterator) exportIterator = sink.canvases(0);
    else if (qt === 0) {
      // Second export in same session must start over, not resume at EOS.
      await resetExportIterator();
      exportIterator = sink.canvases(0);
    } else if (presented && qt < presented.start) {
      // Non-monotonic jump backwards (shouldn't happen in export's 0..duration
      // sweep, but guards against a stale iterator after a preview seek).
      await resetExportIterator();
      exportIterator = sink.canvases(0);
    }
    while (true) {
      if (presented && qt >= presented.start && qt < presented.end) return;
      const { value, done } = await exportIterator.next();
      if (done || !value) {
        // Past EOS: hold last frame so renderFrame still has something to draw.
        // Extend presented to Infinity so future tail frames are cache hits
        // instead of spinning on done.
        if (presented) presented = { start: presented.start, end: Infinity };
        return;
      }
      const end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
      present(value, end);
      if (qt >= value.timestamp && qt < end) return;
    }
  }
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

    // If we buffered the next frame while handling a hole, use it before pulling a new one.
    let value: WrappedCanvas | undefined;
    let done: boolean | undefined;
    let end: number;
    if (pendingFrame) {
      value = pendingFrame;
      done = false;
      end = pendingFrameEnd;
      pendingFrame = null;
      pendingFrameEnd = 0;
      // iteratorTime already reflects this frame's timestamp from when it was buffered
    } else {
      const frameStart = performance.now();
      const active = iterator!;
      const res = await active.next();
      const frameTook = performance.now() - frameStart;
      if (frameTook > 50 && typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1") {
        console.log("[Screen] slow frame decode", { took: `${frameTook.toFixed(1)}ms`, target: target.toFixed(3), timestamp: res.value?.timestamp?.toFixed(3) });
      }
      if (active !== iterator) continue;
      if (res.done || !res.value) {
        await closeIterator();
        if (presented) presented = { start: presented.start, end: Infinity };
        return;
      }
      value = res.value;
      done = res.done;
      iteratorTime = value.timestamp;
      end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
    }
    // Ensure iteratorTime is set for pending path as well (already set when buffered)
    if (value) iteratorTime = value.timestamp;
    // Only present the frame whose interval [timestamp, end) contains target.
    // The old `!presented || end > target` also presented future frames that
    // start *after* target (e.g. 14.811 when target is 14.800) which made
    // `presented.start > target`, so the cache check `target >= presented.start`
    // failed and the next loop thought `target < iteratorTime` → not
    // continuable → seek. That seek-storm repeated 130ms VideoDecoder re-inits
    // on Linux mp4/avc1 and looked like an infinite hang at tail (14.8s).
    if (value.timestamp <= target && target < end) {
      const presentStart = performance.now();
      present(value, end);
      framesInThisPump++;
      pumpFramesDecoded++;
      if (typeof localStorage !== "undefined" && localStorage.getItem("panoptik:debugScreen") === "1" && performance.now() - pumpLastLog > 1000) {
        const fps = (pumpFramesDecoded / ((performance.now() - pumpStart) / 1000)).toFixed(1);
        console.log("[Screen] video fps", { fps, framesInThisPump, totalDecoded: pumpFramesDecoded, target: target.toFixed(3), presented: `${value.timestamp.toFixed(3)}-${end.toFixed(3)}`, blitTook: `${(performance.now() - presentStart).toFixed(1)}ms` });
        pumpLastLog = performance.now();
      }
    } else if (value.timestamp > target) {
      // Walked past the target without a frame covering it. Variable-rate
      // footage emits nothing while the picture is still, so the timeline has
      // holes: the frame before the hole is what should be on screen for its
      // whole span. Without this the loop keeps pulling frames looking for a
      // cover that does not exist, decoding to the end of the file for a single
      // request — and then, with presented.end left at Infinity, every later
      // request is a false cache hit and the picture freezes for the rest of
      // the export.
      if (!presented) {
        // Nothing shown yet and the earliest available frame is already past
        // the target, so it is the best answer — and the window has to reach
        // back over the target, or the next request repeats this scan.
        present(value, end, Math.min(value.timestamp, target));
      } else {
        // Hold the frame before the hole until the next one actually begins,
        // but don't lose the next frame — buffer it so the following request
        // can present it instead of skipping it (which caused the 8.9s+ freeze
        // where the stale frame was held indefinitely and the preview dropped
        // to 0 effective fps while the decode appeared "cache hit").
        pendingFrame = value;
        pendingFrameEnd = end;
        presented = { start: presented.start, end: value.timestamp };
      }
      return;
    }
  }
}

function present(wrapped: WrappedCanvas, end: number, start = wrapped.timestamp): void {
  // Direct use — poolSize 8 means holding one canvas still leaves 7 for decode.
  // The previous blit to `surface` (drawImage per frame) was ~30% of the 1.8s/frame cost.
  setCurrentFrame(wrapped.canvas);
  presented = { start, end };
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
  pendingFrame = null;
  pendingFrameEnd = 0;
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
  if (exportIterator) {
    try { await exportIterator.return(); } catch { /* already done */ }
    exportIterator = null;
  }
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
