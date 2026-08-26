import { describe, expect, it } from "vitest";
import { hitTestFocal, normalizeClick } from "./zoomGeometry";
import type { ZoomPoint } from "@panoptik/schema";

const makeZP = (x: number, y: number): ZoomPoint => ({
  id: "test",
  t: 0,
  to: { scale: 1, x, y },
  dur: 0.5,
  ease: "linear",
  staged: false,
});

describe("hitTestFocal", () => {
  it("returns true when pixel is within 24px grab radius", () => {
    // focal at (0.5, 0.5), frameW=1000px → focal pixel at (500, 500)
    // click at (505, 500) → distance = 5px/1000 = 0.005 → 0.005 * 1000 = 5 < 24
    expect(hitTestFocal(0.505, 0.5, makeZP(0.5, 0.5), 1000)).toBe(true);
  });

  it("returns false when pixel is outside grab radius", () => {
    // focal at (0.5, 0.5), click at (0.6, 0.5) → distance = 100px > 24
    expect(hitTestFocal(0.6, 0.5, makeZP(0.5, 0.5), 1000)).toBe(false);
  });

  it("returns false exactly at boundary", () => {
    // focal at (0.5, 0.5), frameW=1000 → 24px = 0.024 normalized
    // click at 0.524 → distance = 0.024 * 1000 = 24, not < 24
    expect(hitTestFocal(0.524, 0.5, makeZP(0.5, 0.5), 1000)).toBe(false);
  });

  it("returns true just inside boundary", () => {
    // click at 0.5239 → distance = 23.9 < 24
    expect(hitTestFocal(0.5239, 0.5, makeZP(0.5, 0.5), 1000)).toBe(true);
  });
});

describe("normalizeClick", () => {
  // Plain object matching DOMRect shape (DOMRect unavailable in node test env)
  const rect = { left: 100, top: 50, width: 800, height: 600 };
  const frame = { x: 50, y: 30, w: 700, h: 540 };

  it("normalizes a click inside the frame", () => {
    // clientX=400, clientY=320 → frame-relative: (400-100-50)/700=0.357, (320-50-30)/540=0.444
    const result = normalizeClick(400, 320, rect, frame);
    expect(result.x).toBeCloseTo(0.357, 2);
    expect(result.y).toBeCloseTo(0.444, 2);
  });

  it("clamps to 0 when clicking above/left of frame", () => {
    const result = normalizeClick(50, 20, rect, frame);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("clamps to 1 when clicking below/right of frame", () => {
    const result = normalizeClick(900, 700, rect, frame);
    expect(result.x).toBe(1);
    expect(result.y).toBe(1);
  });

  it("handles click exactly at frame origin", () => {
    const result = normalizeClick(150, 80, rect, frame);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it("handles click at frame bottom-right corner", () => {
    // Frame right edge = rect.left + frame.x + frame.w = 100+50+700 = 850
    // Frame bottom edge = rect.top + frame.y + frame.h = 50+30+540 = 620
    const result = normalizeClick(850, 620, rect, frame);
    expect(result.x).toBeCloseTo(1, 4);
    expect(result.y).toBeCloseTo(1, 4);
  });
});
