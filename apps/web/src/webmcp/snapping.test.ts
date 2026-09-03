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

  it("applies an explicit cut window and rebases downstream ops", () => {
    const ops: EditOp[] = [
      // Exact window as an agent would pass from get_silence_intervals output
      { op: "cut", t: 51.8, t1: 54.8 },
      { op: "zoom", t0: 60.0, t1: 65.0, cx: 0.5, cy: 0.5 },
    ];

    const result = snapAndRebaseEditOps(ops, null, null);
    expect(result.cutMap).toHaveLength(1);
    expect(result.cutMap[0]!.start).toBeCloseTo(51.8, 2);
    expect(result.cutMap[0]!.end).toBeCloseTo(54.8, 2);

    const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
    expect(zoomOp).toBeDefined();
    expect(zoomOp!.rebasedT0).toBeCloseTo(57.0, 2); // 60 - 3.0 dropped
    expect(zoomOp!.rebasedT1).toBeCloseTo(62.0, 2);
  });

  it("rejects a dropSilence cut that matches no silence instead of silently skipping it", () => {
    // No analysis at all — the failure mode that silently ate cuts before.
    const ops: EditOp[] = [{ op: "cut", t: 53.3, dropSilence: true }];

    const result = snapAndRebaseEditOps(ops, null, null);
    expect(result.cutMap).toHaveLength(0);
    expect(result.rejectedOps).toHaveLength(1);
    expect(result.rejectedOps[0]!.reason).toContain("No silence interval found near 53.3s");
    expect(result.rejectedOps[0]!.reason).toContain("{op:'cut', t0, t1}");
  });

  it("counts text overlays and backgrounds in the diff summary", () => {
    const ops: EditOp[] = [
      { op: "text", t: 5, text: "REACTION: AI IS MOVING TO THE CLOUD", pos: "top" },
      { op: "bg", t0: 0, kind: "gradient", c0: "#0f172a", c1: "#1e293b" },
    ];

    const result = snapAndRebaseEditOps(ops, null, null);
    expect(result.diffSummary).toContain("1 text overlay(s)");
    expect(result.diffSummary).toContain("1 background change(s)");
  });

  describe("deterministic zoom grounding", () => {
    const makeProject = (clickLog: Array<{ t: number; x: number; y: number }>) =>
      ({
        id: "p",
        media: [{ id: "m1", src: "blob:x", duration: 100, width: 1920, height: 1080 }],
        clickLog,
        segments: [
          {
            id: "seg-1",
            mediaId: "m1",
            srcStart: 0,
            srcEnd: 100,
            speed: 1,
            stagePadding: 0,
            aspectPreset: "source",
            background: { kind: "solid", color: "#000" },
            facecam: { src: null, x: 0.9, y: 0.9, size: 0.2 },
            zoomPoints: [],
            stagedZoomPoints: [],
            textOverlays: [],
            stagedTextOverlays: [],
          },
        ],
      }) as unknown as Parameters<typeof snapAndRebaseEditOps>[2];

    it("grounds an omitted focal point on the cursor attention centroid (parked corners filtered)", () => {
      const project = makeProject([
        { t: 5, x: 0.02, y: 0.015 }, // parked in the corner — must be ignored
        { t: 10, x: 0.3, y: 0.4 },
        { t: 12, x: 0.32, y: 0.42 },
        { t: 14, x: 0.28, y: 0.38 },
        { t: 30, x: 0.6, y: 0.6 }, // outside the zoom window
      ]);

      const result = snapAndRebaseEditOps([{ op: "zoom", t0: 8, t1: 20, scale: 1.6 }], null, project);
      const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
      expect(zoomOp).toBeDefined();
      expect(zoomOp!.focalSource).toBe("cursor");
      expect(zoomOp!.cx).toBeCloseTo(0.3, 1);
      expect(zoomOp!.cy).toBeCloseTo(0.4, 1);
      expect(zoomOp!.splitPan).toBe(false);
    });

    it("auto-splits a long vertical read into a sequential top→bottom pan", () => {
      // Cursor traverses y 0.2 → 0.8 while reading down the page; at 1.6x the
      // viewport is 0.625 tall, so one static zoom would clip the lines.
      const project = makeProject(
        Array.from({ length: 7 }, (_, i) => ({ t: 10 + i * 5, x: 0.4, y: 0.2 + i * 0.1 })),
      );

      const result = snapAndRebaseEditOps([{ op: "zoom", t0: 10, t1: 40, scale: 1.6 }], null, project);
      const zooms = result.snappedOps.filter((o) => o.op === "zoom");
      expect(zooms).toHaveLength(2);
      expect(zooms[0]!.splitPan).toBe(true);
      expect(zooms[1]!.splitPan).toBe(true);
      expect(zooms[0]!.cy).toBeCloseTo(0.3, 1); // upper lines
      expect(zooms[1]!.cy).toBeCloseTo(0.65, 1); // lower lines
      expect(zooms[1]!.rebasedT0!).toBeGreaterThan(zooms[0]!.rebasedT0!);
    });

    it("keeps an explicit focal point and never splits agent-specified framing", () => {
      const project = makeProject(
        Array.from({ length: 7 }, (_, i) => ({ t: 10 + i * 5, x: 0.4, y: 0.2 + i * 0.1 })),
      );

      const result = snapAndRebaseEditOps(
        [{ op: "zoom", t0: 10, t1: 40, cx: 0.5, cy: 0.5, scale: 1.6 }],
        null,
        project,
      );
      const zooms = result.snappedOps.filter((o) => o.op === "zoom");
      expect(zooms).toHaveLength(1);
      expect(zooms[0]!.focalSource).toBe("explicit");
      expect(zooms[0]!.cx).toBe(0.5);
    });

    it("extends a zoom until the cursor leaves the focal region", () => {
      // Cursor parks on the reading area from t=8, then jumps away at t=32.
      const project = makeProject([
        ...Array.from({ length: 5 }, (_, i) => ({ t: 8 + i, x: 0.4, y: 0.4 })),
        { t: 32, x: 0.8, y: 0.8 },
        { t: 33, x: 0.82, y: 0.8 },
      ]);

      const result = snapAndRebaseEditOps([{ op: "zoom", t0: 8, t1: 10, scale: 1.6 }], null, project);
      const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
      expect(zoomOp!.rebasedT0).toBe(8);
      expect(zoomOp!.rebasedT1).toBe(32);
    });

    it("extends short zooms to the minimum hold when the cursor stays put", () => {
      const project = makeProject(Array.from({ length: 6 }, (_, i) => ({ t: 8 + i, x: 0.4, y: 0.4 })));

      const result = snapAndRebaseEditOps([{ op: "zoom", t0: 8, t1: 9, scale: 1.6 }], null, project);
      const zoomOp = result.snappedOps.find((o) => o.op === "zoom");
      expect(zoomOp!.rebasedT1).toBe(12); // 8s + MIN_ZOOM_HOLD(4s)
    });
  });
});
