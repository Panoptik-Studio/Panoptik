import { describe, expect, it } from "vitest";
import { mergeSavedProject } from "./sanitize";
import type { Project } from "@panoptik/schema";

const fresh = (): Project => ({
  id: "fresh-id",
  media: { src: "blob:fresh-clip", duration: 10, width: 1920, height: 1080 },
  audioSrc: "blob:fresh-audio",
  segments: [
    {
      id: "s1",
      srcStart: 0,
      srcEnd: 10,
      speed: 1,
      stagePadding: 0,
      aspectPreset: "source",
      background: { kind: "solid", color: "#000000" },
      facecam: { src: "blob:fresh-cam", x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
      zoomPoints: [],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [],
      captions: [],
      stagedCaptions: [],
    },
  ],
  clickLog: [],
});

describe("mergeSavedProject", () => {
  it("keeps every media source from the freshly opened media", () => {
    const out = mergeSavedProject(fresh(), {
      media: { src: "blob:stale", duration: 99, width: 1, height: 1 },
      audioSrc: "https://attacker.example/track.mp3",
      segments: [
        { facecam: { src: "https://attacker.example/cam.mp4", x: 0.1, y: 0.1, size: 0.3 } },
      ],
    } as unknown as Partial<Project>);
    // Stored URLs are dead on reload at best, and attacker-controlled at worst.
    expect(out.media.src).toBe("blob:fresh-clip");
    expect(out.audioSrc).toBe("blob:fresh-audio");
    expect(out.segments[0]!.facecam.src).toBe("blob:fresh-cam");
    // Placement is still restored.
    expect(out.segments[0]!.facecam.x).toBeCloseTo(0.1);
  });

  it("rejects colours that are not plain hex", () => {
    // These land in an inline CSS gradient in the preview, where url() fetches.
    for (const bad of [
      "url(https://attacker.example/pixel)",
      "red; background-image: url(https://attacker.example/x)",
      "rgb(0,0,0)",
      "#fff",
      42,
      null,
    ]) {
      const solid = mergeSavedProject(fresh(), {
        segments: [{ background: { kind: "solid", color: bad } }],
      } as unknown as Partial<Project>);
      expect(solid.segments[0]!.background).toEqual({ kind: "solid", color: "#000000" });

      const grad = mergeSavedProject(fresh(), {
        segments: [{ background: { kind: "gradient", stops: [bad, bad] } }],
      } as unknown as Partial<Project>);
      expect(grad.segments[0]).toMatchObject({ background: { kind: "gradient", stops: ["#007cf0", "#7928ca"] } });
    }
  });

  it("accepts well-formed hex", () => {
    const out = mergeSavedProject(fresh(), {
      segments: [{ background: { kind: "gradient", stops: ["#0070f3", "#ABCDEF"] } }],
    } as Partial<Project>);
    expect(out.segments[0]!.background).toEqual({ kind: "gradient", stops: ["#0070f3", "#ABCDEF"] });
  });

  it("drops entries that are the wrong shape rather than rendering them", () => {
    const out = mergeSavedProject(fresh(), {
      segments: [
        {
          zoomPoints: [null, "nope", { id: "z1", t: 2, to: { scale: 2, x: 0.4, y: 0.4 }, dur: 0.7, ease: "linear" }],
          captions: [{ text: "", start: 0, end: 1 }, { text: "ok", start: 1, end: 2 }],
        },
      ],
    } as unknown as Partial<Project>);
    expect(out.segments[0]!.zoomPoints).toHaveLength(1);
    expect(out.segments[0]!.zoomPoints[0]!.id).toBe("z1");
    expect(out.segments[0]!.captions).toHaveLength(1);
  });

  it("clamps annotations into the segment source window and discards non-finite ones", () => {
    const src = fresh();
    // Narrow the segment window to [2, 6] so the clamp target is obvious.
    src.segments[0]!.srcStart = 2;
    src.segments[0]!.srcEnd = 6;
    const out = mergeSavedProject(src, {
      segments: [
        {
          zoomPoints: [
            { id: "a", t: 1e9, to: { scale: 1e9, x: -5, y: NaN }, dur: Infinity, ease: "linear" },
          ],
          facecam: { size: 99, x: -1, y: 2 },
        },
      ],
    } as unknown as Partial<Project>);
    const z = out.segments[0]!.zoomPoints[0]!;
    expect(z.t).toBe(6); // clamped to the segment srcEnd, not the whole duration
    expect(z.to.scale).toBe(10);
    expect(z.to.x).toBe(0);
    expect(z.to.y).toBe(0.5); // NaN falls back
    expect(Number.isFinite(z.dur)).toBe(true);
    expect(out.segments[0]!.facecam.size).toBeLessThanOrEqual(1);
    expect(out.segments[0]!.facecam.x).toBe(0);
    expect(out.segments[0]!.facecam.y).toBe(1);
  });

  it("caps list lengths so a corrupt file cannot stall the renderer", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      id: `z${i}`, t: 1, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.5, ease: "linear",
    }));
    const out = mergeSavedProject(fresh(), { segments: [{ zoomPoints: many }] } as unknown as Partial<Project>);
    expect(out.segments[0]!.zoomPoints.length).toBeLessThanOrEqual(500);
  });

  it("only accepts known aspect presets and clamps speed to the 0.25–3 grid", () => {
    const out = mergeSavedProject(fresh(), {
      segments: [{ aspectPreset: "9:16", speed: 2.5 }],
    } as unknown as Partial<Project>);
    expect(out.segments[0]!.aspectPreset).toBe("9:16");
    expect(out.segments[0]!.speed).toBe(2.5);

    const clampedSpeed = mergeSavedProject(fresh(), {
      segments: [{ aspectPreset: "../../etc", speed: 9.5 }],
    } as unknown as Partial<Project>);
    expect(clampedSpeed.segments[0]!.aspectPreset).toBe("source");
    expect(clampedSpeed.segments[0]!.speed).toBe(3);
  });

  it("sanitizes each segment independently, keeping fresh ones when saved lacks them", () => {
    const src = fresh();
    src.segments.push({
      id: "s2",
      srcStart: 10,
      srcEnd: 20,
      speed: 1,
      stagePadding: 0,
      aspectPreset: "source",
      background: { kind: "solid", color: "#000000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
      zoomPoints: [],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [],
      captions: [],
      stagedCaptions: [],
    });
    const out = mergeSavedProject(src, {
      segments: [
        { zoomPoints: [{ id: "a", t: 1, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.5, ease: "linear" }] },
        // s2 has nothing in saved — keep fresh's (empty) annotations
      ],
    } as unknown as Partial<Project>);
    expect(out.segments[0]!.zoomPoints).toHaveLength(1);
    expect(out.segments[1]!.zoomPoints).toHaveLength(0);
  });

  it("returns the fresh project untouched when there is nothing saved", () => {
    expect(mergeSavedProject(fresh(), null)).toEqual(fresh());
  });
});
