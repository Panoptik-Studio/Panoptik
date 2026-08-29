/**
 * AudioTrack helpers (Phase 2): decoded-buffer registry, volume/fade envelopes,
 * dialogue ducking, and wall-clock timeline mixing. Pure TS — runs under node
 * for tests and in the browser for preview/export. Music/voiceover ignore
 * segment speed by design: they play on wall-clock timeline time.
 */
import type { AudioTrack } from "@panoptik/schema";
import { makeBuffer } from "./timeStretch";

// ── Decoded-buffer registry ──────────────────────────────────────────────────
// Populated by the UI on import/restore; read by export. Same module instance
// in both because both import @panoptik/engine.
const trackBuffers = new Map<string, AudioBuffer>();

export function registerTrackBuffer(id: string, buffer: AudioBuffer): void {
  trackBuffers.set(id, buffer);
}

export function getTrackBuffer(id: string): AudioBuffer | null {
  return trackBuffers.get(id) ?? null;
}

export function clearTrackBuffers(): void {
  trackBuffers.clear();
}

// ── Volume + fades ───────────────────────────────────────────────────────────
/** Linear gain at timeline second `t` for a track. */
export function trackGainAt(
  track: Pick<AudioTrack, "volume" | "duration" | "fadeIn" | "fadeOut">,
  t: number,
): number {
  const vol = Math.min(2, Math.max(0, track.volume));
  const fin = Math.max(0, track.fadeIn ?? 0);
  const fout = Math.max(0, track.fadeOut ?? 0);
  let g = vol;
  if (fin > 0 && t < fin) g *= Math.max(0, t / fin);
  const fadeStart = track.duration - fout;
  if (fout > 0 && t > fadeStart) g *= Math.max(0, (track.duration - t) / fout);
  return g;
}

/** Copy of `buffer` with the track's volume + fades baked in. */
export function applyTrackEnvelope(buffer: AudioBuffer, track: AudioTrack): AudioBuffer {
  const out = makeBuffer(
    buffer.numberOfChannels,
    buffer.length,
    buffer.sampleRate,
    Array.from({ length: buffer.numberOfChannels }, () => new Float32Array(buffer.length)),
  );
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < buffer.length; i++) {
      dst[i] = src[i] * trackGainAt(track, i / buffer.sampleRate);
    }
  }
  return out;
}
