import { describe, expect, it } from "vitest";
import { segmentDuration, projectDuration, resolveSegment, sourceToTimeline } from "./timeline";
import type { Project, Segment } from "@panoptik/schema";

function seg(id: string, start: number, end: number, speed: number): Segment {
  return {
    id, srcStart: start, srcEnd: end, speed, stagePadding: 0,
    aspectPreset: "source", background: { kind: "solid", color: "#000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
  };
}
const proj = (segs: Segment[]): Project =>
  ({ id: "p", media: { src: "x", duration: 10, width: 800, height: 600 }, segments: segs, clickLog: [] }) as Project;

describe("time mapping", () => {
  it("segmentDuration divides source range by speed", () => {
    expect(segmentDuration(seg("a", 0, 10, 2))).toBe(5);
    expect(segmentDuration(seg("b", 5, 7, 1))).toBe(2);
  });

  it("projectDuration sums segment durations", () => {
    expect(projectDuration(proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]))).toBe(15);
  });

  it("resolveSegment maps timeline time to segment + source time", () => {
    // seg a: 0..10 src @2x -> 5s on timeline; seg b: 10..20 src @1x -> 10s
    const p = proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]);
    expect(resolveSegment(p, 0)).toEqual({ segment: p.segments[0], srcT: 0 });
    expect(resolveSegment(p, 5)).toEqual({ segment: p.segments[0], srcT: 10 });
    expect(resolveSegment(p, 6)).toEqual({ segment: p.segments[1], srcT: 11 });
    expect(resolveSegment(p, 15)).toEqual({ segment: p.segments[1], srcT: 20 });
    expect(resolveSegment(p, 99)).toBeNull();
  });

  it("sourceToTimeline inverts mapping", () => {
    const p = proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]);
    expect(sourceToTimeline(p, "a", 4)).toBeCloseTo(2);
    expect(sourceToTimeline(p, "a", 10)).toBe(5);
    expect(sourceToTimeline(p, "b", 11)).toBe(6);
    expect(sourceToTimeline(p, "a", 50)).toBeNull(); // outside
  });
});
