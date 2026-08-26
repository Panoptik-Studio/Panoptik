import { describe, expect, it } from "vitest";
import { lerp, easeInOutCubic, easeOutCubic, EASINGS } from "./easing";

describe("lerp", () => {
  it("midpoint", () => expect(lerp(1, 3, 0.5)).toBe(2));
  it("start", () => expect(lerp(1, 3, 0)).toBe(1));
  it("end", () => expect(lerp(1, 3, 1)).toBe(3));
});

describe("easeInOutCubic", () => {
  it("starts at 0", () => expect(easeInOutCubic(0)).toBe(0));
  it("midpoint is 0.5", () => expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10));
  it("ends at 1", () => expect(easeInOutCubic(1)).toBe(1));
});

describe("easeOutCubic", () => {
  it("starts at 0", () => expect(easeOutCubic(0)).toBe(0));
  it("ends at 1", () => expect(easeOutCubic(1)).toBe(1));
});

describe("EASINGS registry", () => {
  it("has expected keys", () => {
    expect(Object.keys(EASINGS).sort()).toEqual(["easeInOutCubic", "easeOutCubic", "linear"]);
  });
  it("linear is identity", () => expect(EASINGS.linear!(0.73)).toBe(0.73));
});
