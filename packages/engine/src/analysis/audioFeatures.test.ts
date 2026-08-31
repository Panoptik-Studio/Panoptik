import { describe, expect, it } from "vitest";
import { computeRmsEnergy, extractAudioFeatures } from "./audioFeatures";

describe("audioFeatures", () => {
  it("computes sliding RMS energy over mono PCM buffer", () => {
    const sampleRate = 16000;
    // 1 second of 440Hz sine wave (amplitude 0.5)
    const samples = new Float32Array(sampleRate);
    for (let i = 0; i < sampleRate; i++) {
      samples[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    }

    const { times, rms } = computeRmsEnergy(samples, sampleRate, 20, 10);
    expect(times.length).toBeGreaterThan(90);
    // Sine wave of amplitude 0.5 has RMS ~ 0.5 / sqrt(2) ≈ 0.353
    expect(rms[10]).toBeCloseTo(0.353, 1);
  });

  it("detects dead-air silence intervals (>= 450ms) and minor pauses (150-450ms)", () => {
    const sampleRate = 16000;
    const totalDuration = 4.0; // 4 seconds
    const samples = new Float32Array(sampleRate * totalDuration);

    // 0.0s - 1.0s: Speech (amplitude 0.4)
    for (let i = 0; i < sampleRate * 1.0; i++) {
      samples[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sampleRate);
    }
    // 1.0s - 1.8s: Silence (0.8s >= 450ms -> dead air candidate)
    // (zeros already in array)

    // 1.8s - 2.8s: Speech (amplitude 0.4)
    for (let i = Math.floor(sampleRate * 1.8); i < sampleRate * 2.8; i++) {
      samples[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sampleRate);
    }

    // 2.8s - 3.1s: Minor pause (0.3s -> minor pause candidate)
    // (zeros)

    // 3.1s - 4.0s: Speech (amplitude 0.4)
    for (let i = Math.floor(sampleRate * 3.1); i < sampleRate * 4.0; i++) {
      samples[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / sampleRate);
    }

    const result = extractAudioFeatures(samples, sampleRate);
    expect(result.duration).toBe(4.0);

    // Check dead-air silence
    expect(result.silences.length).toBeGreaterThanOrEqual(1);
    const deadAir = result.silences.find((s) => s.start >= 0.9 && s.end <= 1.9);
    expect(deadAir).toBeDefined();
    expect(deadAir!.duration).toBeGreaterThanOrEqual(0.7);

    // Check minor pause
    expect(result.minorPauses.length).toBeGreaterThanOrEqual(1);
    const pause = result.minorPauses.find((p) => p.start >= 2.7 && p.end <= 3.2);
    expect(pause).toBeDefined();
  });

  it("detects loudness emphasis peaks and generates ±200ms keepout zones", () => {
    const sampleRate = 16000;
    const totalDuration = 6.0;
    const samples = new Float32Array(sampleRate * totalDuration);

    // Baseline calm speech at 0.05 amplitude
    for (let i = 0; i < samples.length; i++) {
      samples[i] = 0.05 * Math.sin((2 * Math.PI * 250 * i) / sampleRate);
    }

    // Loud laugh / vocal exclamation spike at t = 3.0s (amplitude 0.9, duration 0.1s)
    const spikeStart = Math.floor(sampleRate * 2.95);
    const spikeEnd = Math.floor(sampleRate * 3.05);
    for (let i = spikeStart; i < spikeEnd; i++) {
      samples[i] = 0.9 * Math.sin((2 * Math.PI * 400 * i) / sampleRate);
    }

    const result = extractAudioFeatures(samples, sampleRate);
    expect(result.loudPeaks.length).toBeGreaterThanOrEqual(1);

    const peak = result.loudPeaks[0]!;
    expect(peak.t).toBeGreaterThanOrEqual(2.8);
    expect(peak.t).toBeLessThanOrEqual(3.2);
    expect(peak.keepoutStart).toBeCloseTo(peak.t - 0.2, 2);
    expect(peak.keepoutEnd).toBeCloseTo(peak.t + 0.2, 2);
  });
});
