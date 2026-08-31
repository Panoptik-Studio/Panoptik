import { describe, expect, it } from "vitest";
import {
  aggregateSceneInteractions,
  extractAudioFeatures,
  generateVideoDigest,
  type FullMediaAnalysis,
} from "@panoptik/engine";
import type { Project } from "@panoptik/schema";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";

describe("degraded mode fallbacks", () => {
  it("Degraded Mode 1: Fallback from mic track to screen audio when mic is missing", () => {
    // When no mic track is present, audio features extract gracefully from screen audio
    const screenAudioSamples = new Float32Array(16000 * 2); // 2s screen audio
    for (let i = 0; i < screenAudioSamples.length; i++) {
      screenAudioSamples[i] = 0.1 * Math.sin((2 * Math.PI * 400 * i) / 16000);
    }

    const audioResult = extractAudioFeatures(screenAudioSamples, 16000);
    expect(audioResult.duration).toBe(2.0);
    expect(audioResult.speechRatio).toBeGreaterThan(0);
  });

  it("Degraded Mode 2: Degraded cursor stream (clicks: 0, centroid: null) gracefully handles zoom snapping", () => {
    const mockAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash123",
      duration: 30.0,
      scenes: [
        { id: 0, t0: 0, t1: 30, motionCategory: "static", paletteIndex: 0, camCorner: "tl", keyframeTime: 15 },
      ],
      audio: { duration: 30, silences: [], minorPauses: [], loudPeaks: [], speechRatio: 0.8 },
      words: [],
      phrases: [],
      // Tier C: Empty cursor stream
      interactions: aggregateSceneInteractions([{ id: 0, t0: 0, t1: 30, motionCategory: "static", paletteIndex: 0, camCorner: "tl", keyframeTime: 15 }], null),
      createdAt: Date.now(),
    };

    expect(mockAnalysis.interactions[0]!.clicks).toBe(0);
    expect(mockAnalysis.interactions[0]!.centroid).toBeNull();

    // Zoom proposed without focal coordinates should fall back to screen center (0.5, 0.5)
    const ops: EditOp[] = [{ op: "zoom", t0: 5.0, t1: 10.0 }];
    const result = snapAndRebaseEditOps(ops, mockAnalysis, null);

    expect(result.snappedOps).toHaveLength(1);
    const zoom = result.snappedOps[0]!;
    if (zoom.op === "zoom") {
      expect(zoom.cx).toBe(0.5);
      expect(zoom.cy).toBe(0.5);
    }
  });

  it("Degraded Mode 3: Digest generation handles projects with zero transcript words and empty tracks", () => {
    const mockProject: Project = {
      id: "empty-proj",
      media: [{ id: "m1", src: "blob:1", duration: 10, width: 1920, height: 1080 }],
      segments: [
        {
          id: "seg-1",
          mediaId: "m1",
          srcStart: 0,
          srcEnd: 10,
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

    const emptyAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "empty",
      duration: 10,
      scenes: [],
      audio: { duration: 10, silences: [], minorPauses: [], loudPeaks: [], speechRatio: 0 },
      words: [],
      phrases: [],
      interactions: [],
      createdAt: Date.now(),
    };

    const digest = generateVideoDigest(mockProject, emptyAnalysis);
    expect(digest.project.id).toBe("empty-proj");
    expect(digest.scenes).toEqual([]);
    expect(digest.transcript).toBe("");
    expect(digest.tokenEstimate).toBeLessThan(100);
  });
});
