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
 *
 * Plus the per-segment windowing helpers export uses: slice a source
 * AudioBuffer into its segment's [srcStart, srcEnd) range, time-stretch that
 * slice by the segment's speed, and concatenate the stretched parts so the
 * final exported audio matches the timeline length.
 */
import type { Segment } from "@panoptik/schema";

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
  if (Math.abs(rate - 1) < 0.001) return buffer;
  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const inLen = buffer.length;
  const outLen = Math.max(1, Math.round(inLen / rate));

  // Frame geometry: 40ms frames with 4x overlap give clean cross-fades while
  // keeping the best-match search cheap.
  const N = Math.max(256, Math.round(sr * 0.04)); // analysis frame
  const Ss = Math.max(64, Math.round(N / 4)); // synthesis hop (output)
  const Sa = Math.max(1, Ss * rate); // analysis hop (input; fractional so the
  // absolute analysis grid below cannot accumulate rounding error)
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
    let frame = 1;
    // The analysis position is an ABSOLUTE grid (frame * Sa), never
    // `best + Sa`. Deriving it from the previous match compounds the search
    // offset, and that offset is systematically negative: the previous frame
    // wrote ref[best .. best+N] into the output, so the candidate correlating
    // *perfectly* with the target is always the trivial continuation
    // `best + Ss`, i.e. anaPos - (Sa - Ss). Feeding that back made every frame
    // advance by Ss instead of Sa — the stretch silently played at 1x and ran
    // out of source early, no matter what `rate` said.
    let anaPos = Math.round(frame * Sa);
    while (curOut < outLen && anaPos < inLen) {
      const lo = Math.max(0, anaPos - R);
      const hi = Math.min(inLen - N, anaPos + R);
      // Pick the offset with the best correlation, penalised by distance from
      // anaPos (exact rate advance). Three jobs in one: exact ties in silence
      // resolve to anaPos instead of drifting; near-tie noise jitters stay
      // near exact rate instead of random-walking timing away over long
      // stretches (audible lip-sync wander that resets every segment, since
      // each segment is stretched independently); genuine transient/phase
      // matches still win because their correlation lead dwarfs the penalty.
      const LAMBDA = 0.2;
      let best = anaPos;
      let bestScore = crossCorrelate(ref, anaPos, refOut, curOut, OL);
      for (let cand = lo; cand <= hi; cand++) {
        if (cand === anaPos) continue;
        const corr = crossCorrelate(ref, cand, refOut, curOut, OL);
        const score = corr - (LAMBDA * Math.abs(cand - anaPos)) / R;
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
      // anaPos can run past the readable window near end-of-input; clamp back
      // so the tail repeats the last frame instead of writing zeros early.
      if (hi >= lo) best = Math.max(lo, Math.min(hi, best));
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
      frame++;
      anaPos = Math.round(frame * Sa);
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

/** Build a silent mono AudioBuffer of `length` frames at 48kHz — test helper. */
export function makeMock(length: number, sampleRate = 48000, numberOfChannels = 1): AudioBuffer {
  const channels: Float32Array[] = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(length),
  );
  return makeBuffer(numberOfChannels, length, sampleRate, channels);
}

/**
 * Slice the source window [srcStart*sr, srcEnd*sr) out of `buffer`.
 * Degenerate and out-of-range windows come back as one silent sample so
 * downstream timeStretch never has to divide a zero-length input.
 */
export function sliceSegment(
  buffer: AudioBuffer,
  srcStart: number,
  srcEnd: number,
): AudioBuffer {
  const sr = buffer.sampleRate;
  const from = Math.max(0, Math.round(srcStart * sr));
  const to = Math.min(buffer.length, Math.round(srcEnd * sr));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    const silent = new Float32Array(1);
    return makeBuffer(buffer.numberOfChannels, 1, sr, Array.from({ length: buffer.numberOfChannels }, () => silent));
  }
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch)!.slice(from, to));
  }
  return makeBuffer(buffer.numberOfChannels, to - from, sr, channels);
}

/** Slice a segment's source range out of the clip's audio, then stretch it by `seg.speed`. */
export function sliceAndStretchAudio(buffer: AudioBuffer, seg: Segment): AudioBuffer {
  return timeStretch(sliceSegment(buffer, seg.srcStart, seg.srcEnd), seg.speed);
}

/**
 * Slice and pad screen audio for a segment, prepending pre-video silence when the
 * screen capture video track was delayed relative to container audio start.
 */
export function sliceAndPadScreenAudio(
  buffer: AudioBuffer,
  seg: Segment,
  firstVideoTs = 0,
): AudioBuffer {
  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const segStart = seg.srcStart;
  const segEnd = seg.srcEnd;
  const segDur = Math.max(0, segEnd - segStart);

  if (firstVideoTs <= 0.005) {
    return sliceAndStretchAudio(buffer, seg);
  }

  // Prepend firstVideoTs silence so audio delays to match the video start
  const preDur = Math.max(0, Math.min(segDur, firstVideoTs - segStart));
  const takeSrcStart = Math.max(0, segStart - firstVideoTs);
  const takeSrcEnd = Math.max(0, Math.min(buffer.duration, segEnd - firstVideoTs));
  const takeDur = Math.max(0, takeSrcEnd - takeSrcStart);
  const postDur = Math.max(0, segDur - (preDur + takeDur));

  const parts: AudioBuffer[] = [];
  if (preDur > 0.001) {
    const preLen = Math.max(1, Math.round(preDur * sr));
    parts.push(makeBuffer(nCh, preLen, sr, Array.from({ length: nCh }, () => new Float32Array(preLen))));
  }
  if (takeDur > 0.001) {
    parts.push(sliceSegment(buffer, takeSrcStart, takeSrcEnd));
  }
  if (postDur > 0.001) {
    const postLen = Math.max(1, Math.round(postDur * sr));
    parts.push(makeBuffer(nCh, postLen, sr, Array.from({ length: nCh }, () => new Float32Array(postLen))));
  }

  const assembled = concatAudio(parts);
  if (Math.abs(seg.speed - 1) < 0.001) {
    return assembled;
  }
  return timeStretch(assembled, seg.speed);
}

/**
 * Slice and pad facecam audio for a segment, correctly positioning takes with fcStartT > 0.
 */
export function sliceAndPadFacecamAudio(fcBuf: AudioBuffer, seg: Segment): AudioBuffer {
  const sr = fcBuf.sampleRate;
  const nCh = fcBuf.numberOfChannels;
  const fcStartT = seg.facecam?.startT ?? 0;
  const segStart = seg.srcStart;
  const segEnd = seg.srcEnd;
  const segDur = Math.max(0, segEnd - segStart);
  const fcDur = fcBuf.duration;

  if (fcStartT <= 0) {
    return sliceAndStretchAudio(fcBuf, seg);
  }

  // Pre-take silence before the take started
  const preDur = Math.max(0, Math.min(segDur, fcStartT - segStart));
  const takeSrcStart = Math.max(0, segStart - fcStartT);
  const takeSrcEnd = Math.max(0, Math.min(fcDur, segEnd - fcStartT));
  const takeDur = Math.max(0, takeSrcEnd - takeSrcStart);
  const postDur = Math.max(0, segDur - (preDur + takeDur));

  const parts: AudioBuffer[] = [];
  if (preDur > 0.001) {
    const preLen = Math.max(1, Math.round(preDur * sr));
    parts.push(makeBuffer(nCh, preLen, sr, Array.from({ length: nCh }, () => new Float32Array(preLen))));
  }
  if (takeDur > 0.001) {
    parts.push(sliceSegment(fcBuf, takeSrcStart, takeSrcEnd));
  }
  if (postDur > 0.001) {
    const postLen = Math.max(1, Math.round(postDur * sr));
    parts.push(makeBuffer(nCh, postLen, sr, Array.from({ length: nCh }, () => new Float32Array(postLen))));
  }

  const assembled = concatAudio(parts);
  if (Math.abs(seg.speed - 1) < 0.001) {
    return assembled;
  }
  return timeStretch(assembled, seg.speed);
}

/** Concatenate audio parts end-to-end at the first part's sample rate. */
export function concatAudio(parts: AudioBuffer[]): AudioBuffer {
  if (parts.length === 0) return makeMock(1);
  if (parts.length === 1) return parts[0]!;
  const sampleRate = parts[0]!.sampleRate;
  const numberOfChannels = Math.max(...parts.map((p) => p.numberOfChannels));
  const totalLength = parts.reduce((acc, p) => acc + p.length, 0);
  const channels: Float32Array[] = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(totalLength),
  );
  let offset = 0;
  for (const part of parts) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src =
        part.numberOfChannels === 1
          ? part.getChannelData(0)
          : ch < part.numberOfChannels
          ? part.getChannelData(ch)
          : null;
      if (src) channels[ch]!.set(src, offset);
    }
    offset += part.length;
  }
  return makeBuffer(numberOfChannels, totalLength, sampleRate, channels);
}

/** Total duration of the concatenation of `parts` — handy for tests. */
export function concatDurations(parts: AudioBuffer[]): number {
  return concatAudio(parts).duration;
}

/** Scale channel samples by volume multiplier (with soft-knee limiting for boost > 1.0). */
export function applyVolume(buffer: AudioBuffer, volume: number): AudioBuffer {
  if (volume === 1) return buffer;
  const nCh = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < nCh; ch++) {
    const src = buffer.getChannelData(ch)!;
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let sample = (src[i] ?? 0) * volume;
      if (sample === 0) sample = 0;
      // Soft-knee limiting if sample exceeds [-1, 1]
      else if (sample > 1.0) sample = 1.0 - Math.exp(-(sample - 1.0)) * 0.2;
      else if (sample < -1.0) sample = -1.0 + Math.exp(sample + 1.0) * 0.2;
      dst[i] = sample;
    }
    channels.push(dst);
  }
  return makeBuffer(nCh, len, sr, channels);
}

/** Mix two AudioBuffers of the same target length together with per-stream volume weighting. */
export function mixAudio(
  bufA: AudioBuffer | null,
  volA: number,
  bufB: AudioBuffer | null,
  volB: number,
): AudioBuffer {
  if (!bufA && !bufB) return makeMock(1);
  if (!bufA) return applyVolume(bufB!, volB);
  if (!bufB) return applyVolume(bufA, volA);

  const sampleRate = bufA.sampleRate;
  const nCh = Math.max(bufA.numberOfChannels, bufB.numberOfChannels);
  const len = Math.max(bufA.length, bufB.length);
  const channels: Float32Array[] = [];

  for (let ch = 0; ch < nCh; ch++) {
    const dst = new Float32Array(len);
    // When a source buffer is mono (e.g. microphone), replicate channel 0 to both L and R channels
    const dataA =
      bufA.numberOfChannels === 1
        ? bufA.getChannelData(0)
        : ch < bufA.numberOfChannels
        ? bufA.getChannelData(ch)
        : null;
    const dataB =
      bufB.numberOfChannels === 1
        ? bufB.getChannelData(0)
        : ch < bufB.numberOfChannels
        ? bufB.getChannelData(ch)
        : null;
    for (let i = 0; i < len; i++) {
      const sA = (dataA && i < dataA.length ? dataA[i]! : 0) * volA;
      const sB = (dataB && i < dataB.length ? dataB[i]! : 0) * volB;
      let mixed = sA + sB;
      if (mixed === 0) mixed = 0;
      else if (mixed > 1.0) mixed = 1.0 - Math.exp(-(mixed - 1.0)) * 0.2;
      else if (mixed < -1.0) mixed = -1.0 + Math.exp(mixed + 1.0) * 0.2;
      dst[i] = mixed;
    }
    channels.push(dst);
  }
  return makeBuffer(nCh, len, sampleRate, channels);
}
