/**
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
import type { ExportFps, ExportOpts, Project } from "@panoptik/schema";
import { EXPORT_FPS_OPTIONS } from "@panoptik/schema";
import { mediaForSegment, primaryMedia } from "@panoptik/schema";
import { presetAspect } from "./layout";
import { prepareAllFrames, resetExportIterator, resetFacecamExportIterator, activateMedia, getFirstVideoTimestamp } from "./decode";
import { ensureBackgroundImages, renderFrame } from "./render";
import { applyVolume, concatAudio, mixAudio, sliceAndStretchAudio, sliceAndPadFacecamAudio, sliceAndPadScreenAudio } from "./timeStretch";
import { projectDuration, segmentDuration } from "./timeline";

// Register WASM AAC encoder fallback so all platforms/browsers (including Linux Chrome/Chromium)
// can encode genuine, universal AAC audio in MP4 files.
try {
  if (typeof globalThis !== "undefined") {
    const g = globalThis as unknown as { __panoptikAacRegistered?: boolean };
    if (!g.__panoptikAacRegistered) {
      g.__panoptikAacRegistered = true;
      registerAacEncoder();
    }
  }
} catch (e) {
  console.warn("[Export] could not register AAC encoder fallback", e);
}

/** Long-edge pixel height for each preset; width follows the media's aspect. */
const RESOLUTION_HEIGHTS: Record<ExportOpts["resolution"], number> = {
  "720p": 720,
  "1080p": 1080,
  "4k": 2160,
};

/**
 * Frame rate to write when the caller does not ask for one.
 *
 * Kept as the historic 30 so an export with no explicit choice produces the
 * same file it always has.
 */
const FALLBACK_EXPORT_FPS = 30;

/** Only the offered rates are honoured; anything else falls back. */
function resolveExportFps(requested: number | undefined): number {
  return requested && EXPORT_FPS_OPTIONS.includes(requested as ExportFps)
    ? requested
    : FALLBACK_EXPORT_FPS;
}

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
  const aspect = presetAspect(
    seg?.aspectPreset ?? "source",
    seg ? mediaForSegment(project, seg) : primaryMedia(project),
  );
  const height = RESOLUTION_HEIGHTS[resolution];
  const width = Math.round(height * aspect);
  return { width: width - (width % 2), height: height - (height % 2) };
}

export async function exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob> {
  const exportFps = resolveExportFps(opts.fps);
  console.log("[Export] frame rate", exportFps, "fps");
  // Signal preview to pause its own prepareFrame — they share the global CanvasSink pump.
  // Also drives decode.ts's sequential exportIterator path.
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
    const startTime = performance.now();
    const totalTimeline = projectDuration(project);
    console.log(`[Export] 🎬 Starting: ${width}x${height} @ ${exportFps}fps | ${totalTimeline.toFixed(2)}s | Format: ${requestedIsMp4 ? "MP4" : "WebM"} (${project.segments.length} segment${project.segments.length > 1 ? "s" : ""})`);

    // Shared AudioBuffer resolver for any blob src (screen, facecam, music,
    // voiceover) — hoisted so the audio-track mix below can reuse it.
    const { decodeViaAudioContext } = await import("./audio");
    const audioBufferCache = new Map<string, AudioBuffer | null>();
    const blobCache = new Map<string, Blob | null>();

    const getBlobForSrc = async (src: string | null | undefined): Promise<Blob | null> => {
      if (!src) return null;
      if (blobCache.has(src)) return blobCache.get(src) || null;
      if (src.startsWith("blob:")) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          blobCache.set(src, blob);
          return blob;
        } catch {
          blobCache.set(src, null);
          return null;
        }
      }
      return null;
    };

    const getBufferForSrc = async (src: string | null | undefined): Promise<AudioBuffer | null> => {
      if (!src) return null;
      if (audioBufferCache.has(src)) return audioBufferCache.get(src) || null;
      const blob = await getBlobForSrc(src);
      if (blob) {
        try {
          const decoded = await decodeViaAudioContext(blob);
          audioBufferCache.set(src, decoded);
          return decoded;
        } catch {
          audioBufferCache.set(src, null);
          return null;
        }
      }
      return null;
    };

    // 1. Resolve and compose master audio across all sources:
    // - Per-segment screen audio (if media contains audio, or standalone project.audioSrc)
    // - Per-segment facecam mic audio (with startT offset support)
    // - Music / Voiceover tracks (wall-clock timeline mixing)
    let spedAudioBuffer: AudioBuffer | null = null;
    try {
      const parts: AudioBuffer[] = [];
      let hasAnyAudio = false;

      for (const seg of project.segments) {
        const screenVol = seg.audioVolume ?? 1;
        const fcVol = seg.facecam?.audioVolume ?? 1;

        // 1. Process Screen Audio — per-segment media (multiclip).
        let screenPart: AudioBuffer | null = null;
        const segMedia = mediaForSegment(project, seg);
        const segScreenBuf = segMedia ? await getBufferForSrc(segMedia.src) : null;
        // If the segment has no facecam, standalone project.audioSrc acts as screen/narration audio
        const standaloneAudioSrc = !seg.facecam?.src ? project.audioSrc : null;
        const standaloneBuf = standaloneAudioSrc ? await getBufferForSrc(standaloneAudioSrc) : null;
        const screenBufForSeg = segScreenBuf ?? standaloneBuf;
        let firstTs = 0;
        if (screenBufForSeg) {
          const screenSrc = segMedia?.src || standaloneAudioSrc;
          const blob = await getBlobForSrc(screenSrc);
          firstTs = blob ? await getFirstVideoTimestamp(blob, screenSrc ?? undefined) : 0;
          screenPart = sliceAndPadScreenAudio(screenBufForSeg, seg, firstTs);
          hasAnyAudio = true;
        }

        // 2. Process Facecam / Mic Audio
        const fcSrc = seg.facecam?.src;
        let fcPart: AudioBuffer | null = null;
        let fcBufDur = "null";
        if (fcSrc) {
          const fcBuf = await getBufferForSrc(fcSrc);
          if (fcBuf) {
            fcBufDur = fcBuf.duration.toFixed(3);
            fcPart = sliceAndPadFacecamAudio(fcBuf, seg);
            hasAnyAudio = true;
          }
        }

        // 3. Dual-track mixing with volume scaling
        let mixedSegAudio: AudioBuffer | null = null;
        if (screenPart && fcPart) {
          mixedSegAudio = mixAudio(screenPart, screenVol, fcPart, fcVol);
        } else if (screenPart) {
          mixedSegAudio = applyVolume(screenPart, screenVol);
        } else if (fcPart) {
          mixedSegAudio = applyVolume(fcPart, fcVol);
        } else {
          // Neither source has audio for this segment — produce silence of correct timeline duration
          const dur = segmentDuration(seg);
          const sr = 48000;
          const len = Math.max(1, Math.round(dur * sr));
          const { makeBuffer } = await import("./timeStretch");
          mixedSegAudio = makeBuffer(2, len, sr, [new Float32Array(len), new Float32Array(len)]);
        }

        parts.push(mixedSegAudio);
        console.log(
          `[Export] audio seg speed=${seg.speed} srcSpan=${(seg.srcEnd - seg.srcStart).toFixed(3)} ` +
          `screen=${screenPart ? screenPart.duration.toFixed(3) : "null"} ` +
          `fc=${fcPart ? fcPart.duration.toFixed(3) : "null"} ` +
          `mixed=${mixedSegAudio.duration.toFixed(3)} expectTl=${segmentDuration(seg).toFixed(3)} ` +
          `screenBuf=${screenBufForSeg ? screenBufForSeg.duration.toFixed(3) : "null"} ` +
          `fcBuf=${fcBufDur} firstVideoTs=${firstTs.toFixed(3)}`,
        );
      }

      if (parts.length > 0 && hasAnyAudio) {
        spedAudioBuffer = concatAudio(parts);
        console.log(`[Export] 🎵 Audio assembled: ${spedAudioBuffer.numberOfChannels}ch, ${spedAudioBuffer.sampleRate}Hz, ${spedAudioBuffer.duration.toFixed(2)}s`);
      }
    } catch (e) {
      console.warn("[Export] audio assembly failed", e);
    }

    // Music/voiceover tracks
    const audioTracks = project.audioTracks ?? [];
    if (audioTracks.length > 0) {
      try {
        const at = await import("./audioTracks");
        const resolved: { track: (typeof audioTracks)[number]; buffer: AudioBuffer }[] = [];
        for (const track of audioTracks) {
          const buffer =
            at.getTrackBuffer(track.id) ??
            (track.src.startsWith("blob:") ? await getBufferForSrc(track.src) : null);
          if (buffer) resolved.push({ track, buffer });
        }
        if (resolved.length > 0) {
          if (spedAudioBuffer) {
            spedAudioBuffer = at.mixTracksIntoBase(spedAudioBuffer, resolved);
          } else {
            const totalDur = Math.max(
              projectDuration(project),
              ...resolved.map((r) => r.track.startT + r.buffer.duration),
            );
            const sr = resolved[0]!.buffer.sampleRate;
            const { makeBuffer } = await import("./timeStretch");
            const silence = makeBuffer(2, Math.max(1, Math.round(totalDur * sr)), sr, [
              new Float32Array(Math.round(totalDur * sr)),
              new Float32Array(Math.round(totalDur * sr)),
            ]);
            spedAudioBuffer = at.mixTracksIntoBase(silence, resolved);
          }
          console.log("[Export] mixed audio tracks into master", resolved.map((r) => `${r.track.kind}:"${r.track.name}"@${r.track.startT}s`));
        }
      } catch (e) {
        console.warn("[Export] audio track mix failed", e);
      }
    }

    const actualIsMp4 = requestedIsMp4;
    let audioCodec: AudioCodec | null = null;
    if (spedAudioBuffer) {
      if (requestedIsMp4) {
        const tryAacConfigs: Array<{ numberOfChannels: number; sampleRate: number }> = [
          { numberOfChannels: spedAudioBuffer.numberOfChannels, sampleRate: spedAudioBuffer.sampleRate },
          { numberOfChannels: 2, sampleRate: spedAudioBuffer.sampleRate },
          { numberOfChannels: spedAudioBuffer.numberOfChannels, sampleRate: 44100 },
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
            numberOfChannels: spedAudioBuffer.numberOfChannels,
            sampleRate: spedAudioBuffer.sampleRate,
          });
          if (audioCodec) {
            console.log("[Export] aac not encodable, encoding opus audio into MP4 container");
          }
        }
      } else {
        audioCodec = await getFirstEncodableAudioCodec(WEBM_AUDIO, {
          numberOfChannels: spedAudioBuffer.numberOfChannels,
          sampleRate: spedAudioBuffer.sampleRate,
        });
      }
      console.log("[Export] audioCodec for", requestedIsMp4 ? "mp4" : "webm", "requested ->", audioCodec, "channels:", spedAudioBuffer.numberOfChannels, "sampleRate:", spedAudioBuffer.sampleRate);
    } else {
      console.log("[Export] no audio tracks in project -> video-only export");
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
    output.addVideoTrack(videoSource, { frameRate: exportFps });
    let audioSource: AudioBufferSource | null = null;
    if (spedAudioBuffer && audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
    console.log(`[Export] ⚙️ Encoders ready: video=${videoCodec}, audio=${audioCodec ?? "none (silent)"}`);

    await output.start();

    const frameDuration = 1 / exportFps;
    const grandTotalFrames = Math.max(1, Math.ceil(totalTimeline * exportFps));
    let framesRendered = 0;
    let lastLoggedPct = -1;

    try {
      let timelineCursor = 0;
      let activeFacecamSrc: string | null = null;
      let activeMediaId: string | null = null;
      for (const seg of project.segments) {
        const segMedia = mediaForSegment(project, seg);
        if (segMedia?.id !== activeMediaId) {
          try {
            await activateMedia(segMedia?.id ?? "", segMedia?.src ?? null);
            activeMediaId = segMedia?.id ?? null;
          } catch (e) {
            console.warn("[Export] Failed to activate media for segment:", e);
          }
        }
        const segFcSrc = seg.facecam?.src ?? null;
        if (segFcSrc && segFcSrc !== activeFacecamSrc && segFcSrc.startsWith("blob:")) {
          try {
            const resp = await fetch(segFcSrc);
            const blob = await resp.blob();
            const { setFacecamBlob, resetFacecamExportIterator } = await import("./decode");
            await setFacecamBlob(blob, segFcSrc);
            await resetFacecamExportIterator();
            activeFacecamSrc = segFcSrc;
          } catch (e) {
            console.warn("[Export] Failed to switch facecam take for segment:", e);
          }
        }
        const dur = segmentDuration(seg);
        const totalFrames = Math.max(1, Math.ceil(dur * exportFps));
        if (seg.facecam?.src) {
          console.log(
            `[Export] facecam seg speed=${seg.speed} startT=${seg.facecam.startT ?? 0} ` +
            `srcStart=${seg.srcStart} fcT(first)=${((seg.facecam.startT ?? 0) > 0 ? Math.max(0, seg.srcStart - (seg.facecam.startT ?? 0)) : seg.srcStart).toFixed(3)} ` +
            `fcT(last)=${((seg.facecam.startT ?? 0) > 0 ? Math.max(0, seg.srcStart + dur * seg.speed - (seg.facecam.startT ?? 0)) : (seg.srcStart + dur * seg.speed)).toFixed(3)}`,
          );
        }
        for (let i = 0; i < totalFrames; i++) {
          const tEff = i / exportFps;
          const srcT = seg.srcStart + tEff * seg.speed;
          const fcStartT = seg.facecam?.startT ?? 0;
          // Must mirror drawFacecam (render.ts): the PiP frame is indexed by
          // main-clip SOURCE time minus startT. The previous timeline-based
          // formula advanced at 1x while preview advances at seg.speed, so the
          // exported facecam drifted whenever speed != 1.
          const fcT = fcStartT > 0 ? Math.max(0, srcT - fcStartT) : srcT;
          await prepareAllFrames(srcT, fcT);
          renderFrame(ctx as unknown as CanvasRenderingContext2D, project, timelineCursor + tEff);
          await videoSource.add(timelineCursor + tEff, frameDuration);
          framesRendered++;
          const pct = Math.floor((framesRendered / grandTotalFrames) * 100);
          if (pct >= lastLoggedPct + 25 || pct === 100) {
            lastLoggedPct = pct;
            console.log(`[Export] ⏳ Rendering frames: ${pct}% (${framesRendered}/${grandTotalFrames})`);
          }
          if (i % Math.round(exportFps) === 0) emitProgress(totalTimeline > 0 ? (timelineCursor + tEff) / totalTimeline : i / totalFrames);
        }
        timelineCursor += dur;
      }

      if (audioSource && spedAudioBuffer) {
        console.log(`[Export] 📦 Muxing ${spedAudioBuffer.duration.toFixed(2)}s audio into container...`);
        await audioSource.add(spedAudioBuffer);
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
    const elapsedSec = ((performance.now() - startTime) / 1000).toFixed(1);
    const sizeMb = (buffer.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`[Export] ✅ Export complete in ${elapsedSec}s | Output: ${actualIsMp4 ? "MP4" : "WebM"} (${sizeMb} MB)`);
    return new Blob([buffer], { type: actualIsMp4 ? "video/mp4" : "video/webm" });
  } finally {
    if (typeof window !== "undefined") (window as unknown as { __isExporting?: boolean }).__isExporting = false;
  }
}

/** Exposed for unit tests; not part of the engine's public surface. */
export const __test = { exportSize, resolveExportFps };

/** The clip's audio, or null when it has none we can decode. */
async function getExportAudio(project: Project): Promise<AudioBuffer | null> {
  try {
    const { getAudioBuffer } = await import("./audio");
    return await getAudioBuffer(project);
  } catch {
    return null;
  }
}
