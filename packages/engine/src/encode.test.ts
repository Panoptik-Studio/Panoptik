import { describe, expect, it, vi } from "vitest";

// mediabunny pulls in WebCodecs at import time; the sizing math under test is pure.
vi.mock("mediabunny", () => ({
  BufferTarget: class {},
  CanvasSource: class {},
  AudioBufferSource: class {},
  Mp4OutputFormat: class {},
  WebMOutputFormat: class {},
  Output: class {},
  QUALITY_VERY_HIGH: "very-high",
  getFirstEncodableVideoCodec: vi.fn(),
  getFirstEncodableAudioCodec: vi.fn(),
}));

const { __test } = await import("./encode");

describe("export sizing", () => {
  const clip = (width: number, height: number) =>
    ({ clip: { src: "", duration: 10, width, height } }) as never;

  it("scales to the requested height, keeping the clip's aspect", () => {
    expect(__test.exportSize(clip(1920, 1080), "720p")).toEqual({ width: 1280, height: 720 });
    expect(__test.exportSize(clip(1920, 1080), "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(__test.exportSize(clip(1920, 1080), "4k")).toEqual({ width: 3840, height: 2160 });
  });

  it("keeps vertical clips vertical", () => {
    expect(__test.exportSize(clip(1080, 1920), "1080p")).toEqual({ width: 608, height: 1080 });
  });

  it("always yields even dimensions — encoders reject odd ones", () => {
    for (const [w, h] of [[1000, 563], [1333, 999], [777, 555]] as const) {
      for (const res of ["720p", "1080p", "4k"] as const) {
        const size = __test.exportSize(clip(w, h), res);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
      }
    }
  });

  it("upscales a small source rather than refusing it", () => {
    expect(__test.exportSize(clip(640, 360), "1080p")).toEqual({ width: 1920, height: 1080 });
  });
});
