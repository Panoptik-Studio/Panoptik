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
import { presetAspect } from "./layout";
<<<<<<< HEAD
import { prepareAllFrames } from "./decode";
=======
import { prepareFrame, resetExportIterator } from "./decode";
>>>>>>> a30e6c3 (refactor: improve export reliability with sequential iterator resets, robust AAC codec probing, and export state signaling)
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
  // The preset decides the frame's shape; the resolution decides its height.
  const aspect = presetAspect(project.aspectPreset, project.clip.width, project.clip.height);
  const height = RESOLUTION_HEIGHTS[resolution];
  const width = Math.round(height * aspect);
  return { width: width - (width % 2), height: height - (height % 2) };
}

export async function exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
  // Signal preview to pause its own prepareFrame — they share the global CanvasSink pump.
  // Also drives decode.ts's sequential exportIterator path that avoids the avc1
  // seek-storm at tail (130ms per seek) seen on Linux mp4. The flag was added in
  // 21f6199, lost in 891c233's revert, and left dead in 6cde3e6 so export fell
  // back to runPump and stuck at 14.8s (see decode logs: repeated seek 14.800 → 14.760).
  if (typeof window !== "undefined") (window as unknown as { __isExporting?: boolean }).__isExporting = true;
  // Reset sequential iterator so a second export starts from 0, not EOS.
  try {
<<<<<<< HEAD
    for (let i = 0; i < totalFrames; i++) {
      const t = i / EXPORT_FPS;
      // Decode before composing: renderFrame draws whatever frame is current,
      // so without awaiting here every output frame would be the same picture.
      await prepareAllFrames(t);
      renderFrame(ctx as unknown as CanvasRenderingContext2D, project, t);
      // Awaited so encoder backpressure actually throttles us rather than
      // queueing the whole clip into memory.
      await videoSource.add(t, frameDuration);
      if (i % EXPORT_FPS === 0) emitProgress(i / totalFrames);
=======
    await resetExportIterator();
  } catch { /* ignore */ }
  try {
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
>>>>>>> a30e6c3 (refactor: improve export reliability with sequential iterator resets, robust AAC codec probing, and export state signaling)
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
    console.log("[Export] audioBuffer", audioBuffer ? { dur: audioBuffer.duration.toFixed(2), sr: audioBuffer.sampleRate, ch: audioBuffer.numberOfChannels, len: audioBuffer.length } : null);
    if (audioBuffer) {
      // For mp4, `aac` is universally supported in players but not encodable on
      // Linux Chrome (no proprietary codec). `opus` in mp4 plays in browsers but
      // NOT in COSMIC/GStreamer players (Pop!_OS) — user reported browser OK,
      // COSMIC silent. Try aac with multiple configs before falling back to opus.
      let audioCodec: AudioCodec | null = null;
      if (isMp4) {
        const tryAacConfigs: Array<{ numberOfChannels: number; sampleRate: number }> = [
          { numberOfChannels: audioBuffer.numberOfChannels, sampleRate: audioBuffer.sampleRate },
          { numberOfChannels: 2, sampleRate: audioBuffer.sampleRate },
          { numberOfChannels: audioBuffer.numberOfChannels, sampleRate: 44100 },
          { numberOfChannels: 2, sampleRate: 44100 },
          { numberOfChannels: 1, sampleRate: 48000 },
          { numberOfChannels: 2, sampleRate: 48000 },
        ];
        for (const cfg of tryAacConfigs) {
          const c = await getFirstEncodableAudioCodec(["aac"] as AudioCodec[], cfg);
          if (c) { audioCodec = c; console.log("[Export] aac encodable with", cfg, "->", c); break; }
        }
        if (!audioCodec) {
          audioCodec = await getFirstEncodableAudioCodec(["opus"] as AudioCodec[], {
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
          });
          if (audioCodec) {
            console.warn("[Export] mp4: aac not encodable on this browser (Linux Chrome), falling back to opus. Opus-in-mp4 plays in browsers but NOT in COSMIC/GStreamer players. For native playback, export as WebM.");
          }
        }
      } else {
        audioCodec = await getFirstEncodableAudioCodec(WEBM_AUDIO, {
          numberOfChannels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
        });
      }
      console.log("[Export] audioCodec for", isMp4 ? "mp4" : "webm", "->", audioCodec, "candidates", isMp4 ? MP4_AUDIO : WEBM_AUDIO);
      if (audioCodec) {
        audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
        output.addAudioTrack(audioSource);
        console.log("[Export] audio track added", audioCodec, "to", isMp4 ? "mp4" : "webm");
      } else {
        console.warn("[Export] no encodable audio codec -> silent. Try WebM on Linux.");
      }
    } else {
      console.warn("[Export] no audioBuffer -> silent export (preview uses <audio> blob URL, different decoder)");
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
        console.log("[Export] adding audio buffer to muxer", audioBuffer.duration.toFixed(2), "s");
        await audioSource.add(audioBuffer);
        console.log("[Export] audio added");
      } else {
        console.log("[Export] skipping audio mux (silent)", { hasSource: !!audioSource, hasBuffer: !!audioBuffer });
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
  } finally {
    if (typeof window !== "undefined") (window as unknown as { __isExporting?: boolean }).__isExporting = false;
  }
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
