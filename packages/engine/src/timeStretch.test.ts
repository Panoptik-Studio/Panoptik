import { describe, expect, it } from "vitest";
import { applyVolume, concatAudio, makeBuffer, makeMock, mixAudio, sliceAndStretchAudio, timeStretch } from "./timeStretch";
import type { Segment } from "@panoptik/schema";

function mockAudioBuffer(sampleRate: number, channels: Float32Array[]) {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    duration: channels[0]!.length / sampleRate,
    getChannelData: (ch: number) => channels[ch]! } as unknown as AudioBuffer;
}

describe("timeStretch (pitch-preserving WSOLA)", () => {
  // A fixed 440Hz sine; pitch is measured as zero-crossing rate, which a
  // pure speed change (vari-speed) would scale but a time-stretch must not.
  function sine(freqHz: number, sampleRate: number, seconds: number): Float32Array {
    const n = Math.round(sampleRate * seconds);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
    return out;
  }

  function pitchHz(x: Float32Array, sampleRate: number): number {
    // zero crossings per second / 2 = frequency
    let crossings = 0;
    for (let i = 1; i < x.length; i++) {
      if ((x[i - 1]! < 0) !== (x[i]! < 0)) crossings++;
    }
    return (crossings / 2) * (sampleRate / x.length);
  }

  it("keeps the output length ~ input length / rate (speed change)", () => {
    const sr = 44100;
    const src = mockAudioBuffer(sr, [sine(440, sr, 2)]);
    const speedUp = timeStretch(src, 2);
    expect(speedUp.length).toBeGreaterThanOrEqual(Math.floor(src.length / 2) * 0.95);
    expect(speedUp.length).toBeLessThanOrEqual(Math.ceil(src.length / 2) * 1.2);
    const slowDown = timeStretch(src, 0.5);
    expect(slowDown.length).toBeGreaterThanOrEqual(Math.floor(src.length * 2) * 0.85);
    expect(slowDown.length).toBeLessThanOrEqual(Math.ceil(src.length * 2) * 1.15);
  });

  it("preserves pitch when sped up (rate 2) — vs vari-speed which doubles it", () => {
    const sr = 44100;
    const src = mockAudioBuffer(sr, [sine(440, sr, 4)]);
    const out = timeStretch(src, 2);
    const measured = pitchHz(out.getChannelData(0), sr);
    // Vari-speed (the old bug) would measure ~880Hz; WSOLA must stay ~440.
    expect(measured).toBeGreaterThan(380);
    expect(measured).toBeLessThan(500);
  });

  it("preserves pitch when slowed down (rate 0.5)", () => {
    const sr = 44100;
    const src = mockAudioBuffer(sr, [sine(440, sr, 4)]);
    const out = timeStretch(src, 0.5);
    const measured = pitchHz(out.getChannelData(0), sr);
    // Vari-speed would measure ~220Hz; WSOLA must stay ~440.
    expect(measured).toBeGreaterThan(380);
    expect(measured).toBeLessThan(500);
  });

  it("outputs as many channels as the input, at the same sample rate", () => {
    const sr = 44100;
    const mono = sine(440, sr, 1);
    const src = mockAudioBuffer(sr, [mono, mono]);
    const out = timeStretch(src, 1.5);
    expect(out.numberOfChannels).toBe(2);
    expect(out.sampleRate).toBe(sr);
  });

  it("returns a valid AudioBuffer via makeBuffer", () => {
    const b = makeBuffer(1, 1000, 44100, [new Float32Array(1000)]);
    expect(b.length).toBe(1000);
    expect(b.numberOfChannels).toBe(1);
    expect(b.getChannelData(0).length).toBe(1000);
  });
});

describe("segment-windowed audio (sliceAndStretchAudio / concatAudio)", () => {
  const seg = (srcStart: number, srcEnd: number, speed: number): Segment => ({
    id: "s", mediaId: "m1", srcStart, srcEnd, speed, stagePadding: 0,
    aspectPreset: "source", background: { kind: "solid", color: "#000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [] });

  it("slices exactly [srcStart, srcEnd) in seconds", () => {
    const src = makeMock(48000, 48000); // 1s
    const out = sliceAndStretchAudio(src, seg(0.25, 0.75, 1));
    expect(out.duration).toBeCloseTo(0.5, 3);
    expect(out.getChannelData(0).length).toBe(Math.round(0.5 * 48000));
  });

  it("clamps an out-of-range window to silence rather than exploding", () => {
    const src = makeMock(4800, 48000);
    const out = sliceAndStretchAudio(src, seg(99, 100, 1));
    expect(Number.isFinite(out.duration)).toBe(true);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("stretches each slice by its own speed and concatenates in order", () => {
    // Two segments: 0→1s at 2x (0.5s out) then 1→2s at 1x (1.0s out).
    const src = makeMock(96000, 48000); // 2s
    const parts = [sliceAndStretchAudio(src, seg(0, 1, 2)), sliceAndStretchAudio(src, seg(1, 2, 1))];
    const out = concatAudio(parts);
    expect(out.duration).toBeCloseTo(0.5 + 1.0, 2);
    expect(out.sampleRate).toBe(48000);
    expect(out.numberOfChannels).toBe(1);
  });

  it("concatAudio returns a single part untouched", () => {
    const p = makeMock(100, 48000);
    expect(concatAudio([p])).toBe(p);
  });
});

describe("applyVolume & mixAudio", () => {
  it("scales channel samples by volume multiplier", () => {
    const data = new Float32Array([0.2, 0.4, -0.6]);
    const buf = mockAudioBuffer(48000, [data]);
    const out = applyVolume(buf, 0.5);
    expect(out.getChannelData(0)[0]).toBeCloseTo(0.1);
    expect(out.getChannelData(0)[1]).toBeCloseTo(0.2);
    expect(out.getChannelData(0)[2]).toBeCloseTo(-0.3);
  });

  it("mutes channel samples when volume is 0", () => {
    const data = new Float32Array([0.5, -0.5]);
    const buf = mockAudioBuffer(48000, [data]);
    const out = applyVolume(buf, 0);
    expect(out.getChannelData(0)[0]).toBe(0);
    expect(out.getChannelData(0)[1]).toBe(0);
  });

  it("mixes two audio streams with respective volume multipliers", () => {
    const dataA = new Float32Array([0.2, 0.4]);
    const dataB = new Float32Array([0.1, 0.2]);
    const bufA = mockAudioBuffer(48000, [dataA]);
    const bufB = mockAudioBuffer(48000, [dataB]);
    const mixed = mixAudio(bufA, 1.0, bufB, 0.5);
    expect(mixed.getChannelData(0)[0]).toBeCloseTo(0.25);
    expect(mixed.getChannelData(0)[1]).toBeCloseTo(0.5);
  });
});
