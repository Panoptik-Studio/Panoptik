/**
 * OWNER: DEV A — ROADMAP-A.md Task 2.3. UNIFIED with decode.ts:
 * the same mediabunny Input opened by loadClip also yields AudioBufferSink
 * (single-pass demux — no duplicate container parsing or inter-module races).
 * Signature: getAudioBuffer(project): Promise<AudioBuffer | null>
 * Concatenates buffer chunks at running offsets into one mono AudioBuffer.
 */
import { InputAudioTrack, AudioBufferSink } from "mediabunny";

let audioSink: AudioBufferSink | null = null;

export function setAudioSink(track: InputAudioTrack | null) {
  audioSink = track ? new AudioBufferSink(track) : null;
}

export async function getAudioBuffer(_project: Project): Promise<AudioBuffer | null> {
  if (!audioSink) return null;

  const chunks: AudioBuffer[] = [];
  for await (const wrapped of audioSink.buffers()) {
    chunks.push(wrapped.buffer);
  }
  if (!chunks.length) return null;

  // Compute total length (mono — mix down to channel 0)
  let totalFrames = 0;
  for (const buf of chunks) totalFrames += buf.length;

  const ctx = new OfflineAudioContext(1, totalFrames, chunks[0]!.sampleRate);
  const dest = ctx.createBuffer(1, totalFrames, chunks[0]!.sampleRate);
  const data = dest.getChannelData(0);

  let offset = 0;
  for (const buf of chunks) {
    // Mix down to mono if stereo
    const ch0 = buf.getChannelData(0);
    for (let i = 0; i < buf.length; i++) {
      data[offset + i] = ch0[i]!;
    }
    offset += buf.length;
  }

  return dest;
}

import type { Project } from "@panoptik/schema";
