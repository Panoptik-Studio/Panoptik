import { describe, expect, it } from "vitest";
import type { ClickEvent } from "@panoptik/schema";
import {
  aggregateSceneInteractions,
  detectClickBursts,
} from "./interactionFeatures";
import type { SceneFeature } from "./videoFeatures";

describe("interactionFeatures", () => {
  it("detects click bursts (>= 3 clicks within 2.0s)", () => {
    const clicks: ClickEvent[] = [
      { t: 1.0, x: 0.2, y: 0.3, type: "click" },
      { t: 1.4, x: 0.22, y: 0.32, type: "click" },
      { t: 1.8, x: 0.24, y: 0.34, type: "click" }, // Burst 1 (3 clicks)
      { t: 8.0, x: 0.8, y: 0.8, type: "click" }, // Isolated
      { t: 12.0, x: 0.5, y: 0.5, type: "click" },
      { t: 12.5, x: 0.52, y: 0.51, type: "click" },
      { t: 13.0, x: 0.51, y: 0.53, type: "click" },
      { t: 13.5, x: 0.50, y: 0.52, type: "click" }, // Burst 2 (4 clicks)
    ];

    const bursts = detectClickBursts(clicks, 2.0);
    expect(bursts).toHaveLength(2);

    expect(bursts[0]!.startT).toBe(1.0);
    expect(bursts[0]!.clickCount).toBe(3);
    expect(bursts[0]!.centroid.x).toBeCloseTo(0.22, 2);
    expect(bursts[0]!.centroid.y).toBeCloseTo(0.32, 2);

    expect(bursts[1]!.startT).toBe(12.0);
    expect(bursts[1]!.clickCount).toBe(4);
    expect(bursts[1]!.centroid.x).toBeCloseTo(0.51, 2);
    expect(bursts[1]!.centroid.y).toBeCloseTo(0.515, 2);
  });

  it("aggregates clicks per scene and computes bounding box and centroid", () => {
    const scenes: SceneFeature[] = [
      { id: 0, t0: 0.0, t1: 5.0, motionCategory: "static", paletteIndex: 0, camCorner: "tl", keyframeTime: 2.5 },
      { id: 1, t0: 5.0, t1: 15.0, motionCategory: "high", paletteIndex: 3, camCorner: "bl", keyframeTime: 10.0 },
    ];

    const clicks: ClickEvent[] = [
      { t: 1.0, x: 0.2, y: 0.3, type: "click" },
      { t: 2.0, x: 0.4, y: 0.5, type: "click" },
      { t: 8.0, x: 0.6, y: 0.7, type: "click" },
      { t: 9.0, x: 0.8, y: 0.9, type: "click" },
    ];

    const summaries = aggregateSceneInteractions(scenes, clicks);
    expect(summaries).toHaveLength(2);

    // Scene 0: clicks at (0.2, 0.3) and (0.4, 0.5) -> centroid (0.3, 0.4)
    expect(summaries[0]!.sceneId).toBe(0);
    expect(summaries[0]!.clicks).toBe(2);
    expect(summaries[0]!.centroid).toEqual({ x: 0.3, y: 0.4 });
    expect(summaries[0]!.boundingBox).toEqual({ minX: 0.2, minY: 0.3, maxX: 0.4, maxY: 0.5 });

    // Scene 1: clicks at (0.6, 0.7) and (0.8, 0.9) -> centroid (0.7, 0.8)
    expect(summaries[1]!.sceneId).toBe(1);
    expect(summaries[1]!.clicks).toBe(2);
    expect(summaries[1]!.centroid).toEqual({ x: 0.7, y: 0.8 });
  });

  it("handles Tier C degraded mode when clickLog is empty or undefined", () => {
    const scenes: SceneFeature[] = [
      { id: 0, t0: 0.0, t1: 5.0, motionCategory: "static", paletteIndex: 0, camCorner: "tl", keyframeTime: 2.5 },
    ];

    const summaries = aggregateSceneInteractions(scenes, null);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.clicks).toBe(0);
    expect(summaries[0]!.centroid).toBeNull();
    expect(summaries[0]!.boundingBox).toBeNull();
    expect(summaries[0]!.bursts).toEqual([]);
  });
});
