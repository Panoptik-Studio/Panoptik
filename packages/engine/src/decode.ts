/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.4.
 * mediabunny Input/VideoSampleSink decode path with a ring-buffer cache.
 * Time is quantized to 30fps steps so the buffer actually hits during 60fps rAF.
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import type { Project } from "@panoptik/schema";
import { setCurrentFrame, getCurrentFrame } from "./render";

let input: Input | null = null;
let sink: VideoSampleSink | null = null;

const FPS = 30;
const BUFFER_SIZE = 6;
const frameBuffer: Map<number, { sample: VideoSample; frame: VideoFrame }> = new Map();
let prefetchTarget = -1;
let duration = 0;
let lastSample: VideoSample | null = null;

/** Snap time to nearest 1/FPS boundary so 60fps rAF ticks share cached frames. */
function quantize(t: number): number {
  return Math.round(t * FPS) / FPS;
}

export async function loadClip(file: File): Promise<Project> {
  teardown();

  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track found in file");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec");
  sink = new VideoSampleSink(track);
  duration = await track.computeDuration();
  return {
    id: crypto.randomUUID(),
    clip: { src: URL.createObjectURL(file), duration, width: track.displayWidth, height: track.displayHeight },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [], aspectPreset: "16:9",
  };
}

export async function prepareFrame(t: number): Promise<void> {
  if (!sink) return;
  const qt = quantize(t);

  // Evict stale entries (keep current frame safe)
  const curFrame = getCurrentFrame();
  for (const [ts, entry] of frameBuffer) {
    if (ts < qt - 1 || frameBuffer.size > BUFFER_SIZE + 2) {
      if (entry.frame !== curFrame) {
        entry.frame.close();
        entry.sample.close();
        frameBuffer.delete(ts);
      }
    }
  }

  // Cache hit — just promote
  const existing = frameBuffer.get(qt);
  if (existing) {
    setCurrentFrame(existing.frame);
    lastSample = existing.sample;
    prefetch(qt);
    return;
  }

  // Cache miss — decode and store
  const sample = await sink.getSample(Math.max(0, qt));
  if (sample) {
    const frame = typeof sample.toVideoFrame === "function" ? sample.toVideoFrame() : null;
    if (frame) {
      frameBuffer.set(qt, { sample, frame });
      setCurrentFrame(frame);
    }
    lastSample = sample;
  }
  prefetch(qt);
}

function prefetch(fromT: number) {
  if (!sink || prefetchTarget === fromT) return;
  prefetchTarget = fromT;
  void runPrefetch(fromT);
}

async function runPrefetch(fromT: number) {
  if (!sink) return;
  for (let i = 1; i <= BUFFER_SIZE; i++) {
    const t = quantize(fromT + i / FPS);
    if (t >= duration) break;
    if (frameBuffer.has(t)) continue;
    const sample = await sink.getSample(t);
    if (sample) {
      const frame = typeof sample.toVideoFrame === "function" ? sample.toVideoFrame() : null;
      if (frame) frameBuffer.set(t, { sample, frame });
    }
  }
}

function teardown() {
  for (const entry of frameBuffer.values()) {
    entry.frame.close();
    entry.sample.close();
  }
  frameBuffer.clear();
  prefetchTarget = -1;
  lastSample = null;
  setCurrentFrame(null);
  if (input) { try { input.dispose(); } catch {} }
}

export function currentFrame(): VideoSample | null {
  return lastSample;
}
