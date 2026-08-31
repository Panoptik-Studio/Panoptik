import { describe, expect, it } from "vitest";
import {
  chunkAudioSamples,
  encodeWavBlob,
  mergeOverlappedChunkWords,
  resampleMonoPcm,
} from "./audioPayload";

describe("audioPayload", () => {
  it("resamples mono PCM from 48kHz to 16kHz", () => {
    const inRate = 48000;
    const outRate = 16000;
    const input = new Float32Array(48000); // 1 second
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / inRate);
    }

    const output = resampleMonoPcm(input, inRate, outRate);
    expect(output.length).toBe(16000);
    // Peak amplitude preserved
    let max = 0;
    for (let i = 0; i < output.length; i++) {
      max = Math.max(max, Math.abs(output[i] ?? 0));
    }
    expect(max).toBeCloseTo(1.0, 1);
  });

  it("encodes 16kHz mono samples into valid WAV blob", async () => {
    const samples = new Float32Array(16000); // 1s
    const blob = encodeWavBlob(samples, 16000);
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + 16000 * 2); // 44 byte header + 16-bit PCM
  });

  it("chunks audio with 2.0s unmixed overlap region", () => {
    const sampleRate = 1000; // Mock sample rate
    const totalSec = 2000; // 2000 seconds
    const samples = new Float32Array(totalSec * sampleRate);

    const chunkDuration = 900; // 15 min = 900s
    const overlap = 2.0; // 2.0s
    const chunks = chunkAudioSamples(samples, sampleRate, chunkDuration, overlap);

    expect(chunks.length).toBe(3);
    expect(chunks[0]!.chunkIndex).toBe(0);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[0]!.endSec).toBe(900);

    expect(chunks[1]!.chunkIndex).toBe(1);
    expect(chunks[1]!.startSec).toBe(898); // 900 - 2s overlap
    expect(chunks[1]!.endSec).toBe(1798);

    expect(chunks[2]!.chunkIndex).toBe(2);
    expect(chunks[2]!.startSec).toBe(1796);
  });

  it("merges overlapped chunk words with timestamp rebasing and boundary deduplication", () => {
    const chunk0 = {
      chunkIndex: 0,
      startOffsetSec: 0,
      chunkDurationSec: 900,
      words: [
        { word: "Welcome", start: 1.0, end: 1.5, speaker: 0 },
        { word: "to", start: 1.5, end: 1.7, speaker: 0 },
        { word: "Panoptik", start: 1.7, end: 2.2, speaker: 0 },
        // Word right at tail boundary of chunk 0
        { word: "And", start: 898.5, end: 898.9, speaker: 0 },
        { word: "now", start: 899.0, end: 899.4, speaker: 0 },
      ],
    };

    const chunk1 = {
      chunkIndex: 1,
      startOffsetSec: 898, // starts at 898.0s
      chunkDurationSec: 900,
      words: [
        // Duplicate instance of "now" in head overlap of chunk 1
        { word: "now", start: 1.0, end: 1.4, speaker: 0 }, // local 1.0 -> global 899.0s
        { word: "we", start: 1.5, end: 1.8, speaker: 0 }, // global 899.5s
        { word: "export", start: 1.8, end: 2.3, speaker: 0 }, // global 899.8s
      ],
    };

    const merged = mergeOverlappedChunkWords([chunk0, chunk1], 2.0);

    expect(merged.length).toBe(7);
    expect(merged.map((w) => w.word)).toEqual([
      "Welcome",
      "to",
      "Panoptik",
      "And",
      "now",
      "we",
      "export",
    ]);

    expect(merged[3]!.word).toBe("And");
    expect(merged[3]!.start).toBe(898.5);

    expect(merged[4]!.word).toBe("now");
    expect(merged[4]!.start).toBe(899.0);

    expect(merged[5]!.word).toBe("we");
    expect(merged[5]!.start).toBe(899.5);

    expect(merged[6]!.word).toBe("export");
    expect(merged[6]!.start).toBe(899.8);
  });

  it("fuzzy-merges boundary-straddling partial words (e.g. expor + t -> export)", () => {
    const chunk0 = {
      chunkIndex: 0,
      startOffsetSec: 0,
      chunkDurationSec: 100,
      words: [
        { word: "expor", start: 99.0, end: 99.4, speaker: 0 },
      ],
    };

    const chunk1 = {
      chunkIndex: 1,
      startOffsetSec: 98,
      chunkDurationSec: 100,
      words: [
        { word: "t", start: 1.45, end: 1.6, speaker: 0 }, // global 99.45s
        { word: "file", start: 1.7, end: 2.0, speaker: 0 },
      ],
    };

    const merged = mergeOverlappedChunkWords([chunk0, chunk1], 2.0);
    expect(merged[0]!.word).toBe("export");
    expect(merged[0]!.start).toBe(99.0);
    expect(merged[1]!.word).toBe("file");
  });
});

