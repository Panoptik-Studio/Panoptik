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

export function setAudioSink(track: InputAudioTrack | null) {
  if (!track) {
    audioSink = null;
    audioTrackId = null;
    return;
  }
  try {
    audioSink = new AudioBufferSink(track);
    audioTrackId = (track as unknown as { id?: string }).id ?? "audio";
  } catch {
    audioSink = null;
    audioTrackId = null;
  }
}

/** Which track the audio is currently coming from. Exposed for tests. */
export function getAudioSinkTrackId(): string | null {
  return audioTrackId;
}

export async function getAudioBuffer(_project: Project): Promise<AudioBuffer | null> {
  if (!audioSink) return null;

  const chunks: AudioBuffer[] = [];
  try {
    for await (const wrapped of audioSink.buffers()) {
      chunks.push(wrapped.buffer);
    }
  } catch {
    return null;
  }
  if (!chunks.length) return null;

  const sampleRate = chunks[0]!.sampleRate;
  const numberOfChannels = Math.max(...chunks.map((c) => c.numberOfChannels));
  let totalFrames = 0;
  for (const c of chunks) totalFrames += c.length;

  // Try native AudioBuffer constructor (modern browsers), fallback to OfflineAudioContext.
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
  // Last resort for test env (vitest node): mock buffer shape
  if (!dest) {
    // Minimal AudioBuffer-like shim for tests — callers use getChannelData
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

  // Copy channel data at running offsets
  let offset = 0;
  for (const buf of chunks) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      if (ch < buf.numberOfChannels) {
        dest.getChannelData(ch).set(buf.getChannelData(ch), offset);
      }
    }
    // Handle source having more channels than dest (unlikely) — ignore extras
    offset += buf.length;
  }

  return dest;
}
