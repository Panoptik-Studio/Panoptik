import { describe, expect, it } from "vitest";
import { packTextLanes, textBlockGeometry } from "./timelineTextTracks";
import type { TextOverlay } from "@panoptik/schema";

describe("timelineTextTracks", () => {
  it("packs non-overlapping text overlays into a single lane", () => {
    const overlays: TextOverlay[] = [
      { id: "t1", text: "First", timestamp: 1, duration: 2, staged: false },
      { id: "t2", text: "Second", timestamp: 4, duration: 3, staged: false },
      { id: "t3", text: "Third", timestamp: 8, duration: 2, staged: false },
    ];

    const { packed, totalLanes } = packTextLanes(overlays);
    expect(totalLanes).toBe(1);
    expect(packed).toHaveLength(3);
    expect(packed[0]!.laneIndex).toBe(0);
    expect(packed[1]!.laneIndex).toBe(0);
    expect(packed[2]!.laneIndex).toBe(0);
  });

  it("packs overlapping text overlays into separate stacked sub-lanes", () => {
    const overlays: TextOverlay[] = [
      { id: "t1", text: "Overlay 1", timestamp: 1, duration: 5, staged: false }, // 1..6 (lane 0)
      { id: "t2", text: "Overlay 2", timestamp: 3, duration: 4, staged: false }, // 3..7 (lane 1)
      { id: "t3", text: "Overlay 3", timestamp: 4, duration: 2, staged: false }, // 4..6 (lane 2)
      { id: "t4", text: "Overlay 4", timestamp: 7, duration: 2, staged: false }, // 7..9 (lane 0 is free!)
    ];

    const { packed, totalLanes } = packTextLanes(overlays);
    expect(totalLanes).toBe(3);

    const t1 = packed.find((p) => p.overlay.id === "t1");
    const t2 = packed.find((p) => p.overlay.id === "t2");
    const t3 = packed.find((p) => p.overlay.id === "t3");
    const t4 = packed.find((p) => p.overlay.id === "t4");

    expect(t1?.laneIndex).toBe(0);
    expect(t2?.laneIndex).toBe(1);
    expect(t3?.laneIndex).toBe(2);
    expect(t4?.laneIndex).toBe(0); // reuses lane 0 after t1 ends at 6s
  });

  it("calculates textBlockGeometry accurately", () => {
    const overlay: TextOverlay = {
      id: "t1",
      text: "Sample",
      timestamp: 2,
      duration: 4,
      staged: false,
    };
    const packed = packTextLanes([overlay]).packed[0]!;
    const timeToX = (t: number) => t * 100;

    const geom = textBlockGeometry(packed, timeToX, 180, 22, 3);
    expect(geom.left).toBe(200);
    expect(geom.width).toBe(400);
    expect(geom.top).toBe(180);
    expect(geom.height).toBe(22);
  });
});
