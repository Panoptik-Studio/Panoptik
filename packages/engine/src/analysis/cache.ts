/**
 * Fast 128KB sampled hash & OPFS feature cache for Panoptik.
 * Uses 64-bit FNV-1a hashing on file metadata + first 64KB + last 64KB
 * to guarantee zero memory spikes on 500MB+ video files.
 */

import type { SceneFeature } from "./videoFeatures";
import type { AudioAnalysisResult } from "./audioFeatures";
import type { PackedPhrase } from "./transcriptPacking";
import type { SceneInteractionSummary } from "./interactionFeatures";
import type { DiarizedWord } from "./audioPayload";

export interface FullMediaAnalysis {
  mediaId: string;
  sampledHash: string;
  duration: number;
  scenes: SceneFeature[];
  audio: AudioAnalysisResult;
  words: DiarizedWord[];
  phrases: PackedPhrase[];
  interactions: SceneInteractionSummary[];
  createdAt: number;
}

/**
 * 64-bit FNV-1a hash implementation over Uint8Array chunks and numeric metadata.
 */
export function fnv1a64(chunks: (Uint8Array | string | number)[]): string {
  let hashLow = 0x811c9dc5;
  let hashHigh = 0x84222325;

  const fnvPrime = 0x01000193;

  for (const chunk of chunks) {
    if (typeof chunk === "number" || typeof chunk === "string") {
      const str = String(chunk);
      for (let i = 0; i < str.length; i++) {
        const byte = str.charCodeAt(i) & 0xff;
        hashLow ^= byte;
        hashLow = Math.imul(hashLow, fnvPrime);
        hashHigh ^= (hashLow >>> 16);
        hashHigh = Math.imul(hashHigh, fnvPrime);
      }
    } else if (chunk instanceof Uint8Array) {
      for (let i = 0; i < chunk.length; i++) {
        hashLow ^= chunk[i] ?? 0;
        hashLow = Math.imul(hashLow, fnvPrime);
        hashHigh ^= (hashLow >>> 16);
        hashHigh = Math.imul(hashHigh, fnvPrime);
      }
    }
  }

  const hHighStr = (hashHigh >>> 0).toString(16).padStart(8, "0");
  const hLowStr = (hashLow >>> 0).toString(16).padStart(8, "0");
  return `${hHighStr}${hLowStr}`;
}

/**
 * Computes a fast sampled hash for a video Blob without reading the full file into memory.
 * Reads first 64KB and last 64KB only.
 */
export async function computeSampledHash(
  blob: Blob,
  duration = 0,
): Promise<string> {
  const size = blob.size;
  const sampleSize = 64 * 1024; // 64 KB

  let firstChunk = new Uint8Array(0);
  let lastChunk = new Uint8Array(0);

  if (size <= sampleSize * 2) {
    const buf = await blob.arrayBuffer();
    firstChunk = new Uint8Array(buf);
  } else {
    const firstSlice = blob.slice(0, sampleSize);
    const lastSlice = blob.slice(size - sampleSize, size);

    const [firstBuf, lastBuf] = await Promise.all([
      firstSlice.arrayBuffer(),
      lastSlice.arrayBuffer(),
    ]);

    firstChunk = new Uint8Array(firstBuf);
    lastChunk = new Uint8Array(lastBuf);
  }

  return fnv1a64([size, duration, firstChunk, lastChunk]);
}

/**
 * Saves a FullMediaAnalysis tree to OPFS under `/projects/<projectId>/analysis/<sampledHash>.json`.
 */
export async function saveCachedAnalysis(
  projectId: string,
  analysis: FullMediaAnalysis,
): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !("storage" in navigator) ||
    !navigator.storage.getDirectory
  ) {
    return;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const projDir = await root.getDirectoryHandle(projectId, { create: true });
    const analysisDir = await projDir.getDirectoryHandle("analysis", {
      create: true,
    });

    const fileHandle = await analysisDir.getFileHandle(
      `${analysis.sampledHash}.json`,
      { create: true },
    );
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(analysis));
    await writable.close();
  } catch (err) {
    console.warn("[Panoptik Cache] Failed to persist analysis in OPFS:", err);
  }
}

/**
 * Retrieves cached FullMediaAnalysis from OPFS if available.
 */
export async function getCachedAnalysis(
  projectId: string,
  sampledHash: string,
): Promise<FullMediaAnalysis | null> {
  if (
    typeof navigator === "undefined" ||
    !("storage" in navigator) ||
    !navigator.storage.getDirectory
  ) {
    return null;
  }

  try {
    const root = await navigator.storage.getDirectory();
    const projDir = await root.getDirectoryHandle(projectId, { create: false });
    const analysisDir = await projDir.getDirectoryHandle("analysis", {
      create: false,
    });
    const fileHandle = await analysisDir.getFileHandle(
      `${sampledHash}.json`,
      { create: false },
    );

    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text) as FullMediaAnalysis;
  } catch {
    return null;
  }
}
