import { describe, expect, it } from "vitest";
import {
  applyTrackEnvelope,
  clearTrackBuffers,
  computeDuckingEnvelope,
  getTrackBuffer,
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
