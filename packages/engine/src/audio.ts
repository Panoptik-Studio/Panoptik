/**
 * Unified audio extraction: the same mediabunny Input also yields AudioBufferSink
 * (single-pass demux).
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
    return;
  }
  try {
    audioSink = new AudioBufferSink(track);
    audioTrackId = (track as unknown as { id?: string }).id ?? "audio";
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

export async function decodeViaAudioContext(blob: Blob): Promise<AudioBuffer | null> {
  if (!blob || blob.size === 0) return null;
  try {
    const arrayBuf = await blob.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength === 0) return null;
    const AudioCtx =
      typeof window !== "undefined"
        ? window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        : null;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    try {
      const copy = arrayBuf.slice(0);
      const buf = await new Promise<AudioBuffer | null>((resolve) => {
        let settled = false;
        const done = (res: AudioBuffer | null) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        };
        try {
          const ret = ctx.decodeAudioData(
            copy,
            (decoded) => done(decoded),
            () => done(null),
          );
          if (ret && typeof ret.then === "function") {
            ret.then((decoded) => done(decoded)).catch(() => done(null));
          }
        } catch {
          done(null);
        }
      });
      return buf;
    } catch {
      return null;
    } finally {
      try {
        await ctx.close();
      } catch {
        /* ignore close errors */
      }
    }
  } catch {
    return null;
  }
}

export async function getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
  // Try WebCodecs path first (fast, single-pass demux)
  if (audioSink) {
    try {
      const chunks: AudioBuffer[] = [];
      for await (const wrapped of audioSink.buffers()) {
        chunks.push(wrapped.buffer);
      }
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
    } catch {
      /* sink buffers failed */
    }
  }

  // Fallback: decode the blob via Web Audio (same decoder as <audio> preview)
  const fallbackBlob = audioFallbackBlob;
  if (fallbackBlob && fallbackBlob.size > 0) {
    try {
      const decoded = await decodeViaAudioContext(fallbackBlob);
      if (decoded) return decoded;
    } catch {
      /* ignore */
    }
  }
  // Also try project.audioSrc blob URL if available
  const src = (project as unknown as { audioSrc?: string | null })?.audioSrc ?? (project as unknown as { clip?: { src?: string } })?.clip?.src;
  if (src && src.startsWith("blob:")) {
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      if (blob.size > 0) {
        const decoded = await decodeViaAudioContext(blob);
        if (decoded) return decoded;
      }
    } catch {
      /* ignore fetch error */
    }
  }

  return null;
}
