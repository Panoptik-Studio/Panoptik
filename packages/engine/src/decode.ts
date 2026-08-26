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
import { getCurrentFrame, setCurrentFrame } from "./render";
import { setAudioSink } from "./audio";

/** Preview decode cap: a 4K source decodes into 1920-wide canvases. */
const MAX_DECODE_WIDTH = 1920;
/** Pooled canvases the sink cycles through — keeps VRAM constant. */
const POOL_SIZE = 4;
/** Forward gap past which a fresh seek beats stepping frame by frame. */
const SEEK_AHEAD_LIMIT = 1;
/** Stand-in frame duration for containers that report none. */
const NOMINAL_FRAME_DUR = 1 / 30;

let input: Input | null = null;
let sink: CanvasSink | null = null;
let duration = 0;
let objectUrl: string | null = null;

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

export async function loadClip(file: File): Promise<Project> {
  await teardown();

  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track found in file");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec");

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
    clickLog: [], aspectPreset: "16:9",
  };
}

/**
 * Request the frame covering `t`. Safe to call every animation frame: repeat
 * calls while a decode is in flight only move the target, they never stack up.
 */
export async function prepareFrame(t: number): Promise<void> {
  if (!sink) return;
  desiredTime = Math.max(0, t);
  if (!pump) {
    pump = runPump().finally(() => {
      pump = null;
    });
  }
  return pump;
}

async function runPump(): Promise<void> {
  while (sink) {
    const target = desiredTime;
    if (presented && target >= presented.start && target < presented.end) return;

    const continuable =
      iterator !== null &&
      target >= iteratorTime &&
      target - iteratorTime <= SEEK_AHEAD_LIMIT;

    if (!continuable) {
      await closeIterator();
      if (!sink) return; // torn down while closing the previous iterator
      iterator = sink.canvases(target);
      iteratorTime = target;
    }

    const active = iterator!;
    const { value, done } = await active.next();
    // Torn down (teardown / seek) while we were awaiting — restart the decision.
    if (active !== iterator) continue;

    if (done || !value) {
      await closeIterator();
      // Past the last frame: hold it open so we don't re-seek on every tick.
      if (presented) presented = { start: presented.start, end: Infinity };
      return;
    }

    iteratorTime = value.timestamp;
    const end = value.timestamp + (value.duration > 0 ? value.duration : NOMINAL_FRAME_DUR);
    // While catching up, skip the blit for frames already behind the target.
    if (!presented || end > target) present(value, end);
  }
}

function present(wrapped: WrappedCanvas, end: number): void {
  if (surface && surfaceCtx) {
    surfaceCtx.drawImage(
      wrapped.canvas as CanvasImageSource,
      0,
      0,
      surface.width,
      surface.height,
    );
    setCurrentFrame(surface);
  } else {
    setCurrentFrame(wrapped.canvas);
  }
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
