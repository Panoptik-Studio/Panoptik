/**
 * Pitch-preserving time-stretch (WSOLA — Waveform Similarity Overlap-Add).
 *
 * WHY: export previously used OfflineAudioContext's `AudioBufferSourceNode
 * .playbackRate` to speed audio up, but that is *vari-speed*: it changes both
 * speed and pitch, so a sped-up export came out "chipmunk". The preview is
 * correct because an HTMLMediaElement preserves pitch by default. WSOLA keeps
 * pitch while changing only duration (outLen = inLen / rate).
 *
 * Pure TS, no DOM/WebAPI needed — runs under node for tests and in the browser
 * for export.
 */

/** Build a DOM-free AudioBuffer, using the native ctor when available. */
export function makeBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
  channelData: Float32Array[],
): AudioBuffer {
  const anyCtor = (globalThis as unknown as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
  if (anyCtor) {
    try {
      const real = new anyCtor({ length, numberOfChannels, sampleRate });
      for (let ch = 0; ch < numberOfChannels; ch++) {
        try {
          real.copyToChannel(channelData[ch]! as Float32Array<ArrayBuffer>, ch, 0);
        } catch {
          /* ignore */
        }
      }
      return real as AudioBuffer;
    } catch {
      /* fall through */
    }
  }
  const channels: Float32Array[] = Array.from({ length: numberOfChannels }, (_, ch) => {
    const c = new Float32Array(length);
    const s = channelData[ch];
    if (s) for (let i = 0; i < length; i++) c[i] = i < s.length ? s[i]! : 0;
    return c;
  });
  return {
    length,
    sampleRate,
    numberOfChannels,
    duration: length / sampleRate,
    getChannelData: (ch: number) => channels[ch]!,
  } as unknown as AudioBuffer;
}

/** Normalised cross-correlation of two equal-length windows. */
function crossCorrelate(a: Float32Array, aOff: number, b: Float32Array, bOff: number, len: number): number {
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < len; i++) {
    const x = a[aOff + i] ?? 0;
    const y = b[bOff + i] ?? 0;
    num += x * y;
    denA += x * x;
    denB += y * y;
  }
  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : 0;
}

/**
 * Time-stretch `buffer` by factor `rate` while preserving pitch.
 *
 * rate > 1 → faster (shorter output), rate < 1 → slower (longer output),
 * rate === 1 → near-identity copy. Output length ≈ input.length / rate.
 */
export function timeStretch(buffer: AudioBuffer, rate: number): AudioBuffer {
  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const inLen = buffer.length;
  const outLen = Math.max(1, Math.round(inLen / rate));

  // Frame geometry: 40ms frames with 4x overlap give clean cross-fades while
  // keeping the best-match search cheap.
  const N = Math.max(256, Math.round(sr * 0.04)); // analysis frame
  const Ss = Math.max(64, Math.round(N / 4)); // synthesis hop (output)
  const Sa = Math.max(1, Math.round(Ss * rate)); // analysis hop (input)
  const OL = N - Ss; // overlap length in the output domain
  const R = Math.round(Ss * 0.5); // ± search range for best-match offset

  // Mono reference so every channel shares one offset sequence (phase coherent).
  const ref = new Float32Array(inLen);
  for (let i = 0; i < inLen; i++) {
    let s = 0;
    for (let ch = 0; ch < nCh; ch++) s += buffer.getChannelData(ch)![i] ?? 0;
    ref[i] = nCh > 0 ? s / nCh : 0;
  }

  if (outLen < 2) {
    const samples = Array.from({ length: nCh }, (_, ch) => new Float32Array([buffer.getChannelData(ch)![0] ?? 0]));
    return makeBuffer(nCh, 1, sr, samples);
  }

  // First find the offset sequence by WSOLA-ing the mono reference; the
  // correlation target is the already-synthesised output overlap region.
  const refOut = new Float32Array(outLen);
  const offsets: number[] = [0];
  {
    const fn = Math.min(N, outLen);
    for (let i = 0; i < fn; i++) refOut[i] = ref[i] ?? 0;
    let curOut = Ss;
    let anaPos = Sa;
    while (curOut < outLen && anaPos < inLen) {
      const lo = Math.max(0, anaPos - R);
      const hi = Math.min(inLen - 1 - OL, anaPos + R);
      let best = anaPos;
      let bestCorr = -Infinity;
      for (let cand = lo; cand <= hi; cand++) {
        const corr = crossCorrelate(ref, cand, refOut, curOut, OL);
        if (corr > bestCorr) {
          bestCorr = corr;
          best = cand;
        }
      }
      offsets.push(best);
      // Write this frame's overlap+tail into refOut so the next search has a
      // complete target.
      const fade = OL;
      for (let i = 0; i < fade; i++) {
        if (curOut + i < outLen) {
          const prev = refOut[curOut + i] ?? 0;
          const next = ref[best + i] ?? 0;
          const f = i / fade;
          refOut[curOut + i] = prev * (1 - f) + next * f;
        }
      }
      for (let i = OL; i < N; i++) {
        if (curOut + i < outLen) refOut[curOut + i] = ref[best + i] ?? 0;
      }
      anaPos = best + Sa;
      curOut += Ss;
    }
  }

  // Apply the same offset sequence to every real channel.
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < nCh; ch++) {
    const input = buffer.getChannelData(ch)!;
    const out = new Float32Array(outLen);
    const fn = Math.min(N, outLen);
    for (let i = 0; i < fn; i++) out[i] = input[i] ?? 0;
    let curOut = Ss;
    for (let k = 1; k < offsets.length; k++) {
      const best = offsets[k]!;
      for (let i = 0; i < OL; i++) {
        const oi = curOut + i;
        if (oi >= outLen) break;
        const prev = out[oi] ?? 0;
        const next = input[best + i] ?? 0;
        const f = i / OL;
        out[oi] = prev * (1 - f) + next * f;
      }
      for (let i = OL; i < N; i++) {
        const oi = curOut + i;
        if (oi >= outLen) break;
        out[oi] = input[best + i] ?? 0;
      }
      curOut += Ss;
      if (curOut >= outLen) break;
    }
    channels.push(out);
  }

  return makeBuffer(nCh, outLen, sr, channels);
}
