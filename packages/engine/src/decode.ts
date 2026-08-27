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
import { clearFacecamCache, getCurrentFrame, setCurrentFrame } from "./render";
import { setAudioSink } from "./audio";

/** Keep 1920 everywhere on canvas per request — export and preview share res. */
const MAX_DECODE_WIDTH = 1920;
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

/**
 * Mint the facecam's object URL here so teardown can revoke it alongside the
 * clip's — otherwise every re-import pins another full recording in memory.
 */
export function setFacecamBlob(blob: Blob | null): string | null {
  if (facecamUrl) {
    URL.revokeObjectURL(facecamUrl);
    facecamUrl = null;
  }
  clearFacecamCache();
  if (blob && blob.size > 0) facecamUrl = URL.createObjectURL(blob);
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

  try {
    sink = new CanvasSink(track, {
      width: decodeW,
      height: decodeH,
      fit: "fill",
      poolSize: POOL_SIZE,
    });
  } catch (e) {
    console.warn("[Decode] CanvasSink init failed, trying fallback 1280/pool2", e);
    try {
      sink = new CanvasSink(track, {
        width: Math.min(decodeW, 1280),
        height: Math.min(decodeH, 720),
        fit: "fill",
        poolSize: 2,
      });
    } catch (e2) {
      throw new Error(`VideoDecoder failed for ${file.type} ${decodeW}x${decodeH}: ${String(e2)} — try Chrome or H264 MP4. First error: ${String(e)}`);
    }
  }
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
    clickLog: [], aspectPreset: "16:9",
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
    let value: WrappedCanvas | void;
    let done: boolean | undefined;
    try {
      const res = await active.next();
      value = res.value;
      done = res.done;
    } catch (e) {
      console.warn("[Decode] VideoDecoder next() EncodingError — skipping frame", e);
      desiredTime = target + 0.1;
      await closeIterator();
      continue;
    }
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
  setFacecamBlob(null);
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
