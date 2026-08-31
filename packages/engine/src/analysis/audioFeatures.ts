/**
 * Local deterministic audio feature extraction for Panoptik.
 * Analyzes mono PCM audio over 20ms RMS windows to detect dead-air silences (>=450ms),
 * minor pause boundaries (150-450ms), and vocal loudness emphasis peaks with keepout zones.
 */

export interface SilenceInterval {
  start: number;
  end: number;
  duration: number;
}

export interface AudioEmphasisPeak {
  t: number;
  rms: number;
  rmsRatio: number;
  keepoutStart: number;
  keepoutEnd: number;
}

export interface AudioAnalysisResult {
  duration: number;
  silences: SilenceInterval[];
  minorPauses: SilenceInterval[];
  loudPeaks: AudioEmphasisPeak[];
  speechRatio: number;
}

/**
 * Computes sliding RMS energy over a Float32Array mono channel.
 * @param channelData Float32Array PCM samples (range [-1.0, 1.0])
 * @param sampleRate e.g. 48000 or 16000
 * @param windowMs Window size in milliseconds (default 20ms)
 * @param hopMs Step size in milliseconds (default 10ms)
 */
export function computeRmsEnergy(
  channelData: Float32Array,
  sampleRate: number,
  windowMs = 20,
  hopMs = 10,
): { times: Float32Array; rms: Float32Array } {
  const windowSamples = Math.max(1, Math.floor((sampleRate * windowMs) / 1000));
  const hopSamples = Math.max(1, Math.floor((sampleRate * hopMs) / 1000));
  const totalWindows = Math.max(
    0,
    Math.floor((channelData.length - windowSamples) / hopSamples) + 1,
  );

  const times = new Float32Array(totalWindows);
  const rms = new Float32Array(totalWindows);

  for (let i = 0; i < totalWindows; i++) {
    const start = i * hopSamples;
    let sumSq = 0;
    for (let j = 0; j < windowSamples; j++) {
      const s = channelData[start + j] ?? 0;
      sumSq += s * s;
    }
    rms[i] = Math.sqrt(sumSq / windowSamples);
    times[i] = (start + windowSamples / 2) / sampleRate;
  }

  return { times, rms };
}

/**
 * Analyzes audio features from mono PCM data.
 * @param channelData Mono Float32Array PCM data
 * @param sampleRate Sample rate in Hz (e.g. 48000 or 16000)
 * @param silenceThreshold Absolute RMS threshold for silence (default 0.012)
 */
export function extractAudioFeatures(
  channelData: Float32Array,
  sampleRate: number,
  silenceThreshold = 0.012,
): AudioAnalysisResult {
  const duration = channelData.length / sampleRate;
  if (duration <= 0) {
    return {
      duration: 0,
      silences: [],
      minorPauses: [],
      loudPeaks: [],
      speechRatio: 0,
    };
  }

  const { times, rms } = computeRmsEnergy(channelData, sampleRate, 20, 10);
  const numWindows = times.length;
  if (numWindows === 0) {
    return {
      duration,
      silences: [],
      minorPauses: [],
      loudPeaks: [],
      speechRatio: 0,
    };
  }

  // 1. Detect contiguous silence windows
  const isSilent = new Uint8Array(numWindows);
  let totalSpeechWindows = 0;

  for (let i = 0; i < numWindows; i++) {
    if ((rms[i] ?? 0) < silenceThreshold) {
      isSilent[i] = 1;
    } else {
      isSilent[i] = 0;
      totalSpeechWindows++;
    }
  }

  const speechRatio = numWindows > 0 ? totalSpeechWindows / numWindows : 0;

  // Group silent windows into intervals
  const silences: SilenceInterval[] = [];
  const minorPauses: SilenceInterval[] = [];

  let inSilence = false;
  let silenceStart = 0;

  for (let i = 0; i < numWindows; i++) {
    const isCurrentSilent = (isSilent[i] ?? 0) === 1;
    const tCurrent = times[i] ?? 0;
    const tPrev = times[i - 1] ?? tCurrent;

    if (isCurrentSilent && !inSilence) {
      inSilence = true;
      silenceStart = tCurrent;
    } else if (!isCurrentSilent && inSilence) {
      inSilence = false;
      const silenceEnd = tPrev;
      const dur = Number((silenceEnd - silenceStart).toFixed(2));
      if (dur >= 0.45) {
        silences.push({
          start: Number(silenceStart.toFixed(2)),
          end: Number(silenceEnd.toFixed(2)),
          duration: dur,
        });
      } else if (dur >= 0.15) {
        minorPauses.push({
          start: Number(silenceStart.toFixed(2)),
          end: Number(silenceEnd.toFixed(2)),
          duration: dur,
        });
      }
    }
  }

  // Handle trailing silence
  if (inSilence) {
    const silenceEnd = times[numWindows - 1] ?? silenceStart;
    const dur = Number((silenceEnd - silenceStart).toFixed(2));
    if (dur >= 0.45) {
      silences.push({
        start: Number(silenceStart.toFixed(2)),
        end: Number(silenceEnd.toFixed(2)),
        duration: dur,
      });
    } else if (dur >= 0.15) {
      minorPauses.push({
        start: Number(silenceStart.toFixed(2)),
        end: Number(silenceEnd.toFixed(2)),
        duration: dur,
      });
    }
  }

  // 2. Detect vocal emphasis peaks (> 3.2x rolling 5-second average RMS)
  const rollingWindowSize = Math.floor((5.0 * 1000) / 10);
  const loudPeaks: AudioEmphasisPeak[] = [];
  let lastPeakTime = -1;

  for (let i = 0; i < numWindows; i++) {
    const t = times[i] ?? 0;
    const currentRms = rms[i] ?? 0;

    const startIdx = Math.max(0, i - Math.floor(rollingWindowSize / 2));
    const endIdx = Math.min(numWindows, i + Math.floor(rollingWindowSize / 2));
    let sumRms = 0;
    for (let w = startIdx; w < endIdx; w++) {
      sumRms += rms[w] ?? 0;
    }
    const rollingAvg = sumRms / (endIdx - startIdx || 1);

    if (currentRms > 0.08 && currentRms > 3.2 * rollingAvg) {
      if (t - lastPeakTime >= 0.4) {
        loudPeaks.push({
          t: Number(t.toFixed(2)),
          rms: Number(currentRms.toFixed(3)),
          rmsRatio: Number((currentRms / (rollingAvg || 0.01)).toFixed(1)),
          keepoutStart: Math.max(0, Number((t - 0.2).toFixed(2))),
          keepoutEnd: Math.min(duration, Number((t + 0.2).toFixed(2))),
        });
        lastPeakTime = t;
      }
    }
  }

  return {
    duration: Number(duration.toFixed(2)),
    silences,
    minorPauses,
    loudPeaks,
    speechRatio: Number(speechRatio.toFixed(2)),
  };
}
