/**
 * OWNER: DEV A — ROADMAP-A.md Task 3.1.
 * Export via mediabunny Output. Every frame goes through the same renderFrame
 * the preview uses, so what you see is what you get; audio is muxed from the
 * clip's own track. Emits "export-progress" (detail: 0..1) as it goes.
 */
import {
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  QUALITY_VERY_HIGH,
  getFirstEncodableVideoCodec,
  getFirstEncodableAudioCodec,
  type VideoCodec,
  type AudioCodec,
} from "mediabunny";
import type { ExportOpts, Project } from "@panoptik/schema";
import { prepareFrame } from "./decode";
import { renderFrame } from "./render";

/** Long-edge pixel height for each preset; width follows the clip's aspect. */
const RESOLUTION_HEIGHTS: Record<ExportOpts["resolution"], number> = {
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
};

const EXPORT_FPS = 30;

/** Codec preference, best first. The browser picks the first it can encode. */
const MP4_VIDEO: VideoCodec[] = ["avc", "hevc", "av1", "vp9"];
const WEBM_VIDEO: VideoCodec[] = ["vp9", "av1", "vp8"];
const MP4_AUDIO: AudioCodec[] = ["aac", "opus"];
const WEBM_AUDIO: AudioCodec[] = ["opus", "vorbis"];

function emitProgress(value: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("export-progress", { detail: Math.max(0, Math.min(1, value)) }),
  );
}

/**
 * Even dimensions at the requested height, preserving the clip's aspect.
 * Odd sizes are rejected outright by several encoders.
 */
function exportSize(project: Project, resolution: ExportOpts["resolution"]) {
  const aspect = project.clip.width / project.clip.height;
  const height = RESOLUTION_HEIGHTS[resolution];
  const width = Math.round(height * aspect);
  return { width: width - (width % 2), height: height - (height % 2) };
}

export async function exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
  const { width, height } = exportSize(project, opts.resolution);
  const isMp4 = opts.format === "mp4";

  const videoCodec = await getFirstEncodableVideoCodec(isMp4 ? MP4_VIDEO : WEBM_VIDEO, {
    width,
    height,
  });
  if (!videoCodec) {
    throw new Error(
      `This browser cannot encode ${opts.format.toUpperCase()} at ${opts.resolution}. Try WebM, or a lower resolution.`,
    );
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable, so frames cannot be composed");

  const output = new Output({
    format: isMp4 ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, {
    codec: videoCodec,
    quality: QUALITY_VERY_HIGH,
    keyFrameInterval: 2,
  });
  output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });

  // Audio is optional: a screen recording may carry no track at all.
  let audioSource: AudioBufferSource | null = null;
  const audioBuffer = await getExportAudio(project);
  if (audioBuffer) {
    const audioCodec = await getFirstEncodableAudioCodec(isMp4 ? MP4_AUDIO : WEBM_AUDIO, {
      numberOfChannels: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
    });
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
  }

  await output.start();

  const duration = Math.max(0, project.clip.duration);
  const totalFrames = Math.max(1, Math.ceil(duration * EXPORT_FPS));
  const frameDuration = 1 / EXPORT_FPS;

  try {
    for (let i = 0; i < totalFrames; i++) {
      const t = i / EXPORT_FPS;
      // Decode before composing: renderFrame draws whatever frame is current,
      // so without awaiting here every output frame would be the same picture.
      await prepareFrame(t);
      renderFrame(ctx as unknown as CanvasRenderingContext2D, project, t);
      // Awaited so encoder backpressure actually throttles us rather than
      // queueing the whole clip into memory.
      await videoSource.add(t, frameDuration);
      if (i % EXPORT_FPS === 0) emitProgress(i / totalFrames);
    }

    if (audioSource && audioBuffer) {
      await audioSource.add(audioBuffer);
    }

    videoSource.close();
    audioSource?.close();
    await output.finalize();
  } catch (err) {
    try {
      await output.cancel();
    } catch { /* already torn down */ }
    throw err;
  }

  emitProgress(1);

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("Export produced no data");
  return new Blob([buffer], { type: isMp4 ? "video/mp4" : "video/webm" });
}

/** Exposed for unit tests; not part of the engine's public surface. */
export const __test = { exportSize };

/** The clip's audio, or null when it has none we can decode. */
async function getExportAudio(project: Project): Promise<AudioBuffer | null> {
  try {
    const { getAudioBuffer } = await import("./audio");
    return await getAudioBuffer(project);
  } catch {
    return null;
  }
}
