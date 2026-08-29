import { describe, expect, it } from "vitest";
import {
  applyTrackEnvelope,
  clearTrackBuffers,
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
