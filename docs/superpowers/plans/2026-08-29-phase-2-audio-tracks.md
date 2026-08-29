# Phase 2: Audio Tracks (Music + Ducking, Voiceover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** B1 — project-level music tracks with volume/fades/dialogue-ducking — and C3 — post-hoc voiceover recording — running on wall-clock timeline time in both preview and export.

**Architecture:** New `AudioTrack[]` on `Project` (schema v1.3, additive). One new engine module `audioTracks.ts` holds the decoded-buffer registry + pure mixing math (envelope, ducking, timeline sum). Export mixes tracks after the existing per-segment speed-stretch pass in `encode.ts`. Preview schedules tracks via Web Audio (`AudioBufferSourceNode`) from the existing rAF loop. Voiceover capture reuses `MediaRecorder` patterns; persistence appends an `audio/` dir beside the existing OPFS layout.

**Tech Stack:** TypeScript, mediabunny (untouched), Web Audio API, MediaRecorder, OPFS, Zustand, Vitest.

## Global Constraints

- **Parallel-work rule:** a partner is implementing Phase 1 (multi-clip: `media[]`, `mediaId`, chapter names, decoder registry) on the same files. **Every schema/store/decode change in this plan is strictly additive** — never restructure lines the partner owns (media shape, decode pipeline internals, opfs dir layout, migrate's `media` handling). Conflicts are resolved by keeping additions in separate hunks/files.
- **Work on branch `feat/phase-2-audio-tracks`** off current `main`; created via `superpowers:using-git-worktrees` at execution time.
- Music and voiceover run on **wall-clock timeline time** — they ignore segment speed. No track speed manipulation, no crossfades, no EQ (spec cuts).
- Ducking is **export-only**; preview plays constant track volume (spec YAGNI decision).
- No server, no uploads, no API keys — everything client-side.
- Commands: `pnpm vitest run <path>` per task; `pnpm test && pnpm typecheck` green before final commit. Conventional commits.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/project-schema/src/index.ts` | Modify (additive) | `AudioTrack` type; `Project.audioTracks`; migration default |
| `packages/project-schema/src/migrate.test.ts` | Modify (additive) | audioTracks default tests |
| `packages/engine/src/audioTracks.ts` | **Create** | buffer registry + `trackGainAt`/`applyTrackEnvelope`/`computeDuckingEnvelope`/`mixTracksIntoBase` (pure) |
| `packages/engine/src/audioTracks.test.ts` | **Create** | TDD for the above |
| `packages/engine/src/index.ts` | Modify (additive) | export new helpers/types |
| `packages/engine/src/encode.ts` | Modify | mix tracks into `spedAudioBuffer` before muxing |
| `packages/engine/src/decode.ts` | Modify (1 line) | `audioTracks: []` in `loadClip` project literal |
| `packages/engine/src/real-engine.ts` | Modify (1 line) | `audioTracks: []` in `loadRecording` project literal |
| `packages/engine/src/test-fixtures.ts` | Modify (1 line) | `audioTracks: []` in `mockProject` |
| `packages/engine/src/opfs.ts` | Modify (append) | `saveAudioTrackFile`/`loadAudioTrackFiles`/`deleteAudioTrackFile` |
| `apps/web/src/stores/projectStore.ts` | Modify (additive) | `addAudioTrack`/`updateAudioTrack`/`removeAudioTrack` + tests |
| `apps/web/src/lib/trackPlayback.ts` | **Create** | Web Audio preview scheduler (`syncTrackPlayback`) |
| `apps/web/src/components/PreviewCanvas.tsx` | Modify (1 insertion) | call `syncTrackPlayback` in the rAF loop |
| `apps/web/src/components/AudioPanel.tsx` | **Create** | music import, track list UI, voiceover recorder mount |
| `apps/web/src/components/VoiceoverRecorder.tsx` | **Create** | mic capture → AudioTrack |
| `apps/web/src/lib/timelineAudioTracks.ts` | **Create** | canvas lane drawing + hit-test helpers (pure) |
| `apps/web/src/components/Timeline.tsx` | Modify (2 insertions) | draw audio lane; drag startT |
| `apps/web/src/app/editor/page.tsx` | Modify (additive) | "audio" tab → `<AudioPanel />` |
| `apps/web/src/lib/useProjectPersistence.ts` | Modify (additive) | save/restore track files + re-register buffers |

**Interfaces (locked across tasks):**
- Schema: `AudioTrack = { id: string; kind: "music" | "voiceover"; name?: string; src: string; duration: number; volume: number; startT: number; fadeIn?: number; fadeOut?: number; ducking?: number | null }`
- Engine: `registerTrackBuffer(id, buffer)`, `getTrackBuffer(id): AudioBuffer | null`, `clearTrackBuffers()`, `trackGainAt(track, t): number`, `applyTrackEnvelope(buffer, track): AudioBuffer`, `computeDuckingEnvelope(base, amount, windowMs?): Float32Array`, `mixTracksIntoBase(base, tracks: { track: AudioTrack; buffer: AudioBuffer }[]): AudioBuffer`
- OPFS: `saveAudioTrackFile(projectId, trackId, blob)`, `loadAudioTrackFiles(projectId): { id: string; blob: Blob }[]`, `deleteAudioTrackFile(projectId, trackId)`
- Store: `addAudioTrack(track)`, `updateAudioTrack(id, updates)`, `removeAudioTrack(id)`
- Preview: `syncTrackPlayback(timelineT, isPlaying, tracks, buffers)`, `trackBufferMap(tracks): Map<string, AudioBuffer>`

---

### Task 1: Schema — `AudioTrack` + migration default

**Files:**
- Modify: `packages/project-schema/src/index.ts`
- Test: `packages/project-schema/src/migrate.test.ts`

**Interfaces:** Produces `AudioTrack` type + `Project.audioTracks: AudioTrack[]` used by every later task. STRICTLY ADDITIVE — the partner adds `mediaId`/`name` in the same file; do not touch those lines.

- [ ] **Step 1: Write the failing tests** — append to `migrate.test.ts`:

```ts
describe("audioTracks (phase 2)", () => {
  it("fast-path v1.2 projects gain an empty audioTracks array", () => {
    const p = migrateProject({
      id: "p1",
      media: { src: "blob:x", duration: 10, width: 1280, height: 720 },
      segments: [{ id: "s1", srcStart: 0, srcEnd: 10, speed: 1, stagePadding: 0, aspectPreset: "source", background: { kind: "solid", color: "#000" }, facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 }, zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [], captions: [], stagedCaptions: [] }],
      clickLog: [],
    });
    expect(p.audioTracks).toEqual([]);
  });

  it("legacy clip projects gain audioTracks through the migration path", () => {
    const p = migrateProject({ id: "old", clip: { src: "blob:y", duration: 5, width: 640, height: 360 } });
    expect(p.audioTracks).toEqual([]);
  });

  it("existing audioTracks survive migration", () => {
    const track = { id: "t1", kind: "music", src: "blob:z", duration: 30, volume: 1, startT: 2, ducking: 0.5 };
    const p = migrateProject({
      id: "p2",
      media: { src: "blob:x", duration: 10, width: 1280, height: 720 },
      segments: [],
      audioTracks: [track],
      clickLog: [],
    });
    expect(p.audioTracks).toEqual([track]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run packages/project-schema` → FAIL (`audioTracks` missing/undefined).
- [ ] **Step 3: Implement** — in `packages/project-schema/src/index.ts`:
  1. Below the `Facecam` type, add:

```ts
/**
 * An audio asset laid on the timeline at wall-clock speed (music, voiceover).
 * Ignores segment speed on purpose — background music must not be stretched.
 */
export type AudioTrack = {
  id: string;
  kind: "music" | "voiceover";
  name?: string;
  /** Object URL for this session; re-minted from OPFS on load (same rule as background images). */
  src: string;
  duration: number;
  /** 0–2 (1 = unchanged). */
  volume: number;
  /** Timeline seconds where the track begins. */
  startT: number;
  /** Fade-in/out in seconds. */
  fadeIn?: number;
  fadeOut?: number;
  /** 0–1: how much to duck under dialogue. null/undefined = off. Music only. */
  ducking?: number | null;
};
```

  2. In `type Project`, add after `clickLog: ClickEvent[];`: `audioTracks: AudioTrack[];`
  3. In `migrateProject`, change the fast path (currently `return raw as Project; // already v1.2`) to:

```ts
  if (Array.isArray(r.segments) && r.media && typeof r.media === "object") {
    const p = raw as Project; // already v1.2+
    if (!Array.isArray(p.audioTracks)) p.audioTracks = [];
    return p;
  }
```

  4. In the legacy return object, add `audioTracks: [],` (after `clickLog`).

- [ ] **Step 4: Verify** — `pnpm vitest run packages/project-schema` → PASS.
- [ ] **Step 5: Commit** — `feat(schema): AudioTrack type + migration default`

### Task 2: Engine — registry + volume/fade envelope (TDD)

**Files:**
- Create: `packages/engine/src/audioTracks.ts`
- Test: `packages/engine/src/audioTracks.test.ts`

**Interfaces:** Consumes `makeBuffer` from `./timeStretch`, `AudioTrack` from schema. Produces the registry + `trackGainAt`/`applyTrackEnvelope` signatures from the plan header.

- [ ] **Step 1: Write failing tests** — create `audioTracks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTrackEnvelope, clearTrackBuffers, getTrackBuffer, registerTrackBuffer, trackGainAt } from "./audioTracks";
import { makeBuffer } from "./timeStretch";
import type { AudioTrack } from "@panoptik/schema";

const sr = 1000;
function constBuffer(seconds: number, value = 1): AudioBuffer {
  return makeBuffer(1, seconds * sr, sr, [new Float32Array(seconds * sr).fill(value)]);
}
function track(partial: Partial<AudioTrack>): AudioTrack {
  return { id: "t", kind: "music", src: "blob:x", duration: 2, volume: 1, startT: 0, ...partial };
}

describe("trackGainAt", () => {
  it("is volume when no fades", () => {
    expect(trackGainAt(track({ volume: 0.5 }), 1)).toBeCloseTo(0.5);
  });
  it("ramps 0→volume over fadeIn", () => {
    const t = track({ volume: 1, fadeIn: 1 });
    expect(trackGainAt(t, 0)).toBeCloseTo(0);
    expect(trackGainAt(t, 0.5)).toBeCloseTo(0.5);
    expect(trackGainAt(t, 1)).toBeCloseTo(1);
  });
  it("ramps volume→0 over fadeOut at the end", () => {
    const t = track({ duration: 2, volume: 1, fadeOut: 1 });
    expect(trackGainAt(t, 1)).toBeCloseTo(1);
    expect(trackGainAt(t, 1.5)).toBeCloseTo(0.5);
    expect(trackGainAt(t, 2)).toBeCloseTo(0);
  });
});

describe("applyTrackEnvelope", () => {
  it("scales by constant volume", () => {
    const out = applyTrackEnvelope(constBuffer(1, 1), track({ volume: 0.25 }));
    expect(out.getChannelData(0)[500]).toBeCloseTo(0.25);
  });
  it("fades in from zero", () => {
    const out = applyTrackEnvelope(constBuffer(2, 1), track({ fadeIn: 2 }));
    expect(out.getChannelData(0)[0]).toBeCloseTo(0);
    expect(out.getChannelData(0)[sr]).toBeCloseTo(0.5);
    expect(out.getChannelData(0)[2 * sr - 1]).toBeCloseTo(1, 2);
  });
});

describe("buffer registry", () => {
  it("stores and clears by id", () => {
    const b = constBuffer(0.1);
    registerTrackBuffer("a", b);
    expect(getTrackBuffer("a")).toBe(b);
    clearTrackBuffers();
    expect(getTrackBuffer("a")).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run packages/engine/src/audioTracks.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** — create `packages/engine/src/audioTracks.ts`:

```ts
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
```

- [ ] **Step 4: Verify** — `pnpm vitest run packages/engine/src/audioTracks.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(engine): audio track registry + volume/fade envelope`

### Task 3: Engine — ducking envelope (TDD)

**Files:** Modify `packages/engine/src/audioTracks.ts` + test file.

- [ ] **Step 1: Failing tests** — append to `audioTracks.test.ts`:

```ts
import { computeDuckingEnvelope } from "./audioTracks"; // add to existing import

describe("computeDuckingEnvelope", () => {
  it("amount 0 returns all ones", () => {
    const g = computeDuckingEnvelope(constBuffer(1), 0);
    expect(g[0]).toBe(1);
    expect(g[g.length - 1]).toBe(1);
  });
  it("silence keeps gain at 1", () => {
    const g = computeDuckingEnvelope(constBuffer(1, 0), 0.8);
    expect(g[Math.floor(g.length / 2)]).toBe(1);
  });
  it("loud uniform audio ducks to ~1-amount", () => {
    const g = computeDuckingEnvelope(constBuffer(1, 0.5), 0.8);
    const mid = g[Math.floor(g.length / 2)];
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.3); // 1 - 0.8 = 0.2 with smoothing
  });
  it("silence→speech transition ramps, not jumps", () => {
    const buf = makeBuffer(1, 2 * sr, sr, [new Float32Array(2 * sr)]);
    for (let i = sr; i < 2 * sr; i++) buf.getChannelData(0)[i] = 0.5;
    const g = computeDuckingEnvelope(buf, 1);
    expect(g[0]).toBe(1);                      // silence
    expect(g[2 * sr - 1]).toBeLessThan(0.2);   // speech
    const atBoundary = g[sr];
    expect(atBoundary).toBeGreaterThan(0.2);   // smoothed edge
    expect(atBoundary).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — append to `audioTracks.ts`:

```ts
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
```

- [ ] **Step 4: Verify** — `pnpm vitest run packages/engine/src/audioTracks.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(engine): dialogue ducking envelope`

### Task 4: Engine — timeline mixing (TDD)

**Files:** Modify `packages/engine/src/audioTracks.ts` + test file.

- [ ] **Step 1: Failing tests** — append:

```ts
import { mixTracksIntoBase } from "./audioTracks"; // add to existing import

describe("mixTracksIntoBase", () => {
  it("places a track at startT with volume applied", () => {
    const base = constBuffer(1, 0);
    const music = constBuffer(0.5, 0.5);
    const out = mixTracksIntoBase(base, [{ track: track({ startT: 0.25, volume: 1, duration: 0.5 }), buffer: music }]);
    expect(out.getChannelData(0)[Math.floor(0.2 * sr)]).toBe(0);
    expect(out.getChannelData(0)[Math.floor(0.3 * sr)]).toBeCloseTo(0.5);
    expect(out.getChannelData(0)[Math.floor(0.8 * sr)]).toBe(0); // track ended at 0.75
  });
  it("extends output when the track runs past the base", () => {
    const base = constBuffer(1, 0);
    const out = mixTracksIntoBase(base, [{ track: track({ startT: 0.5, duration: 1 }), buffer: constBuffer(1, 0.2) }]);
    expect(out.duration).toBeCloseTo(1.5, 5);
  });
  it("sums on top of the base without clipping the base away", () => {
    const base = constBuffer(1, 0.2);
    const out = mixTracksIntoBase(base, [{ track: track({ startT: 0, duration: 1, volume: 1 }), buffer: constBuffer(1, 0.3) }]);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.5);
  });
  it("applies ducking to music where the base is loud", () => {
    const speech = makeBuffer(1, 1 * sr, sr, [new Float32Array(1 * sr).fill(0.5)]);
    const out = mixTracksIntoBase(speech, [
      { track: track({ startT: 0, duration: 1, volume: 1, ducking: 1 }), buffer: constBuffer(1, 0.4) },
    ]);
    // base 0.5 + music 0.4*(1-ducking~1) ≈ 0.5 + small
    expect(out.getChannelData(0)[Math.floor(0.5 * sr)]).toBeLessThan(0.62);
  });
  it("resamples a differently-rated track into place", () => {
    const base = constBuffer(1, 0); // sr 1000
    const hi = makeBuffer(1, 1 * 2000, 2000, [new Float32Array(2000).fill(0.5)]);
    const out = mixTracksIntoBase(base, [{ track: track({ startT: 0, duration: 1 }), buffer: hi }]);
    expect(out.getChannelData(0)[Math.floor(0.5 * sr)]).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Verify failure.**
- [ ] **Step 3: Implement** — append to `audioTracks.ts`:

```ts
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
```

- [ ] **Step 4: Verify** — `pnpm vitest run packages/engine/src/audioTracks.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(engine): wall-clock audio track mixing with ducking`

### Task 5: Engine wiring — exports + project literals

**Files:**
- Modify: `packages/engine/src/index.ts`, `packages/engine/src/decode.ts` (loadClip return, ~line 458), `packages/engine/src/real-engine.ts` (loadRecording), `packages/engine/src/test-fixtures.ts`

**Interfaces:** Every later task imports these from `@panoptik/engine`.

- [ ] **Step 1: Add exports** to `packages/engine/src/index.ts` (after the opfs export block):

```ts
export {
  registerTrackBuffer,
  getTrackBuffer,
  clearTrackBuffers,
  trackGainAt,
  applyTrackEnvelope,
  computeDuckingEnvelope,
  mixTracksIntoBase,
} from "./audioTracks";
```

Also extend the opfs export list (same file) with `saveAudioTrackFile, loadAudioTrackFiles, deleteAudioTrackFile` (they exist after Task 7 — add them now and Task 7 makes it compile, OR add in Task 7; pick: add here in Task 7's step instead. Skip in this task.)

Also add `AudioTrack` to the type re-export line: `export type { Project, ExportOpts, ExportFrameOpts, AudioTrack };` (import AudioTrack from `@panoptik/schema`).

- [ ] **Step 2: Add `audioTracks: []` to every `Project` literal** — in `decode.ts` `loadClip` return (after `audioSrc: null,`), `real-engine.ts` `loadRecording` return, `test-fixtures.ts` `mockProject()` return (after `clickLog: []`). Then run `pnpm typecheck` and fix any remaining literal the compiler surfaces the same way (one line each; do NOT restructure partner-owned code).
- [ ] **Step 3: Verify** — `pnpm vitest run packages/engine && pnpm typecheck` → PASS.
- [ ] **Step 4: Commit** — `feat(engine): wire audioTracks into project constructors + exports`

### Task 6: Store actions (TDD)

**Files:**
- Modify: `apps/web/src/stores/projectStore.ts` (interface + actions; ADDITIVE — partner adds `reorderSegments` in the same file)
- Test: `apps/web/src/stores/projectStore.test.ts` (append)

- [ ] **Step 1: Failing tests** — append to `projectStore.test.ts`:

```ts
import type { AudioTrack } from "@panoptik/schema";

const audioTrack = (id: string, partial: Partial<AudioTrack> = {}): AudioTrack => ({
  id,
  kind: "music",
  src: "blob:x",
  duration: 30,
  volume: 1,
  startT: 0,
  ...partial,
});

describe("audio track actions", () => {
  beforeEach(fresh);

  it("addAudioTrack appends and pushes history", () => {
    const before = useProjectStore.getState().historyIndex;
    useProjectStore.getState().addAudioTrack(audioTrack("m1", { startT: 2 }));
    const s = useProjectStore.getState();
    expect(s.project!.audioTracks.map((t) => t.id)).toEqual(["m1"]);
    expect(s.historyIndex).toBe(before + 1);
  });

  it("updateAudioTrack patches one track and pushes history", () => {
    useProjectStore.getState().addAudioTrack(audioTrack("m1"));
    useProjectStore.getState().addAudioTrack(audioTrack("m2"));
    useProjectStore.getState().updateAudioTrack("m2", { volume: 0.5, startT: 3 });
    const s = useProjectStore.getState();
    expect(s.project!.audioTracks.find((t) => t.id === "m2")?.volume).toBe(0.5);
    expect(s.project!.audioTracks.find((t) => t.id === "m1")?.volume).toBe(1);
  });

  it("removeAudioTrack deletes and undo restores", () => {
    useProjectStore.getState().addAudioTrack(audioTrack("m1"));
    useProjectStore.getState().removeAudioTrack("m1");
    expect(useProjectStore.getState().project!.audioTracks).toEqual([]);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.audioTracks.map((t) => t.id)).toEqual(["m1"]);
  });

  it("actions are no-ops without a project", () => {
    useProjectStore.getState().clearProject();
    expect(() => useProjectStore.getState().addAudioTrack(audioTrack("x"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Verify failure** — `pnpm vitest run apps/web/src/stores/projectStore.test.ts` → FAIL.
- [ ] **Step 3: Implement** — in `projectStore.ts`:
  1. Add `type AudioTrack` to the `@panoptik/schema` import list.
  2. In `interface ProjectStore`, add to the actions section:

```ts
  addAudioTrack: (track: AudioTrack) => void;
  updateAudioTrack: (id: string, updates: Partial<AudioTrack>) => void;
  removeAudioTrack: (id: string) => void;
```

  3. In the `create<ProjectStore>` body (place near the background actions), add:

```ts
  addAudioTrack: (track) => {
    const s = get();
    if (!s.project) return;
    const project = { ...s.project, audioTracks: [...(s.project.audioTracks ?? []), track] };
    pushHistoryAndSet(project, s, set);
  },

  updateAudioTrack: (id, updates) => {
    const s = get();
    if (!s.project) return;
    const project = {
      ...s.project,
      audioTracks: (s.project.audioTracks ?? []).map((t) => (t.id === id ? { ...t, ...updates } : t)),
    };
    pushHistoryAndSet(project, s, set);
  },

  removeAudioTrack: (id) => {
    const s = get();
    if (!s.project) return;
    const project = { ...s.project, audioTracks: (s.project.audioTracks ?? []).filter((t) => t.id !== id) };
    pushHistoryAndSet(project, s, set);
  },
```

- [ ] **Step 4: Verify** — `pnpm vitest run apps/web/src/stores/projectStore.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(store): audio track actions with history`

### Task 7: OPFS — audio file persistence

**Files:**
- Modify: `packages/engine/src/opfs.ts` (append at end), `packages/engine/src/index.ts` (extend opfs export list)

- [ ] **Step 1: Implement** — append to `opfs.ts`:

```ts
// ── Audio track files (Phase 2) ─────────────────────────────────────────────
// Laid beside clip/facecam under <projectId>/audio/<trackId>.<ext>. Extensions
// come from the blob type; loadAudioTrackFiles strips them back to track ids.

function audioExt(type: string): string {
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  return "webm";
}

export async function saveAudioTrackFile(projectId: string, trackId: string, blob: Blob): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle(projectId, { create: true });
  const audioDir = await dir.getDirectoryHandle("audio", { create: true });
  const fh = await audioDir.getFileHandle(`${trackId}.${audioExt(blob.type)}`, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

export async function loadAudioTrackFiles(projectId: string): Promise<{ id: string; blob: Blob }[]> {
  const out: { id: string; blob: Blob }[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(projectId);
    const audioDir = await dir.getDirectoryHandle("audio");
    for await (const [name, handle] of audioDir.entries()) {
      if (handle.kind !== "file") continue;
      const file = await handle.getFile();
      out.push({ id: name.replace(/\.[^.]+$/, ""), blob: file });
    }
  } catch {
    /* no audio dir for this project */
  }
  return out;
}

export async function deleteAudioTrackFile(projectId: string, trackId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(projectId);
    const audioDir = await dir.getDirectoryHandle("audio");
    for await (const [name, handle] of audioDir.entries()) {
      if (handle.kind === "file" && name.startsWith(trackId)) {
        await audioDir.removeEntry(name);
      }
    }
  } catch {
    /* nothing stored for it */
  }
}
```

- [ ] **Step 2: Export** — add `saveAudioTrackFile, loadAudioTrackFiles, deleteAudioTrackFile` to the `./opfs` export list in `packages/engine/src/index.ts`.
- [ ] **Step 3: Verify** — `pnpm vitest run packages/engine && pnpm typecheck` → PASS (thin wrappers over OPFS; browser roundtrip is verified in Task 13's manual checklist).
- [ ] **Step 4: Commit** — `feat(engine): OPFS persistence for audio tracks`

### Task 8: Export mixing

**Files:** Modify: `packages/engine/src/encode.ts`

**Interfaces:** Consumes `getTrackBuffer`, `mixTracksIntoBase` from `./audioTracks` and the in-scope `getBufferForSrc` helper.

- [ ] **Step 1: Hoist the buffer-cache helpers.** Inside `exportProject`, the block starting `const audioBufferCache = new Map...` (with `decodeViaAudioContext` import and `getBufferForSrc`) currently lives inside `if (audioBuffer) { ... }`. Move those three declarations UP so they sit directly above the `const audioBuffer = await getExportAudio(project);` line. No logic changes — they are independent of `audioBuffer`.
- [ ] **Step 2: Add the track-mixing pass.** Directly after the per-segment time-stretch `try { ... } catch` block closes (right before `await output.start();`), insert:

```ts
    // Music/voiceover ride on wall-clock timeline time — no speed stretching.
    // Buffers come from the preview registry, or are decoded from the track's
    // blob URL on the spot (fresh page → straight-to-export).
    const audioTracks = project.audioTracks ?? [];
    if (audioTracks.length > 0) {
      try {
        const at = await import("./audioTracks");
        const resolved: { track: typeof audioTracks[number]; buffer: AudioBuffer }[] = [];
        for (const track of audioTracks) {
          const buffer =
            at.getTrackBuffer(track.id) ??
            (track.src.startsWith("blob:") ? await getBufferForSrc(track.src) : null);
          if (buffer) resolved.push({ track, buffer });
        }
        if (resolved.length > 0 && spedAudioBuffer) {
          spedAudioBuffer = at.mixTracksIntoBase(spedAudioBuffer, resolved);
          console.log("[Export] mixed audio tracks", resolved.map((r) => `${r.track.kind}:"${r.track.name}"@${r.track.startT}s`));
        } else {
          console.warn("[Export] audioTracks present but none resolvable -> skipped");
        }
      } catch (e) {
        console.warn("[Export] audio track mix failed, exporting base audio only", e);
      }
    }
```

- [ ] **Step 3: Verify** — `pnpm vitest run packages/engine && pnpm typecheck` → PASS. (End-to-end export check is in Task 13's manual checklist.)
- [ ] **Step 4: Commit** — `feat(export): mix music + voiceover tracks into the export`

### Task 9: Preview playback scheduler

**Files:**
- Create: `apps/web/src/lib/trackPlayback.ts`

**Interfaces:** Consumes `getTrackBuffer` from `@panoptik/engine`. Produces `syncTrackPlayback(timelineT, isPlaying, tracks, buffers)` and `trackBufferMap(tracks)` consumed by Task 10.

- [ ] **Step 1: Implement:**

```ts
/**
 * Preview playback for AudioTracks via Web Audio. Music/voiceover run on
 * wall-clock timeline time, so sources schedule against AudioContext time and
 * re-sync when the playhead jumps more than 0.15s. Fades automate on a
 * GainNode. Ducking is export-only (preview keeps constant volume).
 */
import type { AudioTrack } from "@panoptik/schema";
import { getTrackBuffer } from "@panoptik/engine";

let ctx: AudioContext | null = null;
let baseCtxTime = 0;   // ctx.currentTime when the clock was pinned
let baseTimelineT = 0; // timeline time at that moment
const nodes = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

function context(): AudioContext {
  ctx ??= new AudioContext();
  return ctx;
}

function currentGain(track: AudioTrack, timelineT: number): number {
  const vol = Math.min(2, Math.max(0, track.volume));
  const fin = track.fadeIn ?? 0;
  const fout = track.fadeOut ?? 0;
  let g = vol;
  if (fin > 0 && timelineT < fin) g *= Math.max(0, timelineT / fin);
  const fadeStart = track.duration - fout;
  if (fout > 0 && timelineT > fadeStart) g *= Math.max(0, (track.duration - timelineT) / fout);
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

function scheduleGain(param: AudioParam, track: AudioTrack, timelineT: number, now: number): void {
  const fin = track.fadeIn ?? 0;
  const fout = track.fadeOut ?? 0;
  const vol = Math.min(2, Math.max(0, track.volume));
  param.cancelScheduledValues(now);
  param.setValueAtTime(currentGain(track, timelineT), now);
  if (fin > 0 && timelineT < fin) {
    param.linearRampToValueAtTime(vol, now + (fin - timelineT));
  }
  const fadeStart = track.duration - fout;
  if (fout > 0 && timelineT < fadeStart) {
    param.setValueAtTime(currentGain(track, fadeStart), now + (fadeStart - timelineT));
    param.linearRampToValueAtTime(0, now + (track.duration - timelineT));
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
    scheduleGain(gain.gain, track, timelineT, c.currentTime);
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
        if (node) node.gain.gain.value = currentGain(track, timelineT);
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
```

- [ ] **Step 2: Verify** — `pnpm typecheck` → PASS (browser-only code; covered by Task 13's manual checklist).
- [ ] **Step 3: Commit** — `feat(editor): web audio scheduler for track preview`

### Task 10: PreviewCanvas integration

**Files:** Modify: `apps/web/src/components/PreviewCanvas.tsx`

- [ ] **Step 1: Import** at the top with the other lib imports: `import { syncTrackPlayback, trackBufferMap } from "@/lib/trackPlayback";`
- [ ] **Step 2: Insert in the rAF loop.** Inside the `if (state.isPlaying) { ... }` block in the loop function, immediately after the facecam-audio block closes (the `}` right before the comment `// Don't contend with export's pump`), add:

```ts
        // Music/voiceover — wall-clock timeline time via Web Audio.
        syncTrackPlayback(
          tEff,
          state.isPlaying,
          state.project.audioTracks ?? [],
          trackBufferMap(state.project.audioTracks ?? []),
        );
```

- [ ] **Step 3: Verify** — `pnpm typecheck` → PASS; manual check in Task 13.
- [ ] **Step 4: Commit** — `feat(editor): play music + voiceover in the preview`

### Task 11: AudioPanel + VoiceoverRecorder + editor tab

**Files:**
- Create: `apps/web/src/components/AudioPanel.tsx`, `apps/web/src/components/VoiceoverRecorder.tsx`
- Modify: `apps/web/src/app/editor/page.tsx`

- [ ] **Step 1: Create `VoiceoverRecorder.tsx`:**

```tsx
/**
 * Records a narration take over the timeline and lands it as a voiceover
 * AudioTrack at the playhead. Recording runs until Stop is pressed — it does
 * not follow playback pause, keeps the UI honest and simple.
 */
"use client";

import { useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

export function VoiceoverRecorder() {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const startedWallRef = useRef(0);
  const countRef = useRef(0);

  const start = async () => {
    const state = useProjectStore.getState();
    if (!state.project) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      alert("Microphone permission is required to record a voiceover.");
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    chunksRef.current = [];
    startedAtRef.current = state.currentTime;
    startedWallRef.current = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const startT = startedAtRef.current;
      const fallbackDur = (Date.now() - startedWallRef.current) / 1000;
      const { decodeViaAudioContext, registerTrackBuffer, saveAudioTrackFile } = await import("@panoptik/engine");
      let duration = fallbackDur;
      try {
        const buf = await decodeViaAudioContext(blob);
        if (buf) {
          duration = buf.duration;
          registerTrackBuffer(track.id, buf);
        }
      } catch { /* keep fallback duration */ }
      const projectId = useProjectStore.getState().project?.id;
      const track = {
        id: crypto.randomUUID(),
        kind: "voiceover" as const,
        name: `Voiceover ${++countRef.current}`,
        src: URL.createObjectURL(blob),
        duration,
        volume: 1,
        startT,
      };
      useProjectStore.getState().addAudioTrack(track);
      if (projectId) {
        try { await saveAudioTrackFile(projectId, track.id, blob); } catch { /* best effort */ }
      }
    };
    recorderRef.current = rec;
    rec.start();
    setRecording(true);
    // Roll the timeline from the playhead so the take lines up with the video.
    const s = useProjectStore.getState();
    if (!s.isPlaying) s.togglePlay();
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <button
      className={`pk-btn pk-btn-md w-full ${recording ? "pk-btn-danger" : "pk-btn-ghost"}`}
      onClick={recording ? stop : start}
    >
      {recording ? "■ Stop recording" : "● Record voiceover"}
    </button>
  );
}
```

- [ ] **Step 2: Create `AudioPanel.tsx`:**

```tsx
/**
 * Audio panel (Phase 2): import music, adjust volume/fades/ducking, and
 * record voiceover takes. Tracks are pure UI state + OPFS files — no new
 * engine surface beyond the helpers in @panoptik/engine.
 */
"use client";

import { useRef } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { VoiceoverRecorder } from "@/components/VoiceoverRecorder";
import type { AudioTrack } from "@panoptik/schema";

export function AudioPanel() {
  const project = useProjectStore((s) => s.project);
  const tracks = project?.audioTracks ?? [];
  const addAudioTrack = useProjectStore((s) => s.addAudioTrack);
  const updateAudioTrack = useProjectStore((s) => s.updateAudioTrack);
  const removeAudioTrack = useProjectStore((s) => s.removeAudioTrack);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = async (file: File | undefined) => {
    if (!file || !project) return;
    const { decodeViaAudioContext, registerTrackBuffer, saveAudioTrackFile } = await import("@panoptik/engine");
    let duration = 0;
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await decodeViaAudioContext(file);
      duration = buffer?.duration ?? 0;
    } catch {
      alert("Could not decode this audio file in your browser.");
      return;
    }
    if (!buffer) return;
    const track: AudioTrack = {
      id: crypto.randomUUID(),
      kind: "music",
      name: file.name,
      src: URL.createObjectURL(file),
      duration,
      volume: 1,
      startT: useProjectStore.getState().currentTime,
      ducking: 0.6,
    };
    registerTrackBuffer(track.id, buffer);
    addAudioTrack(track);
    try { await saveAudioTrackFile(project.id, track.id, file); } catch { /* best effort */ }
  };

  const onDelete = async (track: AudioTrack) => {
    removeAudioTrack(track.id);
    if (project) {
      const { deleteAudioTrackFile } = await import("@panoptik/engine");
      try { await deleteAudioTrackFile(project.id, track.id); } catch { /* best effort */ }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="pk-ui text-[15px] font-semibold text-pk-ink">Audio</h3>
        <p className="pk-help mt-1">Music and voiceover play on timeline time — they are not affected by segment speed.</p>
      </div>

      <VoiceoverRecorder />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          onPickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button className="pk-btn pk-btn-ghost pk-btn-md w-full" onClick={() => fileRef.current?.click()}>
        + Add music
      </button>

      {tracks.length === 0 && (
        <p className="pk-help">No audio tracks yet. Add music or record a voiceover above.</p>
      )}

      {tracks.map((track) => (
        <div key={track.id} className="rounded-[var(--radius-pk-btn)] border border-pk-hairline p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="pk-ui truncate text-[13px] font-medium text-pk-ink" title={track.name}>
              {track.kind === "voiceover" ? "🎙 " : "♪ "}{track.name ?? track.kind}
            </p>
            <button className="pk-icon-btn" aria-label="Delete track" onClick={() => onDelete(track)}>
              ✕
            </button>
          </div>
          <label className="pk-help mt-2 block">
            Volume ({track.volume.toFixed(2)}×)
            <input
              type="range" min={0} max={2} step={0.05} value={track.volume}
              onChange={(e) => updateAudioTrack(track.id, { volume: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <label className="pk-help flex-1">
              Fade in (s)
              <input
                type="number" min={0} max={30} step={0.5} value={track.fadeIn ?? 0}
                onChange={(e) => updateAudioTrack(track.id, { fadeIn: Math.max(0, Number(e.target.value)) })}
                className="mt-1 w-full rounded border border-pk-hairline px-2 py-1 text-[12px]"
              />
            </label>
            <label className="pk-help flex-1">
              Fade out (s)
              <input
                type="number" min={0} max={30} step={0.5} value={track.fadeOut ?? 0}
                onChange={(e) => updateAudioTrack(track.id, { fadeOut: Math.max(0, Number(e.target.value)) })}
                className="mt-1 w-full rounded border border-pk-hairline px-2 py-1 text-[12px]"
              />
            </label>
          </div>
          {track.kind === "music" && (
            <label className="pk-help mt-2 block">
              <span className="flex items-center justify-between">
                Duck under dialogue
                <input
                  type="checkbox"
                  checked={!!track.ducking}
                  onChange={(e) => updateAudioTrack(track.id, { ducking: e.target.checked ? 0.6 : null })}
                />
              </span>
              {!!track.ducking && (
                <input
                  type="range" min={0} max={1} step={0.05} value={track.ducking}
                  onChange={(e) => updateAudioTrack(track.id, { ducking: Number(e.target.value) })}
                  className="mt-1 w-full"
                />
              )}
            </label>
          )}
          <p className="pk-help mt-2">Starts at {track.startT.toFixed(1)}s — drag the block in the timeline to move it.</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add the "audio" tab** to `apps/web/src/app/editor/page.tsx` (additive):
  1. Import: `import { AudioPanel } from "@/components/AudioPanel";`
  2. Extend the type: `type LeftTab = "media" | "zoom" | "text" | "captions" | "audio" | "camera" | "stage";`
  3. Add the button after Captions:

```tsx
          <ToolBtn icon="audio" label="Audio" active={activeTab === "audio"} onClick={() => setActiveTab("audio")} />
```

  4. Add the icons entry inside the `icons` record in `ToolBtn`:

```tsx
    audio: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    ),
```

  5. Add the panel route after the captions line: `{activeTab === "audio" && <AudioPanel />}`

- [ ] **Step 4: Verify** — `pnpm typecheck` → PASS; `pnpm test` still green.
- [ ] **Step 5: Commit** — `feat(editor): audio panel with music import + voiceover recorder`

### Task 12: Timeline lane

**Files:**
- Create: `apps/web/src/lib/timelineAudioTracks.ts` (pure helpers, testable)
- Modify: `apps/web/src/components/Timeline.tsx` (2 small insertions — partner edits other tracks here; keep the diff tiny)

- [ ] **Step 1: Create the helpers:**

```ts
/**
 * Canvas drawing + hit-testing for the AudioTrack lane (Track 6) in the
 * timeline. Pure functions so they can be unit-tested without the component.
 */
import type { AudioTrack } from "@panoptik/schema";

export const AUDIO_LANE_HEIGHT = 26;

export function audioLaneY(laneTopY: number): number {
  return laneTopY;
}

/** Draw every track as a rounded block from startT to startT+duration. */
export function drawAudioTracks(
  ctx: CanvasRenderingContext2D,
  tracks: AudioTrack[],
  timeToX: (t: number) => number,
  y: number,
  height = AUDIO_LANE_HEIGHT,
): void {
  for (const track of tracks) {
    const x0 = timeToX(track.startT);
    const x1 = timeToX(track.startT + track.duration);
    if (x1 < 0) continue;
    ctx.save();
    roundRectPath(ctx, x0, y, Math.max(2, x1 - x0), height, 6);
    ctx.fillStyle = track.kind === "music" ? "rgba(0,112,243,0.16)" : "rgba(16,185,129,0.16)";
    ctx.fill();
    ctx.strokeStyle = track.kind === "music" ? "#0070f3" : "#10b981";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = track.kind === "music" ? "#0070f3" : "#0f9d76";
    ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(x0 + 4, y, Math.max(0, x1 - x0 - 8), height);
    ctx.clip();
    ctx.fillText(`${track.kind === "music" ? "♪" : "🎙"} ${track.name ?? track.kind}`, x0 + 7, y + height / 2);
    ctx.restore();
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Which track (if any) sits under a click at timeline time `t`. */
export function hitTestAudioTrack(tracks: AudioTrack[], t: number): AudioTrack | null {
  return tracks.find((track) => t >= track.startT && t <= track.startT + track.duration) ?? null;
}
```

- [ ] **Step 2: Unit tests** — `apps/web/src/lib/timelineAudioTracks.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { hitTestAudioTrack } from "./timelineAudioTracks";
import type { AudioTrack } from "@panoptik/schema";

const track = (startT: number, duration: number): AudioTrack => ({
  id: "t", kind: "music", src: "blob:x", duration, volume: 1, startT,
});

describe("hitTestAudioTrack", () => {
  it("hits inside the block only", () => {
    const t = track(2, 3);
    expect(hitTestAudioTrack([t], 2)).toBe(t);
    expect(hitTestAudioTrack([t], 5)).toBe(t);
    expect(hitTestAudioTrack([t], 5.01)).toBeNull();
    expect(hitTestAudioTrack([t], 1.99)).toBeNull();
  });
});
```

(`drawAudioTracks` is exercised via `pnpm typecheck` + manual check — canvas APIs are DOM-bound.)

- [ ] **Step 3: Integrate into `Timeline.tsx`:**
  1. Import: `import { drawAudioTracks, hitTestAudioTrack, AUDIO_LANE_HEIGHT } from "@/lib/timelineAudioTracks";`
  2. In the canvas render function, after the LAST existing track is drawn (the final numbered track block; anchor on the closing of the section that draws the caption/waveform track — search for the last `ctx.restore()` before the playhead drawing), insert:

```ts
    // ── 6. Audio tracks (music/voiceover, wall-clock) ──
    drawAudioTracks(ctx, project.audioTracks ?? [], timeToX, audioLaneTop);
```

     where `audioLaneTop` is `laneTop + (previous lane height + gap)` — reuse whatever Y the last track's block starts at plus `AUDIO_LANE_HEIGHT + 8`. Follow the local variable names in the render scope (the file computes per-track Y bands; place the lane directly below the last one and, if the canvas height is computed from a constant, add `AUDIO_LANE_HEIGHT + 8` to it).
  3. In the pointerdown handler (before the playhead branch), add an audio-block hit-test: convert the click X to timeline time with the same helper the other tracks use, then:

```ts
    const at = hitTestAudioTrack(project.audioTracks ?? [], tAtX);
    if (at) {
      dragAudioRef.current = { id: at.id, grabOffset: tAtX - at.startT };
      // fall through to the canvas-drag path below; pointermove updates startT
    }
```

     Add `const dragAudioRef = useRef<{ id: string; grabOffset: number } | null>(null);` alongside the existing drag refs. In the pointermove drag path (where diamonds/segments update), add:

```ts
    if (dragAudioRef.current) {
      useProjectStore.getState().updateAudioTrack(dragAudioRef.current.id, {
        startT: Math.max(0, tAtX - dragAudioRef.current.grabOffset),
      });
      return;
    }
```

     and clear `dragAudioRef.current = null` in pointerup alongside the other drags. Reuse the file's existing `timeToX`/time-from-X helpers — do not invent new coordinate math.
- [ ] **Step 4: Verify** — `pnpm vitest run apps/web/src/lib/timelineAudioTracks.test.ts && pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(timeline): audio track lane with draggable start time`

### Task 13: Persistence wiring

**Files:** Modify: `apps/web/src/lib/useProjectPersistence.ts` (additive)

- [ ] **Step 1: Save audio files on autosave.** Add module scope next to `mediaSavedFor`:

```ts
/** Track ids already written to OPFS for a project — avoids re-fetch+rewrite each debounce. */
const audioSavedFor = new Map<string, Set<string>>();
```

  In the autosave timer (after `await saveProject(...)` succeeds), insert:

```ts
          const { saveAudioTrackFile } = await import("@panoptik/engine");
          const saved = audioSavedFor.get(project.id) ?? new Set<string>();
          for (const track of project.audioTracks ?? []) {
            if (saved.has(track.id) || !track.src.startsWith("blob:")) continue;
            try {
              const blob = await (await fetch(track.src)).blob();
              await saveAudioTrackFile(project.id, track.id, blob);
              saved.add(track.id);
            } catch {
              /* skip this track this round */
            }
          }
          audioSavedFor.set(project.id, saved);
```

  In `forgetMediaSaved()`, add `audioSavedFor.clear();`.

- [ ] **Step 2: Restore on project open.** Add a helper above `useProjectPersistence`:

```ts
/**
 * Audio track srcs are object URLs that die with the session — re-mint them
 * from OPFS and re-register the decoded buffers the preview/export need.
 */
async function restoreAudioTracks(project: Project): Promise<void> {
  const tracks = project.audioTracks ?? [];
  if (tracks.length === 0) return;
  const { loadAudioTrackFiles, decodeViaAudioContext, registerTrackBuffer } = await import("@panoptik/engine");
  const files = await loadAudioTrackFiles(project.id);
  for (const track of tracks) {
    const file = files.find((f) => f.id === track.id);
    if (!file) continue;
    try {
      const buffer = await decodeViaAudioContext(file.blob);
      if (buffer) registerTrackBuffer(track.id, buffer);
      track.src = URL.createObjectURL(file.blob);
    } catch {
      /* leave the dead src; the track shows but stays silent */
    }
  }
}
```

  Call `await restoreAudioTracks(restored);` immediately after each `markMediaSaved(restored.id);` (both the mount-restore effect and `openProject`), before `setProject` runs.

- [ ] **Step 3: Verify** — `pnpm vitest run apps/web/src/lib/useProjectPersistence.test.ts && pnpm typecheck` → PASS.
- [ ] **Step 4: Commit** — `feat(persistence): save + restore audio track files`

### Task 14: Full verification

- [ ] **Step 1:** `pnpm test` → all suites green (208 existing + new).
- [ ] **Step 2:** `pnpm typecheck` → green.
- [ ] **Step 3: Manual checklist** (`pnpm dev` → http://localhost:3000/editor):
  - Import an MP3 → block appears on the timeline lane at the playhead; audio plays during preview and stops on pause.
  - Drag the music block → `startT` moves; playback follows.
  - Set fade in/out → audible ramps in preview; export matches.
  - Enable ducking → export the MP4; music dips under spoken sections (verify in VLC).
  - Record voiceover → take appears as a track; plays in preview; survives reload (OPFS restore).
  - Delete a track → gone from lane, panel, and undo restores it.
  - Segment speed change → music/voiceover timing unchanged (wall-clock rule).
- [ ] **Step 4:** Fix anything found; commit fixes (`fix: ...`).

## Self-Review

- **Spec coverage:** music import ✓ (Task 11), volume/fades/ducking ✓ (Tasks 2–4, 8, 11), preview ✓ (Tasks 9–10), export ✓ (Task 8), voiceover ✓ (Task 11), OPFS roundtrip ✓ (Tasks 7, 13), timeline lane ✓ (Task 12), wall-clock rule ✓ (mix + scheduler + docs).
- **Placeholders:** none — all code provided; Timeline integration anchors on named landmarks because the file is 1800 lines (insertion code is given verbatim).
- **Type consistency:** `AudioTrack` shape identical across Tasks 1/6/11; `mixTracksIntoBase`/`ResolvedTrack` match Task 8's usage; `syncTrackPlayback`/`trackBufferMap` match Task 10's call.
