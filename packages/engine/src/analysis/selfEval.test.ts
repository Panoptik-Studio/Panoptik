import { describe, expect, it } from "vitest";
import type { Project } from "@panoptik/schema";
import { evaluateProjectTimeline } from "./selfEval";

describe("selfEval quality guard", () => {
  it("flags flash frames (< 0.25s) as errors", () => {
    const projectWithFlashFrame: Project = {
      id: "p1",
      media: [{ id: "m1", src: "blob:1", duration: 10, width: 1920, height: 1080 }],
      segments: [
        {
          id: "seg-1",
          mediaId: "m1",
          srcStart: 0,
          srcEnd: 5.0,
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
        // 0.1s flash frame
        {
          id: "seg-2",
          mediaId: "m1",
          srcStart: 5.0,
          srcEnd: 5.1,
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
        {
          id: "seg-3",
          mediaId: "m1",
          srcStart: 5.1,
          srcEnd: 10.0,
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
    };

    const report = evaluateProjectTimeline(projectWithFlashFrame);
    expect(report.valid).toBe(false);
    expect(report.flashFramesCount).toBe(1);
    expect(report.issues.some((i) => i.type === "flash_frame")).toBe(true);
  });

  it("flags zoom hold durations outside [0.8s, 6.0s] bounds as warnings", () => {
    const projectWithInvalidZoom: Project = {
      id: "p2",
      media: [{ id: "m1", src: "blob:1", duration: 20, width: 1920, height: 1080 }],
      segments: [
        {
          id: "seg-1",
          mediaId: "m1",
          srcStart: 0,
          srcEnd: 20,
          speed: 1,
          stagePadding: 0,
          aspectPreset: "source",
          background: { kind: "solid", color: "#000" },
          facecam: { src: null, x: 0.1, y: 0.1, size: 0.2 },
          zoomPoints: [
            // 0.3s zoom hold (too short)
            { id: "z1", t: 2.0, to: { scale: 2.0, x: 0.5, y: 0.5 }, dur: 0.3, hold: 0.3, ease: "io3", staged: false },
            // 8.0s zoom hold (too long)
            { id: "z2", t: 10.0, to: { scale: 2.0, x: 0.5, y: 0.5 }, dur: 0.3, hold: 8.0, ease: "io3", staged: false },
          ],
          stagedZoomPoints: [],
          textOverlays: [],
          stagedTextOverlays: [],
        },
      ],
      clickLog: [],
    };

    const report = evaluateProjectTimeline(projectWithInvalidZoom);
    expect(report.invalidZoomsCount).toBe(2);
    expect(report.issues.filter((i) => i.type === "zoom_duration_invalid")).toHaveLength(2);
  });
});
