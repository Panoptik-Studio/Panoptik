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

// ── Dialogue ducking ─────────────────────────────────────────────────────────
/** Per-window RMS of a channel-averaged mixdown. */
function windowRms(base: AudioBuffer, windowMs: number): { rms: Float32Array; winLen: number } {
  const winLen = Math.max(1, Math.round((windowMs / 1000) * base.sampleRate));
  const nWindows = Math.max(1, Math.ceil(base.length / winLen));
  const rms = new Float32Array(nWindows);
  const mono = new Float32Array(base.length);
  for (let ch = 0; ch < base.numberOfChannels; ch++) {
    const d = base.getChannelData(ch);
    for (let i = 0; i < base.length; i++) mono[i] += d[i] / base.numberOfChannels;
  }
  for (let w = 0; w < nWindows; w++) {
    const start = w * winLen;
    const end = Math.min(base.length, start + winLen);
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    rms[w] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return { rms, winLen };
}

/**
 * Per-sample gain (0..1) ducking `base` where speech is present.
 * Deterministic: presence = clamp((rms - noiseFloor) / (speechRef - noiseFloor))
 * with noiseFloor = peak*0.1, speechRef = peak*0.5, smoothed by a 3-window box.
 * amount 0 → all ones; amount 1 → near-silence under loud dialogue.
 */
export function computeDuckingEnvelope(base: AudioBuffer, amount: number, windowMs = 50): Float32Array {
  const n = base.length;
  const gain = new Float32Array(n);
  gain.fill(1);
  if (amount <= 0 || n === 0) return gain;
  const { rms, winLen } = windowRms(base, windowMs);
  let peak = 0;
  for (let i = 0; i < rms.length; i++) if (rms[i] > peak) peak = rms[i];
  if (peak === 0) return gain;
  const noiseFloor = peak * 0.1;
  const speechRef = peak * 0.5;
  const presence = new Float32Array(rms.length);
  for (let i = 0; i < rms.length; i++) {
    presence[i] = Math.min(1, Math.max(0, (rms[i] - noiseFloor) / (speechRef - noiseFloor)));
  }
  const smooth = new Float32Array(rms.length);
  for (let i = 0; i < rms.length; i++) {
    const a = presence[Math.max(0, i - 1)] ?? 0;
    const c = presence[Math.min(rms.length - 1, i + 1)] ?? 0;
    smooth[i] = (a + presence[i] + c) / 3;
  }
  for (let w = 0; w < rms.length; w++) {
    const g = 1 - amount * smooth[w];
    const start = w * winLen;
    const end = Math.min(n, start + winLen);
    for (let i = start; i < end; i++) gain[i] = g;
  }
  return gain;
}

// ── Timeline mixing ──────────────────────────────────────────────────────────
export type ResolvedTrack = { track: AudioTrack; buffer: AudioBuffer };

/** Linear-resample `src` into `out`'s rate/channels and ADD it at `offsetSamples`. */
function addResampled(
  out: AudioBuffer,
  src: AudioBuffer,
  offsetSamples: number,
  gainPerSample: ((i: number) => number) | null,
): void {
  const ratio = src.sampleRate / out.sampleRate;
  const srcLen = src.length;
  for (let ch = 0; ch < out.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch);
    const srcCh = src.getChannelData(Math.min(ch, src.numberOfChannels - 1));
    for (let i = 0; ; i++) {
      const idx = offsetSamples + i;
      if (idx >= dst.length) break;
      const s = i * ratio;
      const i0 = Math.floor(s);
      if (i0 >= srcLen) break;
      const i1 = Math.min(srcLen - 1, i0 + 1);
      const sample = srcCh[i0] + (srcCh[i1] - srcCh[i0]) * (s - i0);
      dst[idx] += sample * (gainPerSample ? gainPerSample(idx) : 1);
    }
  }
}

/**
 * Sum tracks onto the timeline buffer at wall-clock positions. Output is at
 * `base` rate/channels, extended when a track runs past the end. Music tracks
 * with `ducking` get the dialogue envelope of `base` applied to their
 * contribution; voiceover (being dialogue itself) never ducks.
 */
export function mixTracksIntoBase(base: AudioBuffer, tracks: ResolvedTrack[]): AudioBuffer {
  const sr = base.sampleRate;
  let endSample = base.length;
  for (const { track, buffer } of tracks) {
    endSample = Math.max(endSample, Math.round((track.startT + buffer.duration) * sr));
  }
  const out = makeBuffer(
    base.numberOfChannels,
    endSample,
    sr,
    Array.from({ length: base.numberOfChannels }, () => new Float32Array(endSample)),
  );
  for (let ch = 0; ch < base.numberOfChannels; ch++) {
    out.getChannelData(ch).set(base.getChannelData(ch));
  }
  for (const { track, buffer } of tracks) {
    const enveloped = applyTrackEnvelope(buffer, track);
    const offset = Math.max(0, Math.round(track.startT * sr));
    const duck =
      track.kind === "music" && track.ducking
        ? computeDuckingEnvelope(base, track.ducking)
        : null;
    addResampled(out, enveloped, offset, duck ? (i) => duck[i] ?? 1 : null);
  }
  return out;
}
