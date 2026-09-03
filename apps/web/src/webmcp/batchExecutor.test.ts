import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/projectStore";
import { executeBatchOps } from "./batchExecutor";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";
import type { FullMediaAnalysis } from "@panoptik/engine";

describe("batchExecutor", () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: {
        id: "test-proj",
        media: [{ id: "m1", src: "blob:1", duration: 60, width: 1920, height: 1080 }],
        segments: [
          {
            id: "seg-1",
            mediaId: "m1",
            srcStart: 0,
            srcEnd: 60,
            speed: 1,
            stagePadding: 0,
            aspectPreset: "source",
            background: { kind: "solid", color: "#000" },
            facecam: { src: null, x: 0.1, y: 0.1, size: 0.2 },
            zoomPoints: [],
            stagedZoomPoints: [],
            textOverlays: [],
            stagedTextOverlays: [],
          },
        ],
        clickLog: [],
      },
      selectedSegmentIds: ["seg-1"],
    });
  });

  it("atomically stages heterogeneous multi-op batch into project store", () => {
    const ops: EditOp[] = [
      { op: "zoom", t0: 5.0, t1: 10.0, cx: 0.6, cy: 0.4, scale: 2.5 },
      { op: "bg", t0: 0, kind: "gradient", c0: "#0f172a", c1: "#38bdf8" },
      { op: "text", t: 6.0, text: "Step 1: Setup", pos: "top" },
      { op: "cam", t0: 0, corner: "bl", shape: "circle" },
      { op: "trans", at: 0, kind: "dipToBlack", dur: 0.5 },
    ];

    const snappedBatch = snapAndRebaseEditOps(ops, null, null);
    const result = executeBatchOps(snappedBatch, "replace");

    expect(result.success).toBe(true);
    expect(result.stagedCount).toBe(5);
    expect(result.diff.zooms).toBe(1);
    expect(result.diff.backgrounds).toBe(1);
    expect(result.diff.textOverlays).toBe(1);
    expect(result.diff.facecam).toBe(1);
    expect(result.diff.transitions).toBe(1);

    const state = useProjectStore.getState();
    const seg = state.project?.segments[0];
    expect(seg?.zoomPoints.length).toBe(1);
    expect(seg?.zoomPoints[0]?.to.scale).toBe(2.5);
    expect(seg?.textOverlays.length).toBe(1);
    expect(seg?.textOverlays[0]?.text).toBe("Step 1: Setup");
  });

  it("applies cut ops for real: drops dead air, splits the segment, and lands rebased zooms on the right source time", () => {
    const analysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash",
      duration: 60,
      scenes: [],
      audio: {
        duration: 60,
        silences: [{ start: 10.0, end: 12.0, duration: 2.0 }],
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
      { op: "cut", t: 11.0, dropSilence: true, padLeftMs: 50, padRightMs: 80 },
      { op: "zoom", t0: 20.0, t1: 25.0, cx: 0.5, cy: 0.5, scale: 2.0 },
    ];

    const project = useProjectStore.getState().project!;
    const snappedBatch = snapAndRebaseEditOps(ops, analysis, project);
    const result = executeBatchOps(snappedBatch, "replace");

    // The silence [10.05, 11.92] is actually gone from the timeline.
    expect(result.diff.cuts).toBe(1);
    expect(result.cutsApplied.count).toBe(1);
    expect(result.cutsApplied.droppedSeconds).toBeCloseTo(1.87, 1);
    expect(result.newDurationSeconds).toBeCloseTo(60 - 1.87, 1);

    const segs = useProjectStore.getState().project!.segments;
    expect(segs).toHaveLength(2);
    expect(segs[0]!.srcEnd).toBeCloseTo(10.05, 2);
    expect(segs[1]!.srcStart).toBeCloseTo(11.92, 2);

    // The zoom op was authored at source 20s (timeline 20s pre-cut). After the
    // cut it must land at source 20s — i.e. timeline 20 - 1.87 = 18.13s.
    expect(segs[1]!.zoomPoints).toHaveLength(1);
    expect(segs[1]!.zoomPoints[0]!.t).toBeCloseTo(20.0, 1);
  });

  it("keeps stored captions intact across an applied cut (absolute source time)", () => {    useProjectStore.setState({
      project: {
        ...useProjectStore.getState().project!,
        segments: [
          {
            ...useProjectStore.getState().project!.segments[0]!,
            textOverlays: [
              {
                id: "cap-1",
                kind: "caption",
                text: "hello world",
                timestamp: 30,
                duration: 2,
                position: "bottom",
                staged: false,
              },
            ],
          },
        ],
      },
    });

    const analysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash",
      duration: 60,
      scenes: [],
      audio: {
        duration: 60,
        silences: [{ start: 10.0, end: 12.0, duration: 2.0 }],
        minorPauses: [],
        loudPeaks: [],
        speechRatio: 0.9,
      },
      words: [],
      phrases: [],
      interactions: [],
      createdAt: Date.now(),
    };

    const ops: EditOp[] = [{ op: "cut", t: 11.0, dropSilence: true }];
    const project = useProjectStore.getState().project!;
    const snappedBatch = snapAndRebaseEditOps(ops, analysis, project);
    executeBatchOps(snappedBatch, "replace");

    const segs = useProjectStore.getState().project!.segments;
    const captions = segs.flatMap((s) => s.textOverlays);
    expect(captions).toHaveLength(1);
    // Stored at absolute source time — unchanged by the cut; read tools map it
    // to the shifted timeline position (30 - 1.87 = 28.13s).
    expect(captions[0]!.timestamp).toBe(30);
  });

  it("enables 16:9 stage padding when a background op hits a 'source' project", () => {
    const ops: EditOp[] = [{ op: "bg", t0: 0, kind: "gradient", c0: "#0f172a", c1: "#1e293b" }];
    const project = useProjectStore.getState().project!;
    expect(project.segments[0]!.aspectPreset).toBe("source");

    const snappedBatch = snapAndRebaseEditOps(ops, null, project);
    executeBatchOps(snappedBatch, "replace");

    const seg = useProjectStore.getState().project!.segments[0]!;
    expect(seg.background).toEqual({ kind: "gradient", stops: ["#0f172a", "#1e293b"] });
    expect(seg.aspectPreset).toBe("16:9");
  });

  it("snaps head cuts to the segment start so no sliver segment remains", () => {
    const ops: EditOp[] = [{ op: "cut", t: 0.01, t1: 1.77 }];
    const project = useProjectStore.getState().project!;

    const snappedBatch = snapAndRebaseEditOps(ops, null, project);
    const result = executeBatchOps(snappedBatch, "replace");

    const segs = useProjectStore.getState().project!.segments;
    expect(segs).toHaveLength(1);
    expect(segs[0]!.srcStart).toBeCloseTo(1.77, 2);
    expect(result.newDurationSeconds).toBeCloseTo(58.23, 1);
  });

  it("applies the editorial stage baseline to every batch (gradient, padding, rounded corners)", () => {
    const ops: EditOp[] = [{ op: "zoom", t0: 5, t1: 8, cx: 0.5, cy: 0.5 }];
    const project = useProjectStore.getState().project!;

    const snappedBatch = snapAndRebaseEditOps(ops, null, project);
    const result = executeBatchOps(snappedBatch, "replace");

    const seg = useProjectStore.getState().project!.segments[0]!;
    expect(seg.background).toEqual({ kind: "gradient", stops: ["#0f172a", "#1e293b"] });
    expect(seg.stagePadding).toBe(28);
    expect(seg.cornerRadius).toBe(16);
    expect(seg.aspectPreset).toBe("16:9");
    expect(result.stageBaseline.appliedSegments).toBe(1);
  });

  it("does not override an explicit bg op with the baseline gradient", () => {
    const ops: EditOp[] = [{ op: "bg", t0: 0, kind: "gradient", c0: "#111827", c1: "#4c1d95" }];
    const project = useProjectStore.getState().project!;

    const snappedBatch = snapAndRebaseEditOps(ops, null, project);
    executeBatchOps(snappedBatch, "replace");

    const seg = useProjectStore.getState().project!.segments[0]!;
    expect(seg.background).toEqual({ kind: "gradient", stops: ["#111827", "#4c1d95"] });
    // Padding and corners still ride along with the explicit styling.
    expect(seg.stagePadding).toBe(28);
    expect(seg.cornerRadius).toBe(16);
  });
});
