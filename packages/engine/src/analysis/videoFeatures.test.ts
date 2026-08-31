import { describe, expect, it } from "vitest";
import {
  classifyMotion,
  computeChiSquareDistance,
  computeMotionEnergy,
  computePaletteIndex,
  computeQuadrantEntropy,
  computeRgbHistogram,
  detectScenesFromSamples,
  resolveBestCamCorner,
  type VideoFrameSample,
} from "./videoFeatures";

describe("videoFeatures", () => {
  it("computes 64-bin normalized RGB histogram", () => {
    // 4 pixels: 2 red (255, 0, 0), 2 blue (0, 0, 255)
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ]);
    const hist = computeRgbHistogram(data, 4);
    expect(hist).toHaveLength(64);

    // Sum of histogram must equal 1.0
    const sum = hist.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);

    // Red bin: rBin=3, gBin=0, bBin=0 -> index 3*16 + 0 + 0 = 48
    expect(hist[48]!).toBeCloseTo(0.5, 5);
    // Blue bin: rBin=0, gBin=0, bBin=3 -> index 0 + 0 + 3 = 3
    expect(hist[3]!).toBeCloseTo(0.5, 5);
  });

  it("calculates chi-square distance accurately", () => {
    const h1 = new Float32Array(64);
    const h2 = new Float32Array(64);
    h1[0] = 1.0;
    h2[0] = 1.0;
    // Identical histograms
    expect(computeChiSquareDistance(h1, h2)).toBeCloseTo(0.0, 5);

    // Completely disjoint histograms
    h2[0] = 0.0;
    h2[10] = 1.0;
    expect(computeChiSquareDistance(h1, h2)).toBeGreaterThan(0.9);
  });

  it("computes motion energy and classifies into categories", () => {
    const prev = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255]);
    const currStatic = new Uint8ClampedArray([12, 10, 10, 255, 10, 11, 10, 255]);
    const energyStatic = computeMotionEnergy(prev, currStatic, 2);
    expect(classifyMotion(energyStatic)).toBe("static");

    const currHigh = new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const energyHigh = computeMotionEnergy(prev, currHigh, 2);
    expect(classifyMotion(energyHigh)).toBe("high");
  });

  it("quantizes dominant colors into 16-hue palette index", () => {
    // Dark gray / slate
    const darkData = new Uint8ClampedArray([20, 24, 30, 255, 25, 28, 35, 255]);
    expect(computePaletteIndex(darkData, 2)).toBe(0);

    // Pure bright blue (0, 120, 255)
    const blueData = new Uint8ClampedArray([0, 140, 255, 255, 10, 130, 250, 255]);
    expect(computePaletteIndex(blueData, 2)).toBe(3); // Blue
  });

  it("computes 4-quadrant edge entropy and selects optimal CamCorner avoiding centroid collision", () => {
    // Top-left is simple/flat (low entropy), bottom-right is noisy (high entropy)
    const entropyCorners = {
      tl: 1.2,
      tr: 8.5,
      bl: 12.0,
      br: 45.0,
    };

    // No centroid -> picks tl
    expect(resolveBestCamCorner(entropyCorners, null)).toBe("tl");

    // Centroid right over top-left corner (0.10, 0.10) -> picks second-best (tr)
    expect(resolveBestCamCorner(entropyCorners, { x: 0.10, y: 0.10 })).toBe("tr");
  });

  it("detects scene cuts adaptively and honors minimum scene duration", () => {
    const darkHist = new Float32Array(64);
    darkHist[0] = 1.0;
    const brightHist = new Float32Array(64);
    brightHist[63] = 1.0;

    const samples: VideoFrameSample[] = [
      { t: 0.0, histogram: darkHist, motion: 0.02, paletteIndex: 0, entropyCorners: { tl: 1, tr: 2, bl: 3, br: 4 } },
      { t: 0.7, histogram: darkHist, motion: 0.02, paletteIndex: 0, entropyCorners: { tl: 1, tr: 2, bl: 3, br: 4 } },
      { t: 1.4, histogram: darkHist, motion: 0.02, paletteIndex: 0, entropyCorners: { tl: 1, tr: 2, bl: 3, br: 4 } },
      // Sudden transition to bright at t=2.1s (>= 1.5s from start)
      { t: 2.1, histogram: brightHist, motion: 0.65, paletteIndex: 3, entropyCorners: { tl: 5, tr: 1, bl: 2, br: 8 } },
      { t: 2.8, histogram: brightHist, motion: 0.05, paletteIndex: 3, entropyCorners: { tl: 5, tr: 1, bl: 2, br: 8 } },
      { t: 3.5, histogram: brightHist, motion: 0.04, paletteIndex: 3, entropyCorners: { tl: 5, tr: 1, bl: 2, br: 8 } },
    ];

    const scenes = detectScenesFromSamples(samples, 1.5);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]!.id).toBe(0);
    expect(scenes[0]!.t0).toBe(0.0);
    expect(scenes[0]!.t1).toBe(1.4);
    expect(scenes[0]!.motionCategory).toBe("static");

    expect(scenes[1]!.id).toBe(1);
    expect(scenes[1]!.t0).toBe(2.1);
    expect(scenes[1]!.t1).toBe(3.5);
  });
});
