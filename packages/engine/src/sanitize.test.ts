import { describe, expect, it } from "vitest";
import { mergeSavedProject } from "./sanitize";
import type { Project } from "@panoptik/schema";

const fresh = (): Project => ({
  id: "fresh-id",
  clip: { src: "blob:fresh-clip", duration: 10, width: 1920, height: 1080 },
  audioSrc: "blob:fresh-audio",
  zoomPoints: [],
  stagedZoomPoints: [],
  textOverlays: [],
  stagedTextOverlays: [],
  captions: [],
  stagedCaptions: [],
  background: { kind: "solid", color: "#000000" },
  facecam: { src: "blob:fresh-cam", x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
  clickLog: [],
  aspectPreset: "source",
});

describe("mergeSavedProject", () => {
  it("keeps every media source from the freshly opened media", () => {
    const out = mergeSavedProject(fresh(), {
      clip: { src: "blob:stale", duration: 99, width: 1, height: 1 },
      audioSrc: "https://attacker.example/track.mp3",
      facecam: { src: "https://attacker.example/cam.mp4", x: 0.1, y: 0.1, size: 0.3 },
    } as Partial<Project>);
    // Stored URLs are dead on reload at best, and attacker-controlled at worst.
    expect(out.clip.src).toBe("blob:fresh-clip");
    expect(out.audioSrc).toBe("blob:fresh-audio");
    expect(out.facecam.src).toBe("blob:fresh-cam");
    // Placement is still restored.
    expect(out.facecam.x).toBeCloseTo(0.1);
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
        background: { kind: "solid", color: bad },
      } as unknown as Partial<Project>);
      expect(solid.background).toEqual({ kind: "solid", color: "#000000" });

      const grad = mergeSavedProject(fresh(), {
        background: { kind: "gradient", stops: [bad, bad] },
      } as unknown as Partial<Project>);
      expect(grad).toMatchObject({ background: { kind: "gradient", stops: ["#007cf0", "#7928ca"] } });
    }
  });

  it("accepts well-formed hex", () => {
    const out = mergeSavedProject(fresh(), {
      background: { kind: "gradient", stops: ["#0070f3", "#ABCDEF"] },
    } as Partial<Project>);
    expect(out.background).toEqual({ kind: "gradient", stops: ["#0070f3", "#ABCDEF"] });
  });

  it("drops entries that are the wrong shape rather than rendering them", () => {
    const out = mergeSavedProject(fresh(), {
      zoomPoints: [null, "nope", { id: "z1", t: 2, to: { scale: 2, x: 0.4, y: 0.4 }, dur: 0.7, ease: "linear" }],
      captions: [{ text: "", start: 0, end: 1 }, { text: "ok", start: 1, end: 2 }],
    } as unknown as Partial<Project>);
    expect(out.zoomPoints).toHaveLength(1);
    expect(out.zoomPoints[0]!.id).toBe("z1");
    expect(out.captions).toHaveLength(1);
  });

  it("clamps numbers into range and discards non-finite ones", () => {
    const out = mergeSavedProject(fresh(), {
      zoomPoints: [
        { id: "a", t: 1e9, to: { scale: 1e9, x: -5, y: NaN }, dur: Infinity, ease: "linear" },
      ],
      facecam: { size: 99, x: -1, y: 2 },
    } as unknown as Partial<Project>);
    const z = out.zoomPoints[0]!;
    expect(z.t).toBe(10); // clamped to the clip duration
    expect(z.to.scale).toBe(10);
    expect(z.to.x).toBe(0);
    expect(z.to.y).toBe(0.5); // NaN falls back
    expect(Number.isFinite(z.dur)).toBe(true);
    expect(out.facecam.size).toBeLessThanOrEqual(1);
    expect(out.facecam.x).toBe(0);
    expect(out.facecam.y).toBe(1);
  });

  it("caps list lengths so a corrupt file cannot stall the renderer", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => ({
      id: `z${i}`, t: 1, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.5, ease: "linear",
    }));
    const out = mergeSavedProject(fresh(), { zoomPoints: many } as unknown as Partial<Project>);
    expect(out.zoomPoints.length).toBeLessThanOrEqual(500);
  });

  it("only accepts known aspect presets", () => {
    expect(mergeSavedProject(fresh(), { aspectPreset: "9:16" } as Partial<Project>).aspectPreset).toBe("9:16");
    expect(
      mergeSavedProject(fresh(), { aspectPreset: "../../etc" } as unknown as Partial<Project>).aspectPreset,
    ).toBe("source");
  });

  it("returns the fresh project untouched when there is nothing saved", () => {
    expect(mergeSavedProject(fresh(), null)).toEqual(fresh());
  });
});
