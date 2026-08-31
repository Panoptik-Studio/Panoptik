import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "../stores/projectStore";
import { executeBatchOps } from "./batchExecutor";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";

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
});
