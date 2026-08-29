import { describe, expect, it } from "vitest";
import { frameRect, outputSize } from "./layout";

describe("frameRect", () => {
  const media = (w: number, h: number) => ({ id: "m1", src: "", duration: 10, width: w, height: h });

  it("16:9 media in 16:9 canvas fills it", () => {
    const r = frameRect(1920, 1080, media(1920, 1080), "16:9");
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
  });

  it("4:3 media in 16:9 canvas is letterboxed vertically", () => {
    const r = frameRect(1920, 1080, media(1440, 1080), "16:9");
    // target = 16/9, boxW = min(1920, 1080*16/9) = 1920, boxH = 1920/(16/9) = 1080
    // s = min(1920/1440, 1080/1080) = 1, w = 1440, h = 1080
    expect(r.w).toBe(1440);
    expect(r.h).toBe(1080);
    expect(r.x).toBeCloseTo((1920 - 1440) / 2);
    expect(r.y).toBe(0);
  });

  it("16:9 media in 9:16 canvas is pillarboxed", () => {
    const r = frameRect(1080, 1920, media(1920, 1080), "9:16");
    // target = 9/16, boxW = min(1080, 1920*9/16) = 1080, boxH = 1080/(9/16) = 1920
    // s = min(1080/1920, 1920/1080) = 0.5625, w = 1080, h = 607.5
    expect(r.w).toBeCloseTo(1080);
    expect(r.h).toBeCloseTo(607.5);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo((1920 - 607.5) / 2);
  });

  it("1:1 media in 16:9 canvas is centered square", () => {
    const r = frameRect(1920, 1080, media(1080, 1080), "1:1");
    // target = 1, boxW = min(1920, 1080) = 1080, boxH = 1080
    // s = min(1080/1080, 1080/1080) = 1
    expect(r.w).toBe(1080);
    expect(r.h).toBe(1080);
    expect(r.x).toBeCloseTo((1920 - 1080) / 2);
    expect(r.y).toBe(0);
  });

  it("source falls back to media's own aspect", () => {
    const r = frameRect(1920, 1080, media(1920, 1080), "source");
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
  });
});

describe("outputSize", () => {
  // A 16:10 laptop screen — the case that produced black on all four sides,
  // because the canvas took the clip's shape and was then letterboxed again.
  const SCREEN_W = 1512;
  const SCREEN_H = 982;

  const media = (w: number, h: number) => ({ id: "m1", src: "", duration: 10, width: w, height: h });

  it("source keeps the media's shape, so frameRect fills the frame", () => {
    const { width, height } = outputSize(media(SCREEN_W, SCREEN_H), "source");
    const r = frameRect(width, height, media(SCREEN_W, SCREEN_H), "source");
    expect(r.x).toBeCloseTo(0, 0);
    expect(r.y).toBeCloseTo(0, 0);
    expect(r.w).toBeCloseTo(width, 0);
    expect(r.h).toBeCloseTo(height, 0);
  });

  it("a named preset bars on at most one axis, never all four", () => {
    for (const preset of ["16:9", "9:16", "1:1", "4:3"] as const) {
      const { width, height } = outputSize(media(SCREEN_W, SCREEN_H), preset);
      const r = frameRect(width, height, media(SCREEN_W, SCREEN_H), preset);
      const barX = r.x > 0.5;
      const barY = r.y > 0.5;
      expect(barX && barY).toBe(false);
    }
  });

  it("takes the preset's aspect, not the media's", () => {
    const square = outputSize(media(SCREEN_W, SCREEN_H), "1:1");
    expect(square.width).toBe(square.height);
    const portrait = outputSize(media(SCREEN_W, SCREEN_H), "9:16");
    expect(portrait.height).toBeGreaterThan(portrait.width);
  });

  it("always returns even dimensions and respects the cap", () => {
    for (const preset of ["source", "16:9", "9:16", "1:1", "4:3"] as const) {
      const { width, height } = outputSize(media(1333, 999), preset, 1920);
      expect(width % 2).toBe(0);
      expect(height % 2).toBe(0);
      expect(width).toBeLessThanOrEqual(1920);
    }
  });
});
