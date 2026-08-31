import { describe, expect, it } from "vitest";
import type { Project } from "@panoptik/schema";
import { generateVideoDigest } from "./digest";
import type { FullMediaAnalysis } from "./cache";

describe("digest", () => {
  it("serializes FullMediaAnalysis into compact dataframe format and packed transcript", () => {
    const mockProject: Project = {
      id: "proj_abc123",
      media: [{ id: "m1", src: "blob:1", duration: 72.5, width: 1920, height: 1080 }],
      segments: [
        {
          id: "seg-1",
          mediaId: "m1",
          srcStart: 0,
          srcEnd: 72.5,
          speed: 1,
          stagePadding: 0,
          aspectPreset: "source",
          background: { kind: "solid", color: "#000" },
          facecam: { src: "blob:fc", x: 0.1, y: 0.1, size: 0.22, shape: "circle" },
          zoomPoints: [],
          stagedZoomPoints: [],
          textOverlays: [],
          stagedTextOverlays: [],
        },
      ],
      audioTracks: [{ id: "mic", kind: "voiceover", name: "Mic", volume: 1.0, src: "blob:mic", duration: 72.5, startT: 0 }],
      clickLog: [{ t: 20.0, x: 0.5, y: 0.5, type: "click" }],
    };

    const mockAnalysis: FullMediaAnalysis = {
      mediaId: "m1",
      sampledHash: "hash_1234567890abcdef",
      duration: 72.5,
      scenes: [
        { id: 0, t0: 0.0, t1: 15.0, motionCategory: "static", paletteIndex: 0, camCorner: "br", keyframeTime: 7.5 },
        { id: 1, t0: 15.0, t1: 72.5, motionCategory: "high", paletteIndex: 3, camCorner: "bl", keyframeTime: 40.0 },
      ],
      audio: {
        duration: 72.5,
        silences: [{ start: 30.0, end: 32.5, duration: 2.5 }],
        minorPauses: [],
        loudPeaks: [{ t: 45.0, rms: 0.8, rmsRatio: 4.2, keepoutStart: 44.8, keepoutEnd: 45.2 }],
        speechRatio: 0.85,
      },
      words: [],
      phrases: [
        { start: 0.0, end: 5.2, text: "Welcome to Panoptik editor.", speaker: 0 },
        { start: 5.8, end: 12.4, text: "We demo client side video synthesis.", speaker: 0 },
      ],
      interactions: [
        { sceneId: 0, clicks: 0, centroid: null, boundingBox: null, bursts: [] },
        { sceneId: 1, clicks: 1, centroid: { x: 0.5, y: 0.5 }, boundingBox: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 }, bursts: [] },
      ],
      createdAt: Date.now(),
    };

    const digest = generateVideoDigest(mockProject, mockAnalysis);

    expect(digest.project.id).toBe("proj_abc123");
    expect(digest.project.duration).toBe(72.5);
    expect(digest.project.hasFacecam).toBe(true);
    expect(digest.project.hasMic).toBe(true);
    expect(digest.project.hasMusic).toBe(false);
    expect(digest.project.silenceCount).toBe(1);
    expect(digest.project.deadAirSeconds).toBe(2.5);

    expect(digest.scenes).toHaveLength(2);
    // Scene 0: [0, 0.0, 15.0, "static", 0, 0, 0, "br"]
    expect(digest.scenes[0]!).toEqual([0, 0.0, 15.0, "static", 0, 0, 0, "br"]);
    // Scene 1: [1, 15.0, 72.5, "high", 3, 1, 1, "bl"]
    expect(digest.scenes[1]!).toEqual([1, 15.0, 72.5, "high", 3, 1, 1, "bl"]);

    expect(digest.transcript).toContain("[00:00.0-00:05.2] (Speaker 0) Welcome to Panoptik editor.");
    expect(digest.tokenEstimate).toBeLessThan(1000);
  });
});
