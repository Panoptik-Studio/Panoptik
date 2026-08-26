import { describe, expect, it } from "vitest";
import { getCameraTransform, IDENTITY } from "./render";
import type { ZoomPoint } from "@panoptik/schema";

const zp = (overrides: Partial<ZoomPoint>): ZoomPoint => ({
  id: "z1",
  t: 0,
  to: { scale: 2, x: 0.5, y: 0.5 },
  dur: 1,
  ease: "linear",
  staged: false,
  ...overrides,
});

describe("getCameraTransform", () => {
  it("identity before first keyframe", () => {
    expect(getCameraTransform([zp({ t: 2 })], 0)).toEqual(IDENTITY);
  });

  it("reaches target after dur", () => {
    const z = zp({ t: 1, to: { scale: 3, x: 0.25, y: 0.75 }, dur: 1, ease: "linear" });
    expect(getCameraTransform([z], 2)).toEqual({ scale: 3, x: 0.25, y: 0.75 });
  });

  it("mid-flight halfway with linear ease", () => {
    const z = zp({ t: 0, to: { scale: 3, x: 0.5, y: 0.5 }, dur: 2, ease: "linear" });
    expect(getCameraTransform([z], 1)).toEqual({ scale: 2, x: 0.5, y: 0.5 });
  });

  it("staged points are ignored", () => {
    const z = zp({ t: 0, staged: true });
    expect(getCameraTransform([z], 5)).toEqual(IDENTITY);
  });

  it("sequential fold: two keyframes compose", () => {
    const z1 = zp({ id: "z1", t: 0, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 1, ease: "linear" });
    const z2 = zp({ id: "z2", t: 1, to: { scale: 4, x: 0.5, y: 0.5 }, dur: 1, ease: "linear" });
    // At t=1, z1 has completed: state = {2, 0.5, 0.5}, z2 starts but dur=0 elapsed → still {2, 0.5, 0.5}
    expect(getCameraTransform([z1, z2], 1)).toEqual({ scale: 2, x: 0.5, y: 0.5 });
    // At t=2, z2 has completed: 4
    expect(getCameraTransform([z1, z2], 2)).toEqual({ scale: 4, x: 0.5, y: 0.5 });
  });
});
