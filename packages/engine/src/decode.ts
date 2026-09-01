/**
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
import type { Media, Project } from "@panoptik/schema";
import { FIRST_MEDIA_ID } from "@panoptik/schema";
import { clearFacecamCache, getCurrentFrame, setCurrentFrame, setFacecamFrameSource } from "./render";
import { setAudioBlobFallback, setAudioSink } from "./audio";
import { formatDefaultProjectName } from "./naming";

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
let activeMediaId: string | null = null;

export function getActiveMediaId(): string | null {
  return activeMediaId;
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
let currentExportFrame: WrappedCanvas | null = null;
let nextExportFrame: WrappedCanvas | null = null;
let exportEos = false;

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
const liveObjectUrls = new Set<string>();

function registerObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  liveObjectUrls.add(url);
  return url;
}

export async function setAudioBlob(blob: Blob | null): Promise<string | null> {
  const toDisposeAudio = audioInput;
  audioInput = null;
  if (toDisposeAudio) {
    try {
      await toDisposeAudio.dispose();
    } catch {
      /* already disposed */
    }
  }
  audioUrl = null;
  // Keep fallback for export decodeAudioData path
  setAudioBlobFallback(blob);
  if (!blob || blob.size === 0) {
    return null;
  }
  try {
    audioInput = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    const track = await audioInput.getPrimaryAudioTrack();
    if (track) {
      const can = await track.canDecode();
      if (can) setAudioSink(track);
      else {
        setAudioSink(null);
      }
    } else {
      setAudioSink(null);
    }
  } catch (e) {
    console.warn("[Audio] setAudioBlob: exception", e);
    /* keep whatever the clip itself provided */
  }
  // Playback uses a plain <audio> element, which needs its own URL.
  audioUrl = registerObjectUrl(blob);
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
let fcCurrentExportFrame: WrappedCanvas | null = null;
let fcNextExportFrame: WrappedCanvas | null = null;
let fcExportEos = false;

/** Drop the camera's export iterator so the next export starts from zero. */
export async function resetFacecamExportIterator(): Promise<void> {
  if (fcExportIterator) {
    try { await fcExportIterator.return(); } catch { /* already done */ }
    fcExportIterator = null;
  }
  fcCurrentExportFrame = null;
  fcNextExportFrame = null;
  fcExportEos = false;
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

setFacecamFrameSource(getFacecamSurface, getFacecamAspect, () => facecamUrl);

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
    if (!track) {
      console.warn("[Facecam] openFacecamSink: no primary video track in blob", { type: blob.type, size: blob.size });
      fcSink = null;
      return;
    }
    const can = await track.canDecode();
    if (!can) {
      console.warn("[Facecam] openFacecamSink: track cannot decode");
      fcSink = null;
      return;
    }
    const rawW = await track.getDisplayWidth();
    const rawH = await track.getDisplayHeight();
    const w = rawW > 0 ? rawW : 1280;
    const h = rawH > 0 ? rawH : 720;
    fcAspect = h > 0 ? w / h : 16 / 9;
    // Sized to support full quality in both preview and export.
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
    }
  } catch (err) {
    console.error("[Facecam] openFacecamSink failed", err);
    fcSink = null;
  }
}

/** Decode the camera frame covering `t`. Coalesces like the clip's pump. */
export async function prepareFacecamFrame(t: number): Promise<void> {
  if (!fcSink) return;
  const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
  const qt = Math.max(0, t);
  if (isExporting) {
    if (!fcExportIterator) {
      fcExportIterator = fcSink.canvases(0);
      fcCurrentExportFrame = null;
      fcNextExportFrame = null;
      fcExportEos = false;
    } else if (qt === 0 || (fcCurrentExportFrame && qt < fcCurrentExportFrame.timestamp)) {
      await resetFacecamExportIterator();
      if (!fcSink) return;
      fcExportIterator = fcSink.canvases(0);
    }

    if (!fcCurrentExportFrame && !fcExportEos) {
      const res = await fcExportIterator.next();
      if (res.done || !res.value) {
        fcExportEos = true;
      } else {
        fcCurrentExportFrame = res.value;
        const dur = fcCurrentExportFrame.duration > 0 ? fcCurrentExportFrame.duration : NOMINAL_FRAME_DUR;
        presentFacecam(fcCurrentExportFrame, fcCurrentExportFrame.timestamp + dur);
      }
    }

    while (!fcExportEos) {
      if (!fcNextExportFrame) {
        const res = await fcExportIterator.next();
        if (res.done || !res.value) {
          fcExportEos = true;
          fcNextExportFrame = null;
          break;
        }
        fcNextExportFrame = res.value;
      }

      if (fcNextExportFrame.timestamp <= qt) {
        fcCurrentExportFrame = fcNextExportFrame;
        fcNextExportFrame = null;
        const dur = fcCurrentExportFrame.duration > 0 ? fcCurrentExportFrame.duration : NOMINAL_FRAME_DUR;
        presentFacecam(fcCurrentExportFrame, fcCurrentExportFrame.timestamp + dur);
      } else {
        break;
      }
    }
    return;
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
  const fcToDispose = fcInput;
  fcInput = null;
  if (fcToDispose) {
    try {
      await fcToDispose.dispose();
    } catch {
      /* already disposed */
    }
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
export async function setFacecamBlob(blob: Blob | null, knownUrl?: string | null): Promise<string | null> {
  clearFacecamCache();
  await teardownFacecam();
  if (!blob || blob.size === 0) return null;
  facecamUrl = knownUrl ?? registerObjectUrl(blob);
  await openFacecamSink(blob);
  await prepareFacecamFrame(0);
  return facecamUrl;
}

export async function loadClip(file: File, opts?: { append?: boolean }): Promise<Project> {
  // Serialize against concurrent activateMedia swaps (rAF loop) — otherwise
  // two parallel closePipeline() calls capture the same `input` before either
  // nulls it and the second dispose throws InputDisposedError.
  let result: Project | null = null;
  const runLoad = async () => {
    if (opts?.append) {
      await closePipeline();
      activeMediaId = null;
    } else {
      await teardown();
      activeMediaId = null;
    }
    if (file.size < 1024) {
      throw new Error(`File too small (${file.size} bytes) — recording failed or was too short. Try recording for at least 2-3 seconds.`);
    }
    await openMedia(file);
    objectUrl = URL.createObjectURL(file);
    activeMediaId = FIRST_MEDIA_ID;
    const hasMeaningfulFilename =
      file.name &&
      !/^screen\.(webm|mp4)$/i.test(file.name) &&
      !/^video\.(webm|mp4)$/i.test(file.name) &&
      file.name !== "blob";
    const initialName = hasMeaningfulFilename
      ? file.name.replace(/\.[^/.]+$/, "")
      : formatDefaultProjectName("clip");

    result = {
      id: crypto.randomUUID(),
      name: initialName,
      media: [{ id: FIRST_MEDIA_ID, src: objectUrl, duration, width: inputWidth, height: inputHeight }],
      audioSrc: null,
      segments: [{
        id: crypto.randomUUID(),
        mediaId: FIRST_MEDIA_ID,
        srcStart: 0,
        srcEnd: duration,
        speed: 1,
        stagePadding: 0,
        aspectPreset: "source",
        background: { kind: "solid", color: "#000000" },
        facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
        zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [] }],
      clickLog: [] };
  };
  swapChain = swapChain.then(runLoad, runLoad);
  await swapChain;
  return result!;
}

/** Dimensions of the clip most recently opened by `openMedia`. */
let inputWidth = 0;
let inputHeight = 0;

/**
 * Open the decode pipeline for a Blob/File. Sets `input`, `sink`, `duration`,
 * surface and audio sink. Minting/revoking URLs stays the caller's job — a
 * swap must not revoke project-owned sources.
 */
async function openMedia(blob: Blob): Promise<void> {
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  } catch (e) {
    throw new Error(`Input has an unsupported or unrecognizable format (type=${blob.type || "unknown"}, size=${blob.size} bytes). Try a different browser (Chrome recommended) or import an MP4 file instead. Original: ${String(e)}`);
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
    poolSize: POOL_SIZE });
  duration = await track.computeDuration();
  inputWidth = displayWidth;
  inputHeight = displayHeight;
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
}

/**
 * Swap the decode pipeline to a different clip. The caller (preview/export)
 * drives this — `prepareFrame` only ever sees source time, so it cannot self-
 * resolve which media a segment belongs to. Idempotent per media id.
 *
 * Project-owned blob URLs are NOT revoked here: `closePipeline` stops the
 * decoder but leaves `objectUrl`/`liveObjectUrls` alone, so the old clip can
 * be re-activated later (and still be exported/saved by its project src).
 *
 * Concurrent callers serialize on `swapChain` — the rAF loop and the prefetch
 * both hit this, and two parallel close/open cycles would dispose an Input
 * the other is still reading.
 */
let swapChain: Promise<void> = Promise.resolve();

export function activateMedia(mediaId: string, src: string | null): Promise<void> {
  const run = async () => {
    if (mediaId === activeMediaId) return;
    await closePipeline();
    activeMediaId = null;
    if (!src) return;
    const blob = await (await fetch(src)).blob();
    await openMedia(blob);
    activeMediaId = mediaId;
  };
  swapChain = swapChain.then(run, run);
  return swapChain;
}

/**
 * Read a clip's metadata WITHOUT touching the decode pipeline — the append
 * flow uses this so the currently-playing clip (and every project-owned blob
 * URL) survives the import. The returned media's src is a fresh object URL;
 * the pipeline opens it lazily when one of its segments becomes active.
 */
export async function importClip(file: File): Promise<Media> {
  if (file.size < 1024) {
    throw new Error(`File too small (${file.size} bytes) — recording failed or was too short. Try recording for at least 2-3 seconds.`);
  }
  let probe: Input;
  try {
    probe = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  } catch (e) {
    throw new Error(`Input has an unsupported or unrecognizable format (type=${file.type || "unknown"}, size=${file.size} bytes). Try a different browser (Chrome recommended) or import an MP4 file instead. Original: ${String(e)}`);
  }
  try {
    const track = await probe.getPrimaryVideoTrack();
    if (!track) throw new Error("No video track found in file — the recording may be corrupted or too short.");
    if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec. Try Chrome/Edge or re-export as MP4 Baseline.");
    const duration = await track.computeDuration();
    const width = await track.getDisplayWidth();
    const height = await track.getDisplayHeight();
    return {
      id: crypto.randomUUID(),
      src: URL.createObjectURL(file),
      duration,
      width,
      height };
  } finally {
    try {
      await probe.dispose();
    } catch {
      /* already disposed */
    }
  }
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
  currentExportFrame = null;
  nextExportFrame = null;
  exportEos = false;
  presented = null;
}

export async function prepareFrame(t: number): Promise<void> {
  if (!sink) return;
  const isExporting = typeof window !== "undefined" && (window as unknown as { __isExporting?: boolean }).__isExporting;
  const qt = Math.max(0, t);
  if (isExporting) {
    if (!exportIterator) {
      exportIterator = sink.canvases(0);
      currentExportFrame = null;
      nextExportFrame = null;
      exportEos = false;
    } else if (qt === 0 || (currentExportFrame && qt < currentExportFrame.timestamp)) {
      await resetExportIterator();
      if (!sink) return;
      exportIterator = sink.canvases(0);
    }

    if (!currentExportFrame && !exportEos) {
      const res = await exportIterator.next();
      if (res.done || !res.value) {
        exportEos = true;
      } else {
        currentExportFrame = res.value;
        const dur = currentExportFrame.duration > 0 ? currentExportFrame.duration : NOMINAL_FRAME_DUR;
        present(currentExportFrame, currentExportFrame.timestamp + dur);
      }
    }

    while (!exportEos) {
      if (!nextExportFrame) {
        const res = await exportIterator.next();
        if (res.done || !res.value) {
          exportEos = true;
          nextExportFrame = null;
          break;
        }
        nextExportFrame = res.value;
      }

      if (nextExportFrame.timestamp <= qt) {
        currentExportFrame = nextExportFrame;
        nextExportFrame = null;
        const dur = currentExportFrame.duration > 0 ? currentExportFrame.duration : NOMINAL_FRAME_DUR;
        present(currentExportFrame, currentExportFrame.timestamp + dur);
      } else {
        break;
      }
    }
    return;
  }
  desiredTime = Math.max(0, t);
  if (!pump) {
    pump = runPump().finally(() => {
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
      const active = iterator!;
      const res = await active.next();
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
    if (value.timestamp <= target && target < end) {
      present(value, end);
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

/**
 * Stop the decode pipeline without revoking project-owned URLs.
 *
 * `teardown()` is the full teardown (this + URL revocation + audio/facecam
 * reset) that fresh loads use. The swap path (activateMedia) calls only this —
 * the old clip's blob URLs still belong to the project and must survive a swap
 * so it can be re-activated, exported or saved later.
 */
async function closePipeline(): Promise<void> {
  sink = null;
  const inflight = pump;
  await closeIterator();
  await resetExportIterator();
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
  const toDispose = input;
  input = null;
  if (toDispose) {
    try {
      await toDispose.dispose();
    } catch {
      /* already disposed */
    }
  }
}

async function teardown(): Promise<void> {
  await closePipeline();
  await setFacecamBlob(null);
  await setAudioBlob(null);
  const toDisposeAudio2 = audioInput;
  audioInput = null;
  if (toDisposeAudio2) {
    try {
      await toDisposeAudio2.dispose();
    } catch {
      /* already disposed */
    }
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  for (const url of liveObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  liveObjectUrls.clear();
}

export function currentFrame(): CanvasImageSource | null {
  return getCurrentFrame();
}

const firstVideoTimestampCache = new Map<string, number>();

/**
 * Returns the presentation timestamp (PTS) of the first video frame relative to audio in a media blob.
 *
 * - On macOS, Windows, and Chrome Tab Sharing: Video and audio start synchronously at t=0 (vTs < 0.05s -> returns 0).
 * - On Linux system loopback monitor capture: Audio begins at t=0 while desktop screen capture
 *   first paints ~0.5s-1.0s later (returns vTs to compensate for lead-in audio).
 * - On imported MP4/WebM files: Video starts at t=0 (returns 0).
 *
 * This ensures universal, sample-accurate lip-sync across all OS platforms and capture modes.
 */
export async function getFirstVideoTimestamp(blob: Blob, srcKey?: string): Promise<number> {
  if (srcKey && firstVideoTimestampCache.has(srcKey)) {
    return firstVideoTimestampCache.get(srcKey)!;
  }
  try {
    const probe = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await probe.getPrimaryVideoTrack();
      const aTrack = await probe.getPrimaryAudioTrack();
      // If there is no audio track or no video track, there is no relative offset to align
      if (!track || !aTrack) {
        if (srcKey) firstVideoTimestampCache.set(srcKey, 0);
        return 0;
      }
      const s = new CanvasSink(track, { width: 64, height: 64, fit: "fill", poolSize: 1 });
      const it = s.canvases(0);
      const res = await it.next();
      try { await it.return(); } catch {}
      const ts = (!res.done && res.value && typeof res.value.timestamp === "number") ? res.value.timestamp : 0;
      // If first video timestamp is close to 0 (< 50ms), tracks started synchronously (Mac/Windows/Tab Share) -> no shift
      const delta = ts >= 0.05 ? ts : 0;
      if (srcKey) firstVideoTimestampCache.set(srcKey, delta);
      if (delta > 0) {
        console.log("[Decode] Compensating screen audio offset:", delta.toFixed(3), "s", srcKey ? `(${srcKey})` : "");
      }
      return delta;
    } finally {
      try { await probe.dispose(); } catch {}
    }
  } catch (e) {
    console.warn("[Decode] failed to probe firstVideoTimestamp:", e);
    return 0;
  }
}