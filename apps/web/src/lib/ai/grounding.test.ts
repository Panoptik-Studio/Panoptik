import { describe, it, expect } from "vitest";
import {
  parseGroundingOutput,
  calculateZoomTolerance,
  isWithinZoomTolerance,
  GRID_3X3_CELLS,
} from "./grounding";

describe("Grounding Bounding Box & Centroid Parser", () => {
  it("parses 0-1000 standard Gemini/Qwen bounding box array", () => {
    const raw = {
      object_present: true,
      bbox_2d: [100, 200, 500, 800], // ymin: 100, xmin: 200, ymax: 500, xmax: 800
      confidence: 0.95,
    };
    const parsed = parseGroundingOutput(raw);
    expect(parsed.objectPresent).toBe(true);
    expect(parsed.x).toBeCloseTo(0.5, 2); // (200 + 800)/2000 = 0.5
    expect(parsed.y).toBeCloseTo(0.3, 2); // (100 + 500)/2000 = 0.3
    expect(parsed.width).toBeCloseTo(0.6, 2);
    expect(parsed.height).toBeCloseTo(0.4, 2);
    expect(parsed.source).toBe("bbox");
  });

  it("parses markdown JSON string with bounding box", () => {
    const rawStr = '```json\n{"object_present": true, "bbox_2d": [0, 600, 400, 1000], "confidence": 0.88}\n```';
    const parsed = parseGroundingOutput(rawStr);
    expect(parsed.objectPresent).toBe(true);
    expect(parsed.x).toBeCloseTo(0.8, 2);
    expect(parsed.y).toBeCloseTo(0.2, 2);
  });

  it("parses 3x3 Grid Cell code (e.g. B2, A3)", () => {
    const parsedB2 = parseGroundingOutput({ grid_cell: "B2", object_present: true });
    expect(parsedB2.gridCell).toBe("B2");
    expect(parsedB2.x).toBeCloseTo(0.5, 2);
    expect(parsedB2.y).toBeCloseTo(0.5, 2);
    expect(parsedB2.source).toBe("grid");

    const parsedA1 = parseGroundingOutput("The target is located in cell A1");
    expect(parsedA1.gridCell).toBe("A1");
    expect(parsedA1.x).toBeCloseTo(1 / 6, 2);
    expect(parsedA1.y).toBeCloseTo(1 / 6, 2);
    expect(parsedA1.source).toBe("grid");
  });

  it("handles object not present / hallucination flags", () => {
    const parsed = parseGroundingOutput({ object_present: false, confidence: 0 });
    expect(parsed.objectPresent).toBe(false);
  });
});

describe("Zoom Viewport Tolerance Math", () => {
  it("calculates tolerance at 2.2x scale on 1080p screen (~±285px margin)", () => {
    // 1920px screen width, scale 2.2, object width = 300px (normalized ~0.156)
    const { pixelTolerance, normalizedTolerance } = calculateZoomTolerance(2.2, 300 / 1920, 1920);
    // (1920 / 2.2 - 300) / 2 = (872.72 - 300) / 2 = 286.36px
    expect(pixelTolerance).toBeCloseTo(286.36, 0);
    expect(normalizedTolerance).toBeGreaterThan(0.14);

    // Target at center (0.5, 0.5), proposal at (0.6, 0.55) -> within ~0.14 tolerance
    const within = isWithinZoomTolerance({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.55 }, 2.2, 300 / 1920);
    expect(within).toBe(true);
  });

  it("shows tight tolerance at 5.0x deep zoom", () => {
    const { pixelTolerance } = calculateZoomTolerance(5.0, 300 / 1920, 1920);
    // (1920 / 5 - 300) / 2 = (384 - 300) / 2 = 42px
    expect(pixelTolerance).toBeCloseTo(42, 0);

    // Proposed point too far (e.g. 0.1 normalized delta = 192px error) -> exceeds 42px margin
    const within = isWithinZoomTolerance({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, 5.0, 300 / 1920);
    expect(within).toBe(false);
  });
});
