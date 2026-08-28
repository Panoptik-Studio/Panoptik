import { describe, expect, it } from "vitest";
import { migrateProject, type Media, type Segment } from "./index";

describe("migrateProject v1.1 → v1.2", () => {
  it("builds one full-range segment from a legacy single-clip project", () => {
    const legacy = {
      id: "p1",
      clip: { src: "blob:x", duration: 10, width: 1920, height: 1080 },
      playbackRate: 2,
      aspectPreset: "16:9",
      facecam: { src: null, x: 0.2, y: 0.3, size: 0.25, shape: "circle" },
      zoomPoints: [{ id: "z1", t: 3, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: false }],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [],
      captions: [],
      stagedCaptions: [],
      background: { kind: "solid", color: "#000000" },
      clickLog: [],
    } as unknown as Record<string, unknown>;

    const p = migrateProject(legacy);
    expect(p.media).toEqual({ src: "blob:x", duration: 10, width: 1920, height: 1080 });
    expect(p.segments).toHaveLength(1);
    const seg = p.segments[0]!;
    expect(seg.srcStart).toBe(0);
    expect(seg.srcEnd).toBe(10);
    expect(seg.speed).toBe(2);
    expect(seg.aspectPreset).toBe("16:9");
    expect(seg.facecam.size).toBe(0.25);
    expect(seg.zoomPoints).toHaveLength(1);
    expect(seg.zoomPoints[0]!.t).toBe(3);
  });

  it("passes through an already-v1.2 project unchanged", () => {
    const media: Media = { src: "blob:x", duration: 5, width: 800, height: 600 };
    const seg: Segment = {
      id: "s1", srcStart: 0, srcEnd: 5, speed: 1,
      stagePadding: 0, aspectPreset: "source",
      background: { kind: "solid", color: "#000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
      captions: [], stagedCaptions: [],
    };
    const p = migrateProject({ id: "n", media, segments: [seg], audioSrc: null, clickLog: [] });
    expect(p.media).toBe(media);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]).toBe(seg);
  });
});
