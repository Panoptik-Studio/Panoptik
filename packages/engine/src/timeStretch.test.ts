import { describe, expect, it } from "vitest";
import { makeBuffer, timeStretch } from "./timeStretch";

function mockAudioBuffer(sampleRate: number, channels: Float32Array[]) {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]!.length,
    duration: channels[0]!.length / sampleRate,
    getChannelData: (ch: number) => channels[ch]!,
  } as unknown as AudioBuffer;
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
