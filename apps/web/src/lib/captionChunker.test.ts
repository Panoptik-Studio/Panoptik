import { describe, expect, it } from "vitest";
import { postProcessCaptions } from "./captionChunker";

describe("postProcessCaptions", () => {
  it("filters out captions with negative duration", () => {
    const input = [
      { text: "hello", start: 1, end: 2 },
      { text: "bad", start: 3, end: 2 }, // negative
      { text: "world", start: 4, end: 5 },
    ];
    const result = postProcessCaptions(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("hello");
    expect(result[1]!.text).toBe("world");
  });

  it("filters out captions with zero duration", () => {
    const input = [
      { text: "ok", start: 1, end: 1 }, // zero
    ];
    expect(postProcessCaptions(input)).toHaveLength(0);
  });

  it("merges short adjacent words into ≤42-char chunks", () => {
    const input = [
      { text: "this", start: 0, end: 0.3 },
      { text: "is", start: 0.35, end: 0.5 },
      { text: "a", start: 0.55, end: 0.65 },
      { text: "test", start: 0.7, end: 1.0 },
    ];
    const result = postProcessCaptions(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("this is a test");
    expect(result[0]!.start).toBe(0);
    expect(result[0]!.end).toBe(1.0);
  });

  it("splits at large gaps (>0.3s)", () => {
    const input = [
      { text: "hello", start: 0, end: 0.3 },
      { text: "world", start: 1.0, end: 1.3 }, // gap = 0.7s
    ];
    const result = postProcessCaptions(input);
    expect(result).toHaveLength(2);
  });

  it("splits when merged text exceeds 42 chars", () => {
    const longWord = "a".repeat(25);
    const input = [
      { text: longWord, start: 0, end: 0.5 },
      { text: longWord, start: 0.55, end: 1.0 }, // merged = 51 chars
    ];
    const result = postProcessCaptions(input);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    expect(postProcessCaptions([])).toEqual([]);
  });

  it("handles single caption", () => {
    const result = postProcessCaptions([
      { text: "solo", start: 0, end: 1 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("solo");
  });
});
