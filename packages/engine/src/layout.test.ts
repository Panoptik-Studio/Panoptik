import { describe, expect, it } from "vitest";
import { frameRect } from "./layout";

describe("frameRect", () => {
  it("16:9 clip in 16:9 canvas fills it", () => {
    const r = frameRect(1920, 1080, 1920, 1080, "16:9");
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
  });

  it("4:3 clip in 16:9 canvas is letterboxed vertically", () => {
    const r = frameRect(1920, 1080, 1440, 1080, "16:9");
    // target = 16/9, boxW = min(1920, 1080*16/9) = 1920, boxH = 1920/(16/9) = 1080
    // s = min(1920/1440, 1080/1080) = 1, w = 1440, h = 1080
    expect(r.w).toBe(1440);
    expect(r.h).toBe(1080);
    expect(r.x).toBeCloseTo((1920 - 1440) / 2);
    expect(r.y).toBe(0);
  });

  it("16:9 clip in 9:16 canvas is pillarboxed", () => {
    const r = frameRect(1080, 1920, 1920, 1080, "9:16");
    // target = 9/16, boxW = min(1080, 1920*9/16) = 1080, boxH = 1080/(9/16) = 1920
    // s = min(1080/1920, 1920/1080) = 0.5625, w = 1080, h = 607.5
    expect(r.w).toBeCloseTo(1080);
    expect(r.h).toBeCloseTo(607.5);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo((1920 - 607.5) / 2);
  });

  it("1:1 clip in 16:9 canvas is centered square", () => {
    const r = frameRect(1920, 1080, 1080, 1080, "1:1");
    // target = 1, boxW = min(1920, 1080) = 1080, boxH = 1080
    // s = min(1080/1080, 1080/1080) = 1
    expect(r.w).toBe(1080);
    expect(r.h).toBe(1080);
    expect(r.x).toBeCloseTo((1920 - 1080) / 2);
    expect(r.y).toBe(0);
  });

  it("unknown preset falls back to canvas aspect", () => {
    const r = frameRect(1920, 1080, 1920, 1080, "unknown");
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
  });
});
