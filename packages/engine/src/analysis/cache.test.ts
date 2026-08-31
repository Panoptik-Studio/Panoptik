import { describe, expect, it } from "vitest";
import { computeSampledHash, fnv1a64 } from "./cache";

describe("cache", () => {
  it("computes deterministic 64-bit FNV-1a hash", () => {
    const chunk1 = new Uint8Array([1, 2, 3, 4, 5]);
    const hash1 = fnv1a64([chunk1, 100, "meta"]);
    const hash2 = fnv1a64([chunk1, 100, "meta"]);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16); // 16 hex characters

    const hash3 = fnv1a64([chunk1, 101, "meta"]);
    expect(hash3).not.toBe(hash1);
  });

  it("computes sampled hash on Blobs without reading entire file", async () => {
    // 200KB mock blob
    const data = new Uint8Array(200 * 1024);
    data[0] = 42;
    data[data.length - 1] = 99;
    const blob = new Blob([data], { type: "video/webm" });

    const hashA = await computeSampledHash(blob, 10.5);
    const hashB = await computeSampledHash(blob, 10.5);
    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(16);

    const hashC = await computeSampledHash(blob, 12.0);
    expect(hashC).not.toBe(hashA);
  });
});
