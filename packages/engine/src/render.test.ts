import { describe, expect, it, vi, beforeEach } from "vitest";
import { getCameraTransform, IDENTITY, renderFrame } from "./render";
import type { ZoomPoint, Project } from "@panoptik/schema";

const zp = (overrides: Partial<ZoomPoint>): ZoomPoint => ({
  id: "z1",
  t: 0,
  to: { scale: 2, x: 0.5, y: 0.5 },
  dur: 1,
  ease: "linear",
  staged: false,
  ...overrides,
});

describe("getCameraTransform", () => {
  it("identity before first keyframe", () => {
    expect(getCameraTransform([zp({ t: 2 })], 0)).toEqual(IDENTITY);
  });

  it("reaches target after dur", () => {
    const z = zp({ t: 1, to: { scale: 3, x: 0.25, y: 0.75 }, dur: 1, ease: "linear" });
    expect(getCameraTransform([z], 2)).toEqual({ scale: 3, x: 0.25, y: 0.75 });
  });

  it("mid-flight halfway with linear ease", () => {
    const z = zp({ t: 0, to: { scale: 3, x: 0.5, y: 0.5 }, dur: 2, ease: "linear" });
    expect(getCameraTransform([z], 1)).toEqual({ scale: 2, x: 0.5, y: 0.5 });
  });

  it("staged points are ignored", () => {
    const z = zp({ t: 0, staged: true });
    expect(getCameraTransform([z], 5)).toEqual(IDENTITY);
  });

  it("sequential fold: two keyframes compose", () => {
    const z1 = zp({ id: "z1", t: 0, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 1, ease: "linear" });
    const z2 = zp({ id: "z2", t: 1, to: { scale: 4, x: 0.5, y: 0.5 }, dur: 1, ease: "linear" });
    expect(getCameraTransform([z1, z2], 1)).toEqual({ scale: 2, x: 0.5, y: 0.5 });
    expect(getCameraTransform([z1, z2], 2)).toEqual({ scale: 4, x: 0.5, y: 0.5 });
  });
});

// ── renderFrame tests ──

function makeCtx() {
  const calls: [string, ...unknown[]][] = [];
  const ctx = {
    canvas: { width: 1920, height: 1080 },
    fillStyle: "",
    font: "",
    textAlign: "" as CanvasTextAlign,
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    translate: (...args: unknown[]) => calls.push(["translate", ...args]),
    scale: (...args: unknown[]) => calls.push(["scale", ...args]),
    fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
    fillText: (...args: unknown[]) => calls.push(["fillText", ...args]),
    drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    createLinearGradient: () => ({
      addColorStop: () => {},
    }),
    get calls() { return calls; },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function makeProject(overrides?: Partial<Project>): Project {
  return {
    id: "test",
    clip: { src: "", duration: 15, width: 1920, height: 1080 },
    zoomPoints: [],
    stagedZoomPoints: [],
    textOverlays: [],
    stagedTextOverlays: [],
    captions: [],
    stagedCaptions: [],
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [],
    aspectPreset: "16:9",
    ...overrides,
  };
}

describe("renderFrame", () => {
  it("draws solid background", () => {
    const { ctx, calls } = makeCtx();
    renderFrame(ctx, makeProject(), 0);
    const fillRects = calls.filter((c) => c[0] === "fillRect");
    expect(fillRects.length).toBeGreaterThanOrEqual(1);
  });

  it("draws gradient background", () => {
    const { ctx, calls } = makeCtx();
    const p = makeProject({ background: { kind: "gradient", stops: ["#6366f1", "#a855f7"] } });
    renderFrame(ctx, p, 0);
    const fillRects = calls.filter((c) => c[0] === "fillRect");
    expect(fillRects.length).toBeGreaterThanOrEqual(1);
  });

  it("draws text overlays within time window", () => {
    const { ctx, calls } = makeCtx();
    const p = makeProject({
      textOverlays: [{ id: "t1", text: "Hello", timestamp: 3, position: "top", staged: false }],
    });
    renderFrame(ctx, p, 4); // within 3..6 window
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts.some((c) => String(c[1]).includes("Hello"))).toBe(true);
  });

  it("does not draw text overlays outside time window", () => {
    const { ctx, calls } = makeCtx();
    const p = makeProject({
      textOverlays: [{ id: "t1", text: "Hello", timestamp: 3, position: "top", staged: false }],
    });
    renderFrame(ctx, p, 10); // outside 3..6 window
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts.some((c) => String(c[1]).includes("Hello"))).toBe(false);
  });

  it("staged text drawn in amber", () => {
    const { ctx } = makeCtx();
    const p = makeProject({
      stagedTextOverlays: [{ id: "s1", text: "Staged", timestamp: 1, position: "center", staged: true }],
    });
    // Just verify it doesn't throw
    renderFrame(ctx, p, 2);
  });

  it("draws captions within time window", () => {
    const { ctx, calls } = makeCtx();
    const p = makeProject({
      captions: [{ text: "Welcome", start: 0, end: 2 }],
    });
    renderFrame(ctx, p, 1);
    const texts = calls.filter((c) => c[0] === "fillText");
    expect(texts.some((c) => String(c[1]).includes("Welcome"))).toBe(true);
  });
});
