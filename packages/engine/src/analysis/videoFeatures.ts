/**
 * Local deterministic video feature extraction for Panoptik.
 * Computes 64-bin RGB color histograms, adaptive chi-square scene cuts,
 * 16-hue palette indexes, motion categories, and quadrant background entropy.
 */

export type MotionCategory = "static" | "medium" | "high";
export type CamCorner = "tl" | "tr" | "bl" | "br";

export interface VideoFrameSample {
  t: number;
  histogram: Float32Array; // 64 bins (4x4x4 RGB)
  motion: number; // 0.0 to 1.0
  paletteIndex: number; // 0..15
  entropyCorners: Record<CamCorner, number>;
}

export interface SceneFeature {
  id: number;
  t0: number;
  t1: number;
  motionCategory: MotionCategory;
  paletteIndex: number;
  camCorner: CamCorner;
  keyframeTime: number;
}

/**
 * 64-bin RGB color histogram (4 bins per channel: R, G, B).
 * Returns a normalized Float32Array where sum(bins) = 1.0.
 */
export function computeRgbHistogram(
  data: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): Float32Array {
  const bins = new Float32Array(64);
  if (pixelCount <= 0) return bins;

  const totalChannels = pixelCount * 4;
  for (let i = 0; i < totalChannels; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const rBin = Math.min(3, Math.floor(r / 64));
    const gBin = Math.min(3, Math.floor(g / 64));
    const bBin = Math.min(3, Math.floor(b / 64));
    const binIdx = rBin * 16 + gBin * 4 + bBin;
    bins[binIdx] = (bins[binIdx] ?? 0) + 1;
  }

  // Normalize
  for (let i = 0; i < 64; i++) {
    bins[i] = (bins[i] ?? 0) / pixelCount;
  }
  return bins;
}

/**
 * Chi-Square distance between two normalized histograms.
 * Distance range: [0.0, 1.0].
 */
export function computeChiSquareDistance(
  h1: Float32Array,
  h2: Float32Array,
): number {
  let dist = 0;
  const eps = 1e-7;
  for (let i = 0; i < 64; i++) {
    const a = h1[i] ?? 0;
    const b = h2[i] ?? 0;
    const sum = a + b;
    if (sum > eps) {
      const diff = a - b;
      dist += (diff * diff) / sum;
    }
  }
  return 0.5 * dist;
}

/**
 * Mean absolute RGB pixel difference between consecutive downsampled frames.
 * Returns normalized motion energy in [0.0, 1.0].
 */
export function computeMotionEnergy(
  prevData: Uint8ClampedArray | Uint8Array,
  currData: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): number {
  if (pixelCount <= 0 || prevData.length !== currData.length) return 0;
  let totalDiff = 0;
  const totalChannels = pixelCount * 4;

  for (let i = 0; i < totalChannels; i += 4) {
    const dr = Math.abs((currData[i] ?? 0) - (prevData[i] ?? 0));
    const dg = Math.abs((currData[i + 1] ?? 0) - (prevData[i + 1] ?? 0));
    const db = Math.abs((currData[i + 2] ?? 0) - (prevData[i + 2] ?? 0));
    totalDiff += (dr + dg + db) / (3 * 255);
  }

  return totalDiff / pixelCount;
}

/**
 * Classifies continuous motion energy into a compact discrete category.
 */
export function classifyMotion(energy: number): MotionCategory {
  if (energy < 0.06) return "static";
  if (energy < 0.28) return "medium";
  return "high";
}

/**
 * Detects localized cursor movements / clicks from consecutive frame differences.
 * Identifies high-contrast localized spatial clusters (e.g. 16px - 140px) vs global frame shifts.
 */
export function detectCursorInteractionFromFrames(
  prevData: Uint8ClampedArray | Uint8Array,
  currData: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  t: number,
): { t: number; x: number; y: number; type: "click" } | null {
  if (width < 32 || height < 32 || prevData.length !== currData.length) return null;

  let sumDiff = 0;
  let activePixels = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  const threshold = 35; // RGB diff threshold

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const dr = Math.abs((currData[idx] ?? 0) - (prevData[idx] ?? 0));
      const dg = Math.abs((currData[idx + 1] ?? 0) - (prevData[idx + 1] ?? 0));
      const db = Math.abs((currData[idx + 2] ?? 0) - (prevData[idx + 2] ?? 0));
      const diff = (dr + dg + db) / 3;

      if (diff > threshold) {
        sumDiff += diff;
        activePixels++;
        weightedX += x * diff;
        weightedY += y * diff;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const totalSampled = (width * height) / 4;
  const activeRatio = activePixels / totalSampled;

  // Localized motion: active between 0.05% and 8% of the screen (cursor movement/click, not full-screen scroll)
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const isLocalized = spanX < width * 0.35 && spanY < height * 0.35 && spanX > 4 && spanY > 4;

  if (activeRatio > 0.0005 && activeRatio < 0.08 && isLocalized && sumDiff > 0) {
    const cx = Number((weightedX / sumDiff / width).toFixed(3));
    const cy = Number((weightedY / sumDiff / height).toFixed(3));
    return {
      t: Number(t.toFixed(2)),
      x: Math.max(0.01, Math.min(0.99, cx)),
      y: Math.max(0.01, Math.min(0.99, cy)),
      type: "click",
    };
  }

  return null;
}

/**
 * Quantizes dominant frame colors into a compact 16-hue index (0..15).
 */
export function computePaletteIndex(
  data: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
): number {
  if (pixelCount <= 0) return 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const totalChannels = pixelCount * 4;

  for (let i = 0; i < totalChannels; i += 4) {
    sumR += data[i] ?? 0;
    sumG += data[i + 1] ?? 0;
    sumB += data[i + 2] ?? 0;
  }

  const avgR = sumR / pixelCount;
  const avgG = sumG / pixelCount;
  const avgB = sumB / pixelCount;

  // Compute Hue and Saturation
  const max = Math.max(avgR, avgG, avgB);
  const min = Math.min(avgR, avgG, avgB);
  const delta = max - min;

  if (delta < 15) {
    if (max < 60) return 0; // Slate Dark
    if (max < 160) return 1; // Gray
    return 2; // Zinc / Light
  }

  let hue = 0;
  if (max === avgR) {
    hue = ((avgG - avgB) / delta) % 6;
  } else if (max === avgG) {
    hue = (avgB - avgR) / delta + 2;
  } else {
    hue = (avgR - avgG) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  if (hue >= 195 && hue < 225) return 3; // Blue
  if (hue >= 170 && hue < 195) return 4; // Cyan
  if (hue >= 150 && hue < 170) return 5; // Sky
  if (hue >= 135 && hue < 150) return 6; // Teal
  if (hue >= 110 && hue < 135) return 7; // Emerald
  if (hue >= 75 && hue < 110) return 8; // Green
  if (hue >= 45 && hue < 75) return 9; // Amber
  if (hue >= 25 && hue < 45) return 10; // Orange
  if (hue >= 345 || hue < 25) return 11; // Red
  if (hue >= 315 && hue < 345) return 12; // Rose
  if (hue >= 280 && hue < 315) return 13; // Purple
  if (hue >= 255 && hue < 280) return 14; // Violet
  return 15; // Indigo
}

/**
 * Computes edge entropy (variance of luminance gradients) in 4 quadrants:
 * tl (top-left), tr (top-right), bl (bottom-left), br (bottom-right).
 */
export function computeQuadrantEntropy(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Record<CamCorner, number> {
  const corners: Record<CamCorner, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  if (width < 4 || height < 4) return corners;

  const quadW = Math.max(1, Math.floor(width * 0.22));
  const quadH = Math.max(1, Math.floor(height * 0.22));

  const sampleQuadrant = (startX: number, startY: number): number => {
    let sumGrad = 0;
    let sumGradSq = 0;
    let count = 0;

    for (let y = startY; y < startY + quadH - 1; y++) {
      for (let x = startX; x < startX + quadW - 1; x++) {
        const idx = (y * width + x) * 4;
        const rightIdx = (y * width + (x + 1)) * 4;
        const downIdx = ((y + 1) * width + x) * 4;

        const lum = 0.299 * (data[idx] ?? 0) + 0.587 * (data[idx + 1] ?? 0) + 0.114 * (data[idx + 2] ?? 0);
        const lumR = 0.299 * (data[rightIdx] ?? 0) + 0.587 * (data[rightIdx + 1] ?? 0) + 0.114 * (data[rightIdx + 2] ?? 0);
        const lumD = 0.299 * (data[downIdx] ?? 0) + 0.587 * (data[downIdx + 1] ?? 0) + 0.114 * (data[downIdx + 2] ?? 0);

        const grad = Math.abs(lumR - lum) + Math.abs(lumD - lum);
        sumGrad += grad;
        sumGradSq += grad * grad;
        count++;
      }
    }

    if (count <= 0) return 0;
    const mean = sumGrad / count;
    const variance = sumGradSq / count - mean * mean;
    return Math.max(0, variance);
  };

  corners.tl = sampleQuadrant(0, 0);
  corners.tr = sampleQuadrant(width - quadW, 0);
  corners.bl = sampleQuadrant(0, height - quadH);
  corners.br = sampleQuadrant(width - quadW, height - quadH);

  return corners;
}

/**
 * Resolves the optimal CamCorner by scoring 4 quadrants using:
 * 1. Background Edge Entropy (lower is less cluttered)
 * 2. Weighted Cursor Proximity Penalty (avoids placing camera near user mouse clicks/activity)
 * 3. Bottom-Left Keepout Penalty (prevents obscuring video titles, closed captions, and player controls)
 * 4. Current Corner Inertia (maintains current placement unless strongly occluded)
 */
export function resolveBestCamCorner(
  entropyCorners: Record<CamCorner, number>,
  clickCentroid?: { x: number; y: number } | null,
  options: {
    clicks?: Array<{ x: number; y: number }>;
    currentCorner?: CamCorner | "none";
  } = {},
): CamCorner {
  const cornerPositions: Record<CamCorner, { x: number; y: number }> = {
    tl: { x: 0.12, y: 0.12 },
    tr: { x: 0.88, y: 0.12 },
    bl: { x: 0.12, y: 0.88 },
    br: { x: 0.88, y: 0.88 },
  };

  const corners: CamCorner[] = ["br", "tr", "bl", "tl"];
  const maxEntropy = Math.max(1, ...Object.values(entropyCorners));

  let bestCorner: CamCorner = options.currentCorner && options.currentCorner !== "none" ? options.currentCorner : "br";
  let minScore = Infinity;

  for (const corner of corners) {
    const pos = cornerPositions[corner];
    const normEntropy = (entropyCorners[corner] ?? 0) / maxEntropy;
    let score = normEntropy;

    // 1. Cursor Collision Penalty
    if (clickCentroid) {
      const dist = Math.hypot(pos.x - clickCentroid.x, pos.y - clickCentroid.y);
      if (dist < 0.30) {
        score += Math.max(0, 1.6 * (1 - dist / 0.30));
      }
    }

    if (options.clicks && options.clicks.length > 0) {
      for (const c of options.clicks) {
        const dist = Math.hypot(pos.x - c.x, pos.y - c.y);
        if (dist < 0.26) {
          score += Math.max(0, 0.9 * (1 - dist / 0.26));
        }
      }
    }

    // 2. Bottom-Left Keepout Penalty (Video Titles, Closed Captions, Player Controls)
    if (corner === "bl") {
      score += 0.40;
    }

    // 3. Current Corner Continuity Bonus
    if (options.currentCorner && options.currentCorner === corner) {
      score -= 0.25;
    }

    if (score < minScore) {
      minScore = score;
      bestCorner = corner;
    }
  }

  return bestCorner;
}

/**
 * Adaptive median absolute deviation helper.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const valMid = sorted[mid] ?? 0;
  const valMidPrev = sorted[mid - 1] ?? 0;
  return sorted.length % 2 !== 0 ? valMid : (valMidPrev + valMid) / 2;
}

/**
 * Detects scene boundaries from a sequence of sampled video frames using adaptive
 * Chi-Square thresholding: threshold = max(rollingMedian + 2.5 * MAD, 0.25).
 */
export function detectScenesFromSamples(
  samples: VideoFrameSample[],
  minSceneDuration = 1.5,
): SceneFeature[] {
  if (samples.length === 0) return [];
  if (samples.length === 1) {
    const s = samples[0]!;
    return [
      {
        id: 0,
        t0: 0,
        t1: Math.max(0.1, Number(s.t.toFixed(1))),
        motionCategory: classifyMotion(s.motion),
        paletteIndex: s.paletteIndex,
        camCorner: resolveBestCamCorner(s.entropyCorners),
        keyframeTime: Number(s.t.toFixed(1)),
      },
    ];
  }

  // Compute consecutive frame distances
  const distances: number[] = [0];
  for (let i = 1; i < samples.length; i++) {
    const prevH = samples[i - 1]?.histogram ?? new Float32Array(64);
    const currH = samples[i]?.histogram ?? new Float32Array(64);
    const dist = computeChiSquareDistance(prevH, currH);
    distances.push(dist);
  }

  // Rolling window MAD calculation (window = 10 samples)
  const cuts: number[] = [0];
  let lastCutSampleIdx = 0;

  for (let i = 1; i < samples.length; i++) {
    const tCurrent = samples[i]?.t ?? 0;
    const tLastCut = samples[lastCutSampleIdx]?.t ?? 0;

    if (tCurrent - tLastCut < minSceneDuration) {
      continue;
    }

    const windowStart = Math.max(0, i - 10);
    const windowDistances = distances.slice(windowStart, i);
    const med = median(windowDistances);
    const mad = median(windowDistances.map((d) => Math.abs(d - med)));

    const adaptiveThreshold = Math.max(med + 2.5 * mad, 0.25);
    const dist = distances[i] ?? 0;

    if (dist > adaptiveThreshold) {
      cuts.push(i);
      lastCutSampleIdx = i;
    }
  }

  // Build SceneFeature intervals
  const scenes: SceneFeature[] = [];
  for (let c = 0; c < cuts.length; c++) {
    const startIdx = cuts[c] ?? 0;
    const nextCut = cuts[c + 1];
    const endIdx = typeof nextCut === "number" ? nextCut - 1 : samples.length - 1;
    const segmentSamples = samples.slice(startIdx, endIdx + 1);

    const sStart = samples[startIdx];
    const sEnd = samples[endIdx];
    const t0 = sStart ? Number(sStart.t.toFixed(1)) : 0;
    const t1 = sEnd ? Number(sEnd.t.toFixed(1)) : t0 + 1.5;

    const midIdx = Math.floor((startIdx + endIdx) / 2);
    const midSample = samples[midIdx] ?? sStart ?? samples[0]!;

    const avgMotion =
      segmentSamples.reduce((sum, s) => sum + s.motion, 0) /
      (segmentSamples.length || 1);

    scenes.push({
      id: c,
      t0,
      t1: Math.max(t0 + 0.1, t1),
      motionCategory: classifyMotion(avgMotion),
      paletteIndex: midSample.paletteIndex,
      camCorner: resolveBestCamCorner(midSample.entropyCorners),
      keyframeTime: Number(midSample.t.toFixed(1)),
    });
  }

  return scenes;
}
