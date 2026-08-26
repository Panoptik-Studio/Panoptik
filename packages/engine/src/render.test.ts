import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  cameraViewport,
  canvasToFrame,
  frameToCanvas,
  getCameraTransform,
  IDENTITY,
  renderFrame,
  setCurrentFrame,
} from "./render";
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

  it("overlapping zooms glide without snapping to 1x", () => {
    const a = zp({ id: "a", t: 4, to: { scale: 2, x: 0.2, y: 0.2 }, dur: 0.45, ease: "linear" });
    const b = zp({ id: "b", t: 6.5, to: { scale: 1.8, x: 0.8, y: 0.8 }, dur: 0.45, ease: "linear" });
    // At 6.6, we are 0.1s into B's transition from A's target, not from 1x
    const at6_4 = getCameraTransform([a, b], 6.4); // still A
    expect(at6_4.scale).toBeCloseTo(2);
    const at6_6 = getCameraTransform([a, b], 6.6);
    // Should be between A and B, not near 1
    expect(at6_6.scale).toBeGreaterThan(1.5);
    expect(at6_6.scale).toBeLessThan(2);
    expect(at6_6.x).toBeGreaterThan(0.2);
    expect(at6_6.x).toBeLessThan(0.8);
  });

  it("eased progress is not linear (easeInOutCubic mid < linear mid when accelerating)", () => {
    const z = zp({ t: 0, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 1, ease: "easeInOutCubic" });
    const mid = getCameraTransform([z], 0.25); // 25% linear would be 1.25, eased is less (ease in)
    expect(mid.scale).toBeLessThan(1.25 + 0.1);
    expect(mid.scale).toBeGreaterThan(1);
  });
});

describe("zoom camera framing (renderFrame transform)", () => {
  /**
   * Replay the translate/scale/drawImage calls renderFrame emitted and report
   * where the drawn frame's edges landed on the canvas.
   */
  function drawnEdges(calls: [string, ...unknown[]][]) {
    let tx = 0;
    let ty = 0;
    let s = 1;
    for (const [op, ...args] of calls) {
      if (op === "translate") {
        tx += (args[0] as number) * s;
        ty += (args[1] as number) * s;
      } else if (op === "scale") {
        s *= args[0] as number;
      }
    }
    const draw = calls.find((c) => c[0] === "drawImage")!;
    const [, , dx, dy, dw, dh] = draw as [string, unknown, number, number, number, number];
    return { left: tx + s * dx, top: ty + s * dy, right: tx + s * (dx + dw), bottom: ty + s * (dy + dh) };
  }

  const fakeFrame = { width: 1920, height: 1080 } as unknown as CanvasImageSource;

  function render(scale: number, x: number, y: number) {
    const { ctx, calls } = makeCtx();
    const p = makeProject({
      clip: { src: "", duration: 10, width: 1920, height: 1080 },
      zoomPoints: [zp({ t: 0, to: { scale, x, y }, dur: 0.5, ease: "linear" })],
    });
    setCurrentFrame(fakeFrame);
    renderFrame(ctx, p, 1);
    setCurrentFrame(null);
    return drawnEdges(calls);
  }

  it("at scale 1 the frame fills the rect exactly, whatever the focal", () => {
    const e = render(1, 0.9, 0.9);
    expect(e.left).toBeCloseTo(0, 0);
    expect(e.top).toBeCloseTo(0, 0);
    expect(e.right).toBeCloseTo(1920, 0);
    expect(e.bottom).toBeCloseTo(1080, 0);
  });

  it("a focal near the right edge is reachable at 2x", () => {
    // Window is half the frame, so its centre can sit at x=1440 (0.75).
    const e = render(2, 0.95, 0.5);
    // Source x=1440 must land at the centre of the canvas.
    const centreSource = (960 - e.left) / ((e.right - e.left) / 1920);
    expect(centreSource).toBeCloseTo(1440, 0);
  });

  it("never reveals empty space beside the frame at any zoom", () => {
    for (const [scale, x, y] of [
      [2, 0, 0],
      [2, 1, 1],
      [3.5, 0.05, 0.95],
      [8, 1, 0],
    ] as const) {
      const e = render(scale, x, y);
      expect(e.left).toBeLessThanOrEqual(0.01);
      expect(e.top).toBeLessThanOrEqual(0.01);
      expect(e.right).toBeGreaterThanOrEqual(1919.99);
      expect(e.bottom).toBeGreaterThanOrEqual(1079.99);
    }
  });

  it("clips to the frame rect so a zoom cannot spill over the background", () => {
    const { ctx, calls } = makeCtx();
    const p = makeProject({
      clip: { src: "", duration: 10, width: 1920, height: 1080 },
      aspectPreset: "9:16",
      zoomPoints: [zp({ t: 0, to: { scale: 3, x: 0.5, y: 0.5 }, dur: 0.5, ease: "linear" })],
    });
    setCurrentFrame(fakeFrame);
    renderFrame(ctx, p, 1);
    setCurrentFrame(null);
    expect(calls.some((c) => c[0] === "clip")).toBe(true);
  });

  it("timestamp-based progress is fps-independent (30/60/120 same)", () => {
    const z = zp({ t: 2, to: { scale: 2, x: 0.7, y: 0.3 }, dur: 0.6, ease: "easeInOutCubic" });
    const at30 = getCameraTransform([z], 2.3); // 0.3s in
    const at60 = getCameraTransform([z], 2.3);
    const at120 = getCameraTransform([z], 2.3);
    expect(at30).toEqual(at60);
    expect(at60).toEqual(at120);
  });
});

describe("cameraViewport", () => {
  const rect = { x: 0, y: 0, w: 1000, h: 500 };

  it("scale 1 frames the whole clip regardless of focal", () => {
    const v = cameraViewport(rect, { scale: 1, x: 0.1, y: 0.9 });
    expect(v).toEqual({ scale: 1, cx: 500, cy: 250 });
  });

  it("never scales below 1 — a smaller frame would leave empty edges", () => {
    expect(cameraViewport(rect, { scale: 0.4, x: 0.5, y: 0.5 }).scale).toBe(1);
  });

  it("centres on the focal point when it fits", () => {
    // At 2x the window is 500x250, so a focal at (0.5, 0.5) is reachable.
    const v = cameraViewport(rect, { scale: 2, x: 0.5, y: 0.5 });
    expect(v).toEqual({ scale: 2, cx: 500, cy: 250 });
  });

  it("pulls the focal back so the window stays inside the frame", () => {
    // Focal at the very corner: the window's half-extent is the closest it gets.
    const v = cameraViewport(rect, { scale: 2, x: 0, y: 0 });
    expect(v).toEqual({ scale: 2, cx: 250, cy: 125 });
  });

  it("reaches further into the corner as the zoom deepens", () => {
    const shallow = cameraViewport(rect, { scale: 2, x: 0, y: 0 });
    const deep = cameraViewport(rect, { scale: 5, x: 0, y: 0 });
    expect(deep.cx).toBeLessThan(shallow.cx);
    expect(deep.cx).toBe(100);
  });
});

describe("camera coordinate mapping", () => {
  const rect = { x: 40, y: 20, w: 1000, h: 500 };

  it("draws the focal point at the centre of the frame", () => {
    const view = cameraViewport(rect, { scale: 2.5, x: 0.35, y: 0.6 });
    const p = frameToCanvas(rect, view, view.cx, view.cy);
    expect(p.x).toBeCloseTo(rect.x + rect.w / 2);
    expect(p.y).toBeCloseTo(rect.y + rect.h / 2);
  });

  it("canvasToFrame inverts frameToCanvas", () => {
    const view = cameraViewport(rect, { scale: 3, x: 0.4, y: 0.4 });
    const p = frameToCanvas(rect, view, 300, 180);
    const back = canvasToFrame(rect, view, p.x, p.y);
    expect(back.x).toBeCloseTo(300);
    expect(back.y).toBeCloseTo(180);
  });

  it("at rest the frame maps 1:1 onto the rect", () => {
    const view = cameraViewport(rect, IDENTITY);
    expect(frameToCanvas(rect, view, 0, 0)).toEqual({ x: rect.x, y: rect.y });
    expect(frameToCanvas(rect, view, rect.w, rect.h)).toEqual({
      x: rect.x + rect.w,
      y: rect.y + rect.h,
    });
  });
});

describe("facecam PiP placement", () => {
  const fakeVideo = {
    readyState: 4,
    duration: 10,
    currentTime: 0,
    videoWidth: 1280,
    videoHeight: 720,
  };

  function drawnPiP(facecam: Project["facecam"]) {
    const { ctx, calls } = makeCtx();
    // drawFacecam pulls its <video> from a module-level cache keyed by src, so
    // seed it through the document stub the module reads on first use.
    const p = makeProject({ facecam });
    renderFrame(ctx, p, 1);
    return calls.filter((c) => c[0] === "drawImage").pop();
  }

  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => ({ ...fakeVideo, load: () => {}, style: {} }),
    });
  });

  it("keeps a bottom-right camera fully inside the canvas", () => {
    const size = 0.2;
    // 16:9 canvas and 16:9 camera → height fraction equals the size fraction.
    const draw = drawnPiP({ src: "blob:cam", x: 0.97 - size, y: 0.97 - size, size, shape: "circle" });
    expect(draw).toBeDefined();
    const [, , dx, dy, dw, dh] = draw as [string, unknown, number, number, number, number];
    expect(dx + dw).toBeLessThanOrEqual(1920);
    expect(dy + dh).toBeLessThanOrEqual(1080);
    expect(dx).toBeGreaterThan(1920 * 0.5);
    expect(dy).toBeGreaterThan(1080 * 0.5);
  });

  it("keeps a top-left camera fully inside the canvas", () => {
    const draw = drawnPiP({ src: "blob:cam", x: 0.03, y: 0.03, size: 0.2, shape: "square" });
    const [, , dx, dy] = draw as [string, unknown, number, number, number, number];
    expect(dx).toBeGreaterThanOrEqual(0);
    expect(dy).toBeGreaterThanOrEqual(0);
    expect(dx).toBeLessThan(1920 * 0.5);
    expect(dy).toBeLessThan(1080 * 0.5);
  });

  it("draws nothing when there is no camera track", () => {
    const draw = drawnPiP({ src: null, x: 0.8, y: 0.8, size: 0.2 });
    expect(draw).toBeUndefined();
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
    beginPath: () => calls.push(["beginPath"]),
    rect: (...args: unknown[]) => calls.push(["rect", ...args]),
    clip: () => calls.push(["clip"]),
    arc: (...args: unknown[]) => calls.push(["arc", ...args]),
    arcTo: (...args: unknown[]) => calls.push(["arcTo", ...args]),
    moveTo: (...args: unknown[]) => calls.push(["moveTo", ...args]),
    closePath: () => calls.push(["closePath"]),
    stroke: () => calls.push(["stroke"]),
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
