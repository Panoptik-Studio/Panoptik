/**
 * OWNER: DEV A — ROADMAP-A.md Task 2.3. UNIFIED with decode.ts:
 * the same mediabunny Input opened by loadClip also yields AudioBufferSink
 * (single-pass demux — no duplicate container parsing or inter-module races).
 * Signature: getAudioBuffer(project): Promise<AudioBuffer | null>
 * Concatenates buffer chunks at running offsets into one AudioBuffer.
 */
import type { Project } from "@panoptik/schema";
import { AudioBufferSink, type InputAudioTrack } from "mediabunny";

let audioSink: AudioBufferSink | null = null;
let audioTrackId: string | null = null;
// Fallback blob for decodeAudioData path when WebCodecs AudioDecoder cannot
// handle opus-in-mp4 (Linux Chrome: canDecode false, but <audio> can play).
let audioFallbackBlob: Blob | null = null;

export function setAudioBlobFallback(blob: Blob | null) {
  audioFallbackBlob = blob;
}

export function setAudioSink(track: InputAudioTrack | null) {
  if (!track) {
    audioSink = null;
    audioTrackId = null;
    console.log("[Audio] setAudioSink: null (no track)");
    return;
  }
  try {
    audioSink = new AudioBufferSink(track);
    audioTrackId = (track as unknown as { id?: string }).id ?? "audio";
    console.log("[Audio] setAudioSink: ok", { trackId: audioTrackId });
  } catch (e) {
    console.warn("[Audio] setAudioSink failed", e);
    audioSink = null;
    audioTrackId = null;
  }
}

/** Which track the audio is currently coming from. Exposed for tests. */
export function getAudioSinkTrackId(): string | null {
  return audioTrackId;
}

async function decodeViaAudioContext(blob: Blob): Promise<AudioBuffer | null> {
  try {
    const arrayBuf = await blob.arrayBuffer();
    // Prefer AudioContext.decodeAudioData (uses browser's media stack, same as <audio>)
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    try {
      const buf = await ctx.decodeAudioData(arrayBuf.slice(0));
      console.log("[Audio] decodeViaAudioContext: ok", { dur: buf.duration.toFixed(2), sr: buf.sampleRate, ch: buf.numberOfChannels });
      // Close context to free
      try { await ctx.close(); } catch { /* ignore */ }
      return buf;
    } catch (e) {
      console.warn("[Audio] decodeViaAudioContext failed", e);
      try { await ctx.close(); } catch { /* ignore */ }
      return null;
    }
  } catch (e) {
    console.warn("[Audio] decodeViaAudioContext: arrayBuffer failed", e);
    return null;
  }
}

export async function getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
  console.log("[Audio] getAudioBuffer: sink?", !!audioSink, "trackId", audioTrackId, "fallbackBlob", !!audioFallbackBlob, "project.audioSrc", !!project?.audioSrc);
  // Try WebCodecs path first (fast, single-pass demux)
  if (audioSink) {
    const chunks: AudioBuffer[] = [];
    try {
      for await (const wrapped of audioSink.buffers()) {
        chunks.push(wrapped.buffer);
      }
      console.log("[Audio] getAudioBuffer: decoded chunks via sink", chunks.length, chunks[0] ? { sr: chunks[0].sampleRate, ch: chunks[0].numberOfChannels, len: chunks[0].length } : null);
      if (chunks.length) {
        const sampleRate = chunks[0]!.sampleRate;
        const numberOfChannels = Math.max(...chunks.map((c) => c.numberOfChannels));
        let totalFrames = 0;
        for (const c of chunks) totalFrames += c.length;
        let dest: AudioBuffer | null = null;
        try {
          // @ts-ignore — AudioBuffer options constructor may not be in older lib.dom
          dest = new AudioBuffer({ length: totalFrames, numberOfChannels, sampleRate });
        } catch {
          dest = null;
        }
        if (!dest) {
          try {
            if (typeof OfflineAudioContext !== "undefined") {
              const ctx = new OfflineAudioContext(numberOfChannels, totalFrames, sampleRate);
              dest = ctx.createBuffer(numberOfChannels, totalFrames, sampleRate);
            }
          } catch {
            dest = null;
          }
        }
        if (!dest) {
          const channels: Float32Array[] = Array.from({ length: numberOfChannels }, () => new Float32Array(totalFrames));
          const mock = {
            length: totalFrames,
            sampleRate,
            numberOfChannels,
            duration: totalFrames / sampleRate,
            getChannelData: (ch: number) => channels[ch]!,
            copyToChannel: (src: Float32Array, ch: number, start = 0) => channels[ch]!.set(src, start),
            copyFromChannel: (dst: Float32Array, ch: number, start = 0) => dst.set(channels[ch]!.subarray(start, start + dst.length)),
          } as unknown as AudioBuffer;
          let offset = 0;
          for (const buf of chunks) {
            for (let ch = 0; ch < numberOfChannels; ch++) {
              const src = ch < buf.numberOfChannels ? buf.getChannelData(ch) : null;
              if (src) mock.getChannelData(ch).set(src, offset);
            }
            offset += buf.length;
          }
          return mock;
        }
        let offset = 0;
        for (const buf of chunks) {
          for (let ch = 0; ch < numberOfChannels; ch++) {
            if (ch < buf.numberOfChannels) {
              dest.getChannelData(ch).set(buf.getChannelData(ch), offset);
            }
          }
          offset += buf.length;
        }
        return dest;
      }
      console.warn("[Audio] getAudioBuffer: sink yielded 0 chunks -> trying fallback");
    } catch (e) {
      console.warn("[Audio] getAudioBuffer: sink buffers() failed -> trying fallback", e);
    }
  } else {
    console.warn("[Audio] getAudioBuffer: no sink -> trying fallback");
  }

  // Fallback: decode the blob via Web Audio (same decoder as <audio> preview)
  // This handles opus-in-mp4 on Linux where WebCodecs AudioDecoder canDecode==false
  // but MediaElement can still play.
  const fallbackBlob = audioFallbackBlob;
  if (fallbackBlob && fallbackBlob.size > 0) {
    console.log("[Audio] getAudioBuffer: trying fallback blob", `${fallbackBlob.type} ${fallbackBlob.size}`);
    const decoded = await decodeViaAudioContext(fallbackBlob);
    if (decoded) return decoded;
  }
  // Also try project.audioSrc blob URL if available (e.g., screen-only case where fallback not set)
  const src = (project as unknown as { audioSrc?: string | null })?.audioSrc ?? (project as unknown as { clip?: { src?: string } })?.clip?.src;
  if (src && src.startsWith("blob:")) {
    try {
      console.log("[Audio] getAudioBuffer: trying fetch from project src", src.slice(0, 32));
      const res = await fetch(src);
      const blob = await res.blob();
      console.log("[Audio] getAudioBuffer: fetched blob for fallback", `${blob.type} ${blob.size}`);
      if (blob.size > 0) {
        const decoded = await decodeViaAudioContext(blob);
        if (decoded) return decoded;
      }
    } catch (e) {
      console.warn("[Audio] getAudioBuffer: fetch fallback failed", e);
    }
  }

  console.warn("[Audio] getAudioBuffer: all paths failed -> silent");
  return null;
}
