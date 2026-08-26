/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.4.
 * mediabunny Input/VideoSampleSink decode path with a single-frame cache.
 * Required API: loadClip(file): Promise<Project>, prepareFrame(t), currentFrame().
 */
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import type { Project } from "@panoptik/schema";

let input: Input | null = null;
let sink: VideoSampleSink | null = null;
let cached: { sample: VideoSample; t: number } | null = null;

export async function loadClip(file: File): Promise<Project> {
  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track found in file");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec");
  sink = new VideoSampleSink(track);
  const duration = await track.computeDuration();
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
  if (!sink || cached?.t === t) return;
  cached?.sample.close();
  const sample = await sink.getSample(Math.max(0, t));
  if (sample) cached = { sample, t };
}

export function currentFrame(): VideoSample | null {
  return cached?.sample ?? null;
}
