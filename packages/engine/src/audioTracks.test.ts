import { describe, expect, it } from "vitest";
import {
  applyTrackEnvelope,
  clearTrackBuffers,
  computeDuckingEnvelope,
  getTrackBuffer,
  mixTracksIntoBase,
  registerTrackBuffer,
  trackGainAt,
} from "./audioTracks";
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
