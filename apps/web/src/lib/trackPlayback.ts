/**
 * Preview playback for AudioTracks via Web Audio. Music/voiceover run on
 * wall-clock timeline time, so sources schedule against AudioContext time and
 * re-sync when the playhead jumps more than 0.15s. Fades automate on a GainNode.
 * Ducking is export-only (preview keeps constant volume — YAGNI).
 */
import type { AudioTrack } from "@panoptik/schema";
import { getTrackBuffer } from "@panoptik/engine";

let ctx: AudioContext | null = null;
let baseCtxTime = 0; // ctx.currentTime when the clock was pinned
let baseTimelineT = 0; // timeline time at that moment
const nodes = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

function context(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

/** Gain at `localT` seconds *within* the track (not project time). */
function currentGain(track: AudioTrack, localT: number): number {
  const vol = Math.min(2, Math.max(0, track.volume));
  const fin = track.fadeIn ?? 0;
  const fout = track.fadeOut ?? 0;
  let g = vol;
  if (fin > 0 && localT < fin) g *= Math.max(0, localT / fin);
  const fadeStart = track.duration - fout;
  if (fout > 0 && localT > fadeStart) g *= Math.max(0, (track.duration - localT) / fout);
  return g;
}

function stopAllSources(): void {
  for (const { src } of nodes.values()) {
    try { src.stop(); } catch { /* already stopped */ }
  }
  nodes.clear();
}

export function stopTrackPlayback(): void {
  stopAllSources();
  ctx?.suspend().catch(() => {});
}

function scheduleGain(param: AudioParam, track: AudioTrack, localT: number, now: number): void {
  const fin = track.fadeIn ?? 0;
  const fout = track.fadeOut ?? 0;
  const vol = Math.min(2, Math.max(0, track.volume));
  param.cancelScheduledValues(now);
  param.setValueAtTime(currentGain(track, localT), now);
  if (fin > 0 && localT < fin) {
    param.linearRampToValueAtTime(vol, now + (fin - localT));
  }
  const fadeStart = track.duration - fout;
  if (fout > 0 && localT < fadeStart) {
    param.setValueAtTime(currentGain(track, fadeStart), now + (fadeStart - localT));
    param.linearRampToValueAtTime(0, now + (track.duration - localT));
  }
}

function restart(timelineT: number, tracks: AudioTrack[], buffers: Map<string, AudioBuffer>): void {
  stopAllSources();
  const c = context();
  c.resume().catch(() => {});
  baseCtxTime = c.currentTime;
  baseTimelineT = timelineT;
  for (const track of tracks) {
    const buffer = buffers.get(track.id);
    if (!buffer) continue;
    const intoTrack = timelineT - track.startT;
    if (intoTrack >= track.duration) continue;
    const offset = Math.max(0, intoTrack);
    const when = c.currentTime + Math.max(0, -intoTrack); // future start if the playhead is before the track
    const src = c.createBufferSource();
    src.buffer = buffer;
    const gain = c.createGain();
    scheduleGain(gain.gain, track, Math.max(0, intoTrack), c.currentTime);
    src.connect(gain).connect(c.destination);
    src.start(when, offset);
    nodes.set(track.id, { src, gain });
  }
}

/**
 * Called every animation frame from the preview loop. Cheap on the steady
 * path: a drift check + in-place gain updates, no source restarts.
 */
export function syncTrackPlayback(
  timelineT: number,
  isPlaying: boolean,
  tracks: AudioTrack[],
  buffers: Map<string, AudioBuffer>,
): void {
  if (!isPlaying || tracks.length === 0) {
    if (nodes.size > 0) stopTrackPlayback();
    return;
  }
  if (nodes.size > 0 && ctx) {
    const scheduled = baseTimelineT + (ctx.currentTime - baseCtxTime);
    if (Math.abs(scheduled - timelineT) < 0.15) {
      for (const track of tracks) {
        const node = nodes.get(track.id);
        if (node) node.gain.gain.value = currentGain(track, timelineT - track.startT);
      }
      for (const id of [...nodes.keys()]) {
        if (!tracks.some((t) => t.id === id)) {
          try { nodes.get(id)?.src.stop(); } catch { /* fine */ }
          nodes.delete(id);
        }
      }
      return;
    }
  }
  restart(timelineT, tracks, buffers);
}

/** Snapshot of the engine registry keyed by track id. */
export function trackBufferMap(tracks: AudioTrack[]): Map<string, AudioBuffer> {
  const m = new Map<string, AudioBuffer>();
  for (const t of tracks) {
    const b = getTrackBuffer(t.id);
    if (b) m.set(t.id, b);
  }
  return m;
}
