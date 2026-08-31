/**
 * Audio payload resampler, chunking, and overlap-and-dedupe transcript merger for Panoptik.
 * Handles 16kHz mono PCM resampling, 15-minute chunking with 2.0s unmixed overlap,
 * and fuzzy boundary word deduplication.
 */

export interface DiarizedWord {
  word: string;
  start: number;
  end: number;
  speaker?: number;
  confidence?: number;
}

export interface AudioChunk {
  chunkIndex: number;
  startSec: number;
  endSec: number;
  overlapSec: number;
  samples: Float32Array;
}

/**
 * Resamples a Float32Array from `inSampleRate` to `outSampleRate` (e.g. 48000 -> 16000) using linear interpolation.
 */
export function resampleMonoPcm(
  input: Float32Array,
  inSampleRate: number,
  outSampleRate = 16000,
): Float32Array {
  if (inSampleRate === outSampleRate) return input.slice();
  if (input.length === 0) return new Float32Array(0);

  const ratio = inSampleRate / outSampleRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = srcIdx - i0;
    const v0 = input[i0] ?? 0;
    const v1 = input[i1] ?? 0;
    output[i] = (1 - frac) * v0 + frac * v1;
  }

  return output;
}

/**
 * Encodes 16kHz Float32Array mono PCM into a standard 16-bit PCM WAV Blob.
 */
export function encodeWavBlob(
  samples: Float32Array,
  sampleRate = 16000,
): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // RIFF chunk length
  view.setUint32(4, 36 + dataSize, true);
  // RIFF type
  writeString(view, 8, "WAVE");
  // format chunk identifier
  writeString(view, 12, "fmt ");
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // channel count
  view.setUint16(22, numChannels, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate
  view.setUint32(28, byteRate, true);
  // block align
  view.setUint16(32, blockAlign, true);
  // bits per sample
  view.setUint16(34, bitsPerSample, true);
  // data chunk identifier
  writeString(view, 36, "data");
  // data chunk length
  view.setUint32(40, dataSize, true);

  // Write Float32 samples as 16-bit signed PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Splits long audio (> 30 min) into 15-minute chunks with a 2.0s unmixed overlap region.
 */
export function chunkAudioSamples(
  samples: Float32Array,
  sampleRate = 16000,
  chunkDurationSec = 15 * 60, // 15 min
  overlapSec = 2.0, // 2.0s
): AudioChunk[] {
  const totalDuration = samples.length / sampleRate;
  if (totalDuration <= chunkDurationSec) {
    return [
      {
        chunkIndex: 0,
        startSec: 0,
        endSec: totalDuration,
        overlapSec: 0,
        samples,
      },
    ];
  }

  const chunks: AudioChunk[] = [];
  const chunkSamples = Math.floor(chunkDurationSec * sampleRate);
  const overlapSamples = Math.floor(overlapSec * sampleRate);
  const stepSamples = chunkSamples - overlapSamples;

  let currentStartSample = 0;
  let chunkIdx = 0;

  while (currentStartSample < samples.length) {
    const endSample = Math.min(samples.length, currentStartSample + chunkSamples);
    const chunkData = samples.slice(currentStartSample, endSample);

    const startSec = Number((currentStartSample / sampleRate).toFixed(2));
    const endSec = Number((endSample / sampleRate).toFixed(2));

    chunks.push({
      chunkIndex: chunkIdx,
      startSec,
      endSec,
      overlapSec: chunkIdx > 0 ? overlapSec : 0,
      samples: chunkData,
    });

    if (endSample >= samples.length) break;
    currentStartSample += stepSamples;
    chunkIdx++;
  }

  return chunks;
}

/**
 * Merges transcript words from overlapped chunks.
 */
export function mergeOverlappedChunkWords(
  chunkWords: { chunkIndex: number; startOffsetSec: number; chunkDurationSec: number; words: DiarizedWord[] }[],
  overlapSec = 2.0,
): DiarizedWord[] {
  if (chunkWords.length === 0) return [];
  if (chunkWords.length === 1) {
    const first = chunkWords[0];
    if (!first) return [];
    return first.words.map((w) => ({
      ...w,
      start: Number((w.start + first.startOffsetSec).toFixed(3)),
      end: Number((w.end + first.startOffsetSec).toFixed(3)),
    }));
  }

  const allWords: DiarizedWord[] = [];

  for (let c = 0; c < chunkWords.length; c++) {
    const item = chunkWords[c];
    if (!item) continue;
    const { startOffsetSec, chunkDurationSec, words } = item;
    const isFirstChunk = c === 0;
    const isLastChunk = c === chunkWords.length - 1;

    for (const w of words) {
      const localStart = w.start;
      const localEnd = w.end;
      const globalStart = Number((localStart + startOffsetSec).toFixed(3));
      const globalEnd = Number((localEnd + startOffsetSec).toFixed(3));

      allWords.push({
        ...w,
        start: globalStart,
        end: globalEnd,
      });
    }
  }

  // Sort by start timestamp
  allWords.sort((a, b) => a.start - b.start);

  // Deduplicate and fuzzy-merge boundary words
  const merged: DiarizedWord[] = [];
  for (let i = 0; i < allWords.length; i++) {
    const current = allWords[i];
    if (!current) continue;
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }

    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push({ ...current });
      continue;
    }

    if (
      Math.abs(prev.start - current.start) < 0.35 &&
      prev.word.toLowerCase() === current.word.toLowerCase()
    ) {
      continue;
    }

    if (
      current.start - prev.end <= 0.08 &&
      current.word.length === 1 &&
      !prev.word.endsWith(".") &&
      !prev.word.endsWith("?") &&
      !prev.word.endsWith("!")
    ) {
      const combined = prev.word + current.word;
      if (isValidWordConcat(prev.word, current.word)) {
        prev.word = combined;
        prev.end = current.end;
        continue;
      }
    }

    merged.push({ ...current });
  }

  return merged;
}

function isValidWordConcat(w1: string, w2: string): boolean {
  // Only merge if w2 is a single character letter fragment (e.g. "t", "s", "d")
  return w2.length === 1 && /^[a-zA-Z]+$/.test(w1) && /^[a-zA-Z]+$/.test(w2);
}

/**
 * Denoises 16kHz mono Float32 audio samples:
 * 1. High-Pass Filter (80Hz) to remove room rumble, AC hum, and microphone pops.
 * 2. Adaptive Noise Gate with soft-knee envelope to suppress background hiss/silence below noise floor.
 */
export function denoiseAudioSamples(
  samples: Float32Array,
  sampleRate = 16000,
  opts: {
    highPassCutoff?: number; // default 80Hz
    noiseGateThreshold?: number; // RMS threshold
  } = {},
): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  const out = new Float32Array(samples.length);

  // 1. High-Pass Filter at ~80Hz (Single-pole RC high-pass filter)
  const cutoff = opts.highPassCutoff ?? 80;
  const rc = 1.0 / (2.0 * Math.PI * cutoff);
  const dt = 1.0 / sampleRate;
  const alpha = rc / (rc + dt);

  let prevInput = samples[0] ?? 0;
  let prevOutput = samples[0] ?? 0;

  for (let i = 0; i < samples.length; i++) {
    const curr = samples[i] ?? 0;
    const filtered = alpha * (prevOutput + curr - prevInput);
    out[i] = filtered;
    prevInput = curr;
    prevOutput = filtered;
  }

  // 2. Estimate Noise Floor (lower 15th percentile energy)
  const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
  const numWindows = Math.floor(out.length / windowSize);
  const windowEnergies: number[] = [];

  for (let w = 0; w < numWindows; w++) {
    let sumSq = 0;
    const start = w * windowSize;
    for (let i = start; i < start + windowSize; i++) {
      const s = out[i] ?? 0;
      sumSq += s * s;
    }
    windowEnergies.push(Math.sqrt(sumSq / windowSize));
  }

  windowEnergies.sort((a, b) => a - b);
  const noiseFloor = windowEnergies[Math.floor(windowEnergies.length * 0.15)] ?? 0.002;
  const gateThreshold = opts.noiseGateThreshold ?? Math.max(noiseFloor * 2.2, 0.0035);

  // 3. Apply Adaptive Noise Gate with soft envelope
  let envelope = 1.0;
  const attack = 0.95; // Fast attack for voice transients
  const release = 0.992; // Smooth release for word tails

  for (let w = 0; w < numWindows; w++) {
    const start = w * windowSize;
    let sumSq = 0;
    for (let i = start; i < start + windowSize; i++) {
      const s = out[i] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / windowSize);
    const targetGain = rms < gateThreshold ? 0.0 : 1.0;

    for (let i = start; i < start + windowSize; i++) {
      envelope = targetGain > envelope
        ? attack * envelope + (1 - attack) * targetGain
        : release * envelope + (1 - release) * targetGain;
      out[i] = (out[i] ?? 0) * envelope;
    }
  }

  return out;
}

/**
 * Computes root-mean-square voice activity energy for a chunk of audio samples.
 */
export function computeChunkVoiceEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples.length);
}
