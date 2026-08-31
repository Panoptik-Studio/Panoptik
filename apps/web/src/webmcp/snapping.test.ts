import { describe, expect, it } from "vitest";
import type { FullMediaAnalysis } from "@panoptik/engine";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";

describe("snapping & cut-map rebasing engine", () => {
  it("resolves silence cuts and rebases subsequent zoom timestamps accurately", () => {
    const mockAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash123",
      duration: 60.0,
      scenes: [
        { id: 0, t0: 0, t1: 30, motionCategory: "static", paletteIndex: 0, camCorner: "tl", keyframeTime: 15 },
        { id: 1, t0: 30, t1: 60, motionCategory: "high", paletteIndex: 3, camCorner: "bl", keyframeTime: 45 },
      ],
      audio: {
        duration: 60.0,
        silences: [
          // 2.0s silence at [10.0s, 12.0s]
          { start: 10.0, end: 12.0, duration: 2.0 },
        ],
        minorPauses: [],
        loudPeaks: [],
        speechRatio: 0.9,
      },
      words: [],
      phrases: [],
      interactions: [
        { sceneId: 1, clicks: 3, centroid: { x: 0.75, y: 0.35 }, boundingBox: null, bursts: [] },
      ],
      createdAt: Date.now(),
    };

    const ops: EditOp[] = [
      // Cut at t=11.0s dropping silence [10.05s, 11.92s] (dur = ~1.87s)
      { op: "cut", t: 11.0, dropSilence: true, padLeftMs: 50, padRightMs: 80 },
      // Zoom at t0=20.0s, t1=25.0s (after the cut)
      { op: "zoom", t0: 20.0, t1: 25.0 },
    ];

    const result = snapAndRebaseEditOps(ops, mockAnalysis, null);

    expect(result.cutMap).toHaveLength(1);
    const drop = result.cutMap[0]!;
    expect(drop.start).toBeCloseTo(10.05, 2);
    expect(drop.end).toBeCloseTo(11.92, 2);
    const droppedDur = drop.droppedDur;

    // Zoom op should be rebased by subtracting droppedDur
    const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
    expect(zoomOp).toBeDefined();
    expect(zoomOp!.rebasedT0).toBeCloseTo(20.0 - droppedDur, 2);
    expect(zoomOp!.rebasedT1).toBeCloseTo(25.0 - droppedDur, 2);
    // Centroid snapped from scene 1 or default
    expect(zoomOp!.cx).toBeDefined();
    expect(zoomOp!.cy).toBeDefined();
  });

  it("clamps zoom windows partially straddling a dropped silence interval", () => {
    const mockAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash123",
      duration: 60.0,
      scenes: [],
      audio: {
        duration: 60.0,
        silences: [{ start: 30.0, end: 35.0, duration: 5.0 }],
        minorPauses: [],
        loudPeaks: [],
        speechRatio: 0.9,
      },
      words: [],
      phrases: [],
      interactions: [],
      createdAt: Date.now(),
    };

    const ops: EditOp[] = [
      { op: "cut", t: 32.0, dropSilence: true, padLeftMs: 0, padRightMs: 0 },
      // Zoom [25.0s, 32.0s] straddles the cut starting at 30.0s -> should clamp t1 to 30.0s
      { op: "zoom", t0: 25.0, t1: 32.0, cx: 0.5, cy: 0.5 },
    ];

    const result = snapAndRebaseEditOps(ops, mockAnalysis, null);
    const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
    expect(zoomOp).toBeDefined();
    expect(zoomOp!.clamped).toBe(true);
    expect(zoomOp!.rebasedT0).toBe(25.0);
    expect(zoomOp!.rebasedT1).toBe(30.0); // Clamped at drop start
  });

  it("rejects ops falling entirely inside a dropped silence interval", () => {
    const mockAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash123",
      duration: 60.0,
      scenes: [],
      audio: {
        duration: 60.0,
        silences: [{ start: 10.0, end: 15.0, duration: 5.0 }],
        minorPauses: [],
        loudPeaks: [],
        speechRatio: 0.9,
      },
      words: [],
      phrases: [],
      interactions: [],
      createdAt: Date.now(),
    };

    const ops: EditOp[] = [
      { op: "cut", t: 12.0, dropSilence: true, padLeftMs: 0, padRightMs: 0 },
      // Zoom [11.0s, 13.0s] is fully inside [10.0s, 15.0s]
      { op: "zoom", t0: 11.0, t1: 13.0 },
    ];

    const result = snapAndRebaseEditOps(ops, mockAnalysis, null);
    expect(result.rejectedOps.length).toBeGreaterThanOrEqual(1);
    expect(result.rejectedOps[0]!.reason).toContain("falls entirely inside");
  });

  it("rejects speed ops that overlap another effect window (v1 speed constraint)", () => {
    const ops: EditOp[] = [
      { op: "zoom", t0: 10.0, t1: 20.0, cx: 0.5, cy: 0.5 },
      // Speed ramp [15.0s, 25.0s] overlaps zoom [10.0s, 20.0s]
      { op: "speed", t0: 15.0, t1: 25.0, mult: 1.5 },
    ];

    const result = snapAndRebaseEditOps(ops, null, null);
    expect(result.rejectedOps).toHaveLength(1);
    expect(result.rejectedOps[0]!.reason).toContain("v1 speed constraint");
  });
});
