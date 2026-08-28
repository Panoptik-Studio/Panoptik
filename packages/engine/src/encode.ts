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
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import type { ExportOpts, Project } from "@panoptik/schema";
import { presetAspect } from "./layout";
import { prepareAllFrames, resetExportIterator, resetFacecamExportIterator } from "./decode";
import { ensureBackgroundImages, renderFrame } from "./render";
import { concatAudio, sliceAndStretchAudio } from "./timeStretch";
import { projectDuration, segmentDuration } from "./timeline";

// Register WASM AAC encoder fallback so all platforms/browsers (including Linux Chrome/Chromium)
// can encode genuine, universal AAC audio in MP4 files.
try {
  registerAacEncoder();
} catch (e) {
  console.warn("[Export] could not register AAC encoder fallback", e);
}

/** Long-edge pixel height for each preset; width follows the media's aspect. */
const RESOLUTION_HEIGHTS: Record<ExportOpts["resolution"], number> = {
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
};

const EXPORT_FPS = 30;

/** Codec preference, best first. The browser picks the first it can encode.
 * For maximal native-player compatibility:
 * - MP4: avc (H.264) + aac is gold (every player: VLC/MPV/COSMIC/GStreamer/QuickTime)
 * - WebM: vp8 + vorbis is the original webm combo in GStreamer-good (installed
 *   by default on Pop!_OS). vp9/opus are in -bad and often missing, so we
 *   prioritize vp8/vorbis for the mp4->webm fallback. User-requested webm still
 *   prefers vp9/opus for quality, but the fallback will try vorbis/vp8 first.
 */
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
 * Export options plus the editor's current selection. The preview sizes itself
 * to the SELECTED segment's aspect preset, so export must resolve the frame to
 * the same segment or what you see is not what you get.
 */
export type ExportFrameOpts = ExportOpts & { selectedSegmentId?: string };

/**
 * Even dimensions at the requested height, preserving the clip's aspect.
 * Odd sizes are rejected outright by several encoders.
 */
function exportSize(
  project: Project,
  resolution: ExportOpts["resolution"],
  selectedSegmentId?: string,
) {
  // The selected segment's preset decides the frame's shape (matching the
  // preview canvas); no selection falls back to the first segment. "source"
  // defers to the media, so it never bars.
  const seg =
    project.segments.find((s) => s.id === selectedSegmentId) ??
    project.segments[0];
  const aspect = presetAspect(seg?.aspectPreset ?? "source", project.media);
  const height = RESOLUTION_HEIGHTS[resolution];
  const width = Math.round(height * aspect);
  return { width: width - (width % 2), height: height - (height % 2) };
}

export async function exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob> {
  // Signal preview to pause its own prepareFrame — they share the global CanvasSink pump.
  // Also drives decode.ts's sequential exportIterator path that avoids the avc1
  // seek-storm at tail (130ms per seek) seen on Linux mp4. The flag was added in
  // 21f6199, lost in 891c233's revert, and left dead in 6cde3e6 so export fell
  // back to runPump and stuck at 14.8s (see decode logs: repeated seek 14.800 → 14.760).
  if (typeof window !== "undefined") (window as unknown as { __isExporting?: boolean }).__isExporting = true;
  // Reset sequential iterator so a second export starts from 0, not EOS.
  try {
    // Image backgrounds decode up front. renderFrame is synchronous, so an image
  // that is not ready by the time the loop starts would be missing from the
  // exported frames while still showing in the preview.
  await ensureBackgroundImages(project);

  await resetExportIterator();
    // The camera has its own iterator and must rewind with the screen.
    await resetFacecamExportIterator();
  } catch { /* ignore */ }
  try {
    const { width, height } = exportSize(project, opts.resolution, opts.selectedSegmentId);
    const requestedIsMp4 = opts.format === "mp4";
    console.log("[Export]", project.segments.map((s) => `seg ${s.id} ${s.srcStart}-${s.srcEnd} @${s.speed}x`).join(" | "));

    // Need audioBuffer early to decide container when aac not encodable.
    // For maximal compatibility: mp4+avc+aac is the gold standard for every
    // native player (VLC, MPV, COSMIC/GStreamer, QuickTime). Linux Chrome
    // can't encode aac via WebCodecs, so mp4 would fall back to opus-in-mp4
    // which is browser-only. In that case we transparently switch to
    // webm+vp9+opus which is the next-most compatible and works on Pop!_OS.
    const audioBuffer = await getExportAudio(project);
    console.log("[Export] audioBuffer", audioBuffer ? { dur: audioBuffer.duration.toFixed(2), sr: audioBuffer.sampleRate, ch: audioBuffer.numberOfChannels, len: audioBuffer.length } : null);

    const actualIsMp4 = requestedIsMp4;
    let audioCodec: AudioCodec | null = null;
    if (audioBuffer) {
      if (requestedIsMp4) {
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
          // If AAC encoder is not available (e.g. Linux Chromium/Chrome), mux with Opus in MP4
          audioCodec = await getFirstEncodableAudioCodec(["opus"] as AudioCodec[], {
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
          });
          if (audioCodec) {
            console.log("[Export] aac not encodable, encoding opus audio into MP4 container");
          }
        }
      } else {
        audioCodec = await getFirstEncodableAudioCodec(WEBM_AUDIO, {
          numberOfChannels: audioBuffer.numberOfChannels,
          sampleRate: audioBuffer.sampleRate,
        });
      }
      console.log("[Export] audioCodec for", requestedIsMp4 ? "mp4" : "webm", "requested ->", audioCodec, "actual", actualIsMp4 ? "mp4" : "webm", "candidates", requestedIsMp4 ? MP4_AUDIO : WEBM_AUDIO);
    } else {
      console.warn("[Export] no audioBuffer -> silent export (preview uses <audio> blob URL, different decoder)");
    }

    const videoCodec = await getFirstEncodableVideoCodec(
      actualIsMp4 ? MP4_VIDEO : WEBM_VIDEO,
      {
        width,
        height,
      },
    );
    if (!videoCodec) {
      throw new Error(
        `This browser cannot encode ${(actualIsMp4 ? "mp4" : "webm").toUpperCase()} at ${opts.resolution}. Try ${actualIsMp4 ? "WebM" : "MP4"}, or a lower resolution.`,
      );
    }
    console.log("[Export] videoCodec", videoCodec, "for", actualIsMp4 ? "mp4" : "webm", "requested was", opts.format);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable, so frames cannot be composed");

    const output = new Output({
      format: actualIsMp4 ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });

    const videoSource = new CanvasSource(canvas, {
      codec: videoCodec,
      quality: QUALITY_VERY_HIGH,
      keyFrameInterval: 2,
      onEncoderConfig: (config) => {
        // OpenH264 (Chromium on Linux) is Constrained Baseline Profile (0x42, compatibility 0xE0).
        // Mediabunny defaults to High Profile (avc1.64...) which causes corrupt/unsupported NAL
        // streams in OpenH264 on Linux. Switch to Constrained Baseline (avc1.42E0...)
        // for 100% universal player compatibility across Linux/macOS/Windows.
        if (config.codec.startsWith("avc1.64") || config.codec.startsWith("avc1.4d")) {
          const levelHex = config.codec.slice(-2);
          config.codec = `avc1.42E0${levelHex}`;
          console.log("[Export] adjusted AVC encoder config to Constrained Baseline:", config.codec);
        }
      },
    });
    output.addVideoTrack(videoSource, { frameRate: EXPORT_FPS });

    // Audio is optional: a screen recording may carry no track at all.
    let audioSource: AudioBufferSource | null = null;
    if (audioBuffer && audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
      console.log("[Export] audio track added", audioCodec, "to", actualIsMp4 ? "mp4" : "webm");
    } else if (audioBuffer) {
      console.warn("[Export] no encodable audio codec -> silent. Try WebM on Linux.");
    }

    // Pitch-preserving per-segment time-stretch. The old path stretched the
    // whole clip by a single playbackRate (and before that used vari-speed
    // playbackRate, which raised pitch like a chipmunk). Speed is now per
    // segment: each segment's source window is sliced out and stretched to its
    // own timeline length, then concatenated so the muxed audio matches video.
    let spedAudioBuffer: AudioBuffer | null = audioBuffer;
    if (audioBuffer) {
      try {
        const parts = project.segments.map((seg) => sliceAndStretchAudio(audioBuffer, seg));
        spedAudioBuffer = concatAudio(parts);
        console.log("[Export] per-segment audio windows", { parts: parts.length, from: audioBuffer.duration.toFixed(2), to: spedAudioBuffer.duration.toFixed(2), segments: project.segments.map((s) => `${s.srcStart}-${s.srcEnd}@${s.speed}x`) });
      } catch (e) {
        console.warn("[Export] audio time-stretch failed, using original", e);
        spedAudioBuffer = audioBuffer;
      }
    }

    await output.start();

    const totalTimeline = projectDuration(project);
    const frameDuration = 1 / EXPORT_FPS;

    try {
      // Temporal mapping: renderFrame resolves the active segment from timeline
      // time, so we step each segment at its own speed and feed it the absolute
      // timeline cursor. Frames decode at source time (srcT) which changes with
      // segment speed; present times are timeline time.
      let timelineCursor = 0;
      for (const seg of project.segments) {
        const dur = segmentDuration(seg);
        const totalFrames = Math.max(1, Math.ceil(dur * EXPORT_FPS));
        for (let i = 0; i < totalFrames; i++) {
          const tEff = i / EXPORT_FPS;
          const srcT = seg.srcStart + tEff * seg.speed;
          // Decode before composing: renderFrame draws whatever frame is current,
          // so without awaiting here every output frame would be the same picture.
          // Use prepareAllFrames so cam+screen stay synced at speed (facecam pump now fixed for holes, no more scan-to-EOF stall at 2.7s)
          if (i % 60 === 0) console.log("[Export] frame", i, "/", totalFrames, "seg", seg.id, "tEff", tEff.toFixed(2), "srcT", srcT.toFixed(2));
          const fcStartT = seg.facecam?.startT ?? 0;
          const fcT = Math.max(0, (timelineCursor + tEff) - fcStartT);
          await prepareAllFrames(srcT, fcT);
          renderFrame(ctx as unknown as CanvasRenderingContext2D, project, timelineCursor + tEff);
          // Awaited so encoder backpressure actually throttles us rather than
          // queueing the whole clip into memory.
          await videoSource.add(timelineCursor + tEff, frameDuration);
          if (i % EXPORT_FPS === 0) emitProgress(totalTimeline > 0 ? (timelineCursor + tEff) / totalTimeline : i / totalFrames);
        }
        timelineCursor += dur;
      }

      if (audioSource && spedAudioBuffer) {
        console.log("[Export] adding audio buffer to muxer", spedAudioBuffer.duration.toFixed(2), "s");
        await audioSource.add(spedAudioBuffer);
        console.log("[Export] audio added");
      } else {
        console.log("[Export] skipping audio mux (silent)", { hasSource: !!audioSource, hasBuffer: !!spedAudioBuffer });
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
    // Use actual container for MIME so download extension matches (mp4->webm switch on Linux)
    return new Blob([buffer], { type: actualIsMp4 ? "video/mp4" : "video/webm" });
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
