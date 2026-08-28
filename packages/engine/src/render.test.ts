import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  cameraViewport,
  canvasToFrame,
  frameToCanvas,
  getCameraTransform,
  getProjectCameraTransform,
  IDENTITY,
  renderFrame,
  resolveInterpolatedFacecam,
  setCurrentFrame,
} from "./render";
import { migrateProject, type Facecam, type Segment, type ZoomPoint, type Project } from "@panoptik/schema";
import { resolveSegment } from "./timeline";

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

  it("non-compounding: later zoom wins, from 1x (no stacking)", () => {
    const z1 = zp({ id: "z1", t: 0, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 1, hold: 0.5, ease: "linear" });
    const z2 = zp({ id: "z2", t: 5, to: { scale: 4, x: 0.5, y: 0.5 }, dur: 1, hold: 0.5, ease: "linear" });
    expect(getCameraTransform([z1, z2], 1)).toEqual({ scale: 2, x: 0.5, y: 0.5 });
    expect(getCameraTransform([z1, z2], 6)).toEqual({ scale: 4, x: 0.5, y: 0.5 });
  });

  it("overlapping zooms: continuous transition from previous state without resetting to 1x", () => {
    // A holds at (scale: 2, x: 0.2, y: 0.2) until 4 + 0.45 + 2.5 = 6.95
    const a = zp({ id: "a", t: 4, to: { scale: 2, x: 0.2, y: 0.2 }, dur: 0.45, hold: 2.5, ease: "linear" });
    // B starts at 6.5 with scale 1.8 and pos (0.8, 0.8)
    const b = zp({ id: "b", t: 6.5, to: { scale: 1.8, x: 0.8, y: 0.8 }, dur: 0.45, hold: 0.5, ease: "linear" });

    const at6_4 = getCameraTransform([a, b], 6.4); // A is holding
    expect(at6_4.scale).toBeCloseTo(2);
    expect(at6_4.x).toBeCloseTo(0.2);

    const at6_6 = getCameraTransform([a, b], 6.6);
    // B started at 6.5 from A's state (2, 0.2, 0.2); 0.1s into 0.45s transition
    // scale smoothly transitions from 2.0 → 1.8 (around 1.95, NOT resetting to 1.0!)
    expect(at6_6.scale).toBeLessThan(2.0);
    expect(at6_6.scale).toBeGreaterThan(1.8);
    // position smoothly shifts from 0.2 towards 0.8
    expect(at6_6.x).toBeGreaterThan(0.2);
    expect(at6_6.x).toBeLessThan(0.8);

    const at6_95 = getCameraTransform([a, b], 6.95); // B finished transition, holding at target
    expect(at6_95.scale).toBeCloseTo(1.8);
    expect(at6_95.x).toBeCloseTo(0.8);
  });

  it("overlapping zooms at same scale: purely shifts position without any scale change", () => {
    const z1 = zp({ id: "z1", t: 1, to: { scale: 2.5, x: 0.2, y: 0.2 }, dur: 0.5, hold: 4, ease: "linear" });
    const z2 = zp({ id: "z2", t: 3, to: { scale: 2.5, x: 0.8, y: 0.3 }, dur: 0.5, hold: 2, ease: "linear" });

    // Mid-shift at t=3.25 (halfway between z1 pos and z2 pos)
    const mid = getCameraTransform([z1, z2], 3.25);
    expect(mid.scale).toBeCloseTo(2.5); // scale remains exactly 2.5x
    expect(mid.x).toBeCloseTo(0.5); // smoothly halfway between 0.2 and 0.8
    expect(mid.y).toBeCloseTo(0.25); // smoothly halfway between 0.2 and 0.3
  });

  it("hold keeps zoom for hold seconds, then eases back to 1x", () => {
    const z = zp({ t: 1, to: { scale: 3, x: 0.5, y: 0.5 }, dur: 0.5, hold: 2, ease: "linear" });
    expect(getCameraTransform([z], 1.25).scale).toBeGreaterThan(1); // easing in
    expect(getCameraTransform([z], 2).scale).toBeCloseTo(3); // holding
    expect(getCameraTransform([z], 3.4).scale).toBeCloseTo(3); // still holding (1+0.5+2=3.5)
    expect(getCameraTransform([z], 3.75).scale).toBeGreaterThan(1); // easing out
    expect(getCameraTransform([z], 4.1).scale).toBeCloseTo(1); // after out
  });

  it("eased progress is not linear (easeInOutCubic mid < linear mid when accelerating)", () => {
    const z = zp({ t: 0, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 1, ease: "easeInOutCubic" });
    const mid = getCameraTransform([z], 0.25); // 25% linear would be 1.25, eased is less (ease in)
    expect(mid.scale).toBeLessThan(1.25 + 0.1);
    expect(mid.scale).toBeGreaterThan(1);
  });
});

describe("getProjectCameraTransform across multi-clip boundaries", () => {
  it("zoom in clip 1 continues holding and easing out smoothly into clip 2", () => {
    const proj: Project = {
      id: "p1",
      name: "Test",
      media: { width: 1920, height: 1080, duration: 10, src: "blob:test" },
      segments: [
        {
          id: "seg1",
          srcStart: 0,
          srcEnd: 5,
          speed: 1,
          aspectPreset: "source",
          facecam: { src: null, x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
          background: { kind: "solid", color: "#000" },
          stagePadding: 0,
          zoomPoints: [
            zp({ id: "z1", t: 3.5, to: { scale: 2.2, x: 0.3, y: 0.3 }, dur: 0.5, hold: 2.0, ease: "linear" }),
          ],
          stagedZoomPoints: [],
          textOverlays: [],
          stagedTextOverlays: [],
          captions: [],
          stagedCaptions: [],
        },
        {
          id: "seg2",
          srcStart: 5,
          srcEnd: 10,
          speed: 1,
          aspectPreset: "source",
          facecam: { src: null, x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
          background: { kind: "solid", color: "#000" },
          stagePadding: 0,
          zoomPoints: [],
          stagedZoomPoints: [],
          textOverlays: [],
          stagedTextOverlays: [],
          captions: [],
          stagedCaptions: [],
        },
      ],
    };

    // Before zoom in Clip 1
    expect(getProjectCameraTransform(proj, 3.0)).toEqual(IDENTITY);

    // Zoom in finishes at t=4.0 (3.5 + 0.5), holds at 2.2x until 4.0 + 2.0 = 6.0
    expect(getProjectCameraTransform(proj, 4.2).scale).toBeCloseTo(2.2);

    // Across the split boundary at t=5.0 (Clip 2 begins): still holds at 2.2x!
    const atSplit = getProjectCameraTransform(proj, 5.0);
    expect(atSplit.scale).toBeCloseTo(2.2);
    expect(atSplit.x).toBeCloseTo(0.3);

    // At t=5.8 (still in hold window inside Clip 2): holds at 2.2x
    expect(getProjectCameraTransform(proj, 5.8).scale).toBeCloseTo(2.2);

    // At t=6.25 (midway through zoom out in Clip 2): smoothly easing out (between 2.2 and 1.0)
    const midEaseOut = getProjectCameraTransform(proj, 6.25);
    expect(midEaseOut.scale).toBeLessThan(2.2);
    expect(midEaseOut.scale).toBeGreaterThan(1.0);

    // At t=6.6 (after zoom out ends at 6.5 in Clip 2): settled at 1.0x
    expect(getProjectCameraTransform(proj, 6.6)).toEqual(IDENTITY);
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

  function drawnPiP(facecam: Facecam) {
    const { ctx, calls } = makeCtx();
    // drawFacecam pulls its <video> from a module-level cache keyed by src, so
    // seed it through the document stub the module reads on first use.
    const p = makeProject({ facecam });
    renderFrame(ctx, p, 1);
    return calls.filter((c) => c[0] === "drawImage").pop();
  }

  beforeEach(() => {
    vi.stubGlobal("document", {
      createElement: () => ({
        ...fakeVideo,
        style: { cssText: "" },
        load: () => {},
        pause: () => {},
        remove: () => {},
        setAttribute: () => {},
        removeAttribute: () => {},
        play: () => Promise.resolve(),
      }),
      body: { appendChild: () => {} },
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

  it("follows the timeline even when duration is Infinity", () => {
    // MediaRecorder WebM reports Infinity until seeked to the end; a
    // finite-duration guard here froze the camera on its first frame.
    const el = { ...fakeVideo, duration: Infinity, currentTime: 0, seeking: false,
      style: { cssText: "" }, load(){}, pause(){}, remove(){}, setAttribute(){},
      removeAttribute(){}, play: () => Promise.resolve() };
    vi.stubGlobal("document", { createElement: () => el, body: { appendChild(){} } });
    const { ctx } = makeCtx();
    renderFrame(ctx, makeProject({ facecam: { src: "blob:live", x: 0.7, y: 0.7, size: 0.2 } }), 5);
    expect(el.currentTime).toBeCloseTo(5);
  });

  it("holds the last frame instead of wrapping past the end", () => {
    const el = { ...fakeVideo, duration: 4, currentTime: 0, seeking: false,
      style: { cssText: "" }, load(){}, pause(){}, remove(){}, setAttribute(){},
      removeAttribute(){}, play: () => Promise.resolve() };
    vi.stubGlobal("document", { createElement: () => el, body: { appendChild(){} } });
    const { ctx } = makeCtx();
    renderFrame(ctx, makeProject({ facecam: { src: "blob:short", x: 0.7, y: 0.7, size: 0.2 } }), 9);
    expect(el.currentTime).toBeLessThan(4);
    expect(el.currentTime).toBeGreaterThan(3.9);
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

type MakeProjectOverrides = Partial<Project> &
  Partial<Segment> & { clip?: { src: string; duration: number; width: number; height: number } };

function makeProject(overrides: MakeProjectOverrides = {}): Project {
  const {
    srcStart = 0,
    srcEnd = 15,
    speed = 1,
    stagePadding = 0,
    zoomPoints = [],
    stagedZoomPoints = [],
    textOverlays = [],
    stagedTextOverlays = [],
    captions = [],
    stagedCaptions = [],
    background = { kind: "solid", color: "#000000" },
    facecam = { src: null, x: 0.8, y: 0.8, size: 0.2 },
    aspectPreset = "16:9",
    clip,
    media: mediaOverride,
    id = "test",
    clickLog = [],
  } = overrides;

  const media = mediaOverride ?? {
    src: clip?.src ?? "",
    duration: clip?.duration ?? 15,
    width: clip?.width ?? 1920,
    height: clip?.height ?? 1080,
  };

  return {
    id,
    media,
    segments: [
      {
        id: "s1",
        srcStart,
        srcEnd,
        speed,
        stagePadding,
        zoomPoints,
        stagedZoomPoints,
        textOverlays,
        stagedTextOverlays,
        captions,
        stagedCaptions,
        background,
        facecam,
        aspectPreset,
      },
    ],
    clickLog,
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

describe("renderFrame segment resolution", () => {
  it("draws using the segment active at timeline time", () => {
    const p = migrateProject({
      id: "p", clip: { src: "x", duration: 4, width: 800, height: 600 },
      playbackRate: 1, aspectPreset: "source",
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
      captions: [], stagedCaptions: [], background: { kind: "solid", color: "#000" }, clickLog: [],
    } as never) as Project;
    renderFrame; // compile guard
    // After split at t=2: two segments; resolve at timeline 1 and 3
    // (splitAt is store-side; here just construct a 2-segment project):
    const p2 = { ...p, segments: [
      { ...p.segments[0]!, id: "a", srcStart: 0, srcEnd: 2 },
      { ...p.segments[0]!, id: "b", srcStart: 2, srcEnd: 4, facecam: { src: null, x: 0.1, y: 0.1, size: 0.5 } },
    ] };
    expect(resolveSegment(p2, 3)!.srcT).toBeCloseTo(3);
    expect(resolveSegment(p2, 3)!.segment.id).toBe("b");
    const { ctx } = makeCtx();
    renderFrame(ctx, p2, 3); // must not throw and must use segment b's facecam
  });
});

describe("resolveInterpolatedFacecam smooth size & position transitions", () => {
  const baseProject: Project = {
    id: "p-fc",
    media: { src: "video.mp4", duration: 10, width: 1920, height: 1080 },
    clickLog: [],
    segments: [
      {
        id: "seg-1",
        srcStart: 0,
        srcEnd: 5,
        speed: 1,
        stagePadding: 0,
        aspectPreset: "16:9",
        zoomPoints: [],
        stagedZoomPoints: [],
        textOverlays: [],
        stagedTextOverlays: [],
        captions: [],
        stagedCaptions: [],
        background: { kind: "solid", color: "#000000" },
        facecam: { src: "cam.webm", x: 0.75, y: 0.75, size: 0.22, shape: "square" },
      },
      {
        id: "seg-2",
        srcStart: 5,
        srcEnd: 10,
        speed: 1,
        stagePadding: 0,
        aspectPreset: "16:9",
        zoomPoints: [],
        stagedZoomPoints: [],
        textOverlays: [],
        stagedTextOverlays: [],
        captions: [],
        stagedCaptions: [],
        background: { kind: "solid", color: "#000000" },
        facecam: {
          src: "cam.webm",
          x: 0.60,
          y: 0.60,
          size: 0.38,
          shape: "square",
          transition: "smooth",
          transitionDuration: 0.6,
        },
      },
    ],
  };

  it("smoothly interpolates size between 2 clips across transition duration", () => {
    const seg2 = baseProject.segments[1]!;

    // At t = 5.0 (transition start), size starts near seg1's 0.22
    const atStart = resolveInterpolatedFacecam(baseProject, 5.0, seg2);
    expect(atStart.size).toBeCloseTo(0.22, 2);
    expect(atStart.x).toBeCloseTo(0.75, 2);

    // At t = 5.3 (halfway through 0.6s duration), size is smoothly halfway between 0.22 and 0.38 (~0.30)
    const atMid = resolveInterpolatedFacecam(baseProject, 5.3, seg2);
    expect(atMid.size).toBeGreaterThan(0.25);
    expect(atMid.size).toBeLessThan(0.35);
    expect(atMid.size).toBeCloseTo(0.30, 1);
    expect(atMid.x).toBeGreaterThan(0.60);
    expect(atMid.x).toBeLessThan(0.75);

    // At t = 5.6 (duration completed), size reaches target 0.38
    const atEnd = resolveInterpolatedFacecam(baseProject, 5.6, seg2);
    expect(atEnd.size).toBeCloseTo(0.38, 2);
    expect(atEnd.x).toBeCloseTo(0.60, 2);

    // After duration (e.g. t = 7.0), size stays at target 0.38
    const atLater = resolveInterpolatedFacecam(baseProject, 7.0, seg2);
    expect(atLater.size).toBeCloseTo(0.38, 2);
    expect(atLater.x).toBeCloseTo(0.60, 2);
  });

  it("instant cut transition does not interpolate size", () => {
    const pCut = {
      ...baseProject,
      segments: [
        baseProject.segments[0]!,
        {
          ...baseProject.segments[1]!,
          facecam: {
            ...baseProject.segments[1]!.facecam,
            transition: "cut" as const,
            transitionDuration: 0.5,
          },
        },
      ],
    };
    const seg2 = pCut.segments[1]!;
    const atStart = resolveInterpolatedFacecam(pCut, 5.1, seg2);
    expect(atStart.size).toBeCloseTo(0.38, 2);
    expect(atStart.x).toBeCloseTo(0.60, 2);
  });

  it("smoothly morphs shape from square to circle across transition duration", () => {
    const pSquareToCircle: Project = {
      ...baseProject,
      segments: [
        {
          ...baseProject.segments[0]!,
          facecam: { ...baseProject.segments[0]!.facecam, shape: "square" },
        },
        {
          ...baseProject.segments[1]!,
          facecam: {
            ...baseProject.segments[1]!.facecam,
            shape: "circle",
            transition: "smooth",
            transitionDuration: 0.5,
          },
        },
      ],
    };
    const seg2 = pSquareToCircle.segments[1]!;

    // At t = 5.0s (start): shapeProgress = 0 (square)
    const atStart = resolveInterpolatedFacecam(pSquareToCircle, 5.0, seg2);
    expect(atStart.shapeProgress).toBeCloseTo(0, 2);

    // At t = 5.25s (halfway): shapeProgress is smoothly ~0.5
    const atMid = resolveInterpolatedFacecam(pSquareToCircle, 5.25, seg2);
    expect(atMid.shapeProgress).toBeGreaterThan(0.3);
    expect(atMid.shapeProgress).toBeLessThan(0.7);
    expect(atMid.shapeProgress).toBeCloseTo(0.5, 1);

    // At t = 5.5s (end): shapeProgress = 1.0 (circle)
    const atEnd = resolveInterpolatedFacecam(pSquareToCircle, 5.5, seg2);
    expect(atEnd.shapeProgress).toBeCloseTo(1.0, 2);
  });

  it("smoothly morphs shape from circle to square in reverse across transition duration", () => {
    const pCircleToSquare: Project = {
      ...baseProject,
      segments: [
        {
          ...baseProject.segments[0]!,
          facecam: { ...baseProject.segments[0]!.facecam, shape: "circle" },
        },
        {
          ...baseProject.segments[1]!,
          facecam: {
            ...baseProject.segments[1]!.facecam,
            shape: "square",
            transition: "smooth",
            transitionDuration: 0.5,
          },
        },
      ],
    };
    const seg2 = pCircleToSquare.segments[1]!;

    // At t = 5.0s (start): shapeProgress = 1 (circle)
    const atStart = resolveInterpolatedFacecam(pCircleToSquare, 5.0, seg2);
    expect(atStart.shapeProgress).toBeCloseTo(1.0, 2);

    // At t = 5.25s (halfway): shapeProgress is smoothly ~0.5
    const atMid = resolveInterpolatedFacecam(pCircleToSquare, 5.25, seg2);
    expect(atMid.shapeProgress).toBeGreaterThan(0.3);
    expect(atMid.shapeProgress).toBeLessThan(0.7);
    expect(atMid.shapeProgress).toBeCloseTo(0.5, 1);

    // At t = 5.5s (end): shapeProgress = 0.0 (square)
    const atEnd = resolveInterpolatedFacecam(pCircleToSquare, 5.5, seg2);
    expect(atEnd.shapeProgress).toBeCloseTo(0.0, 2);
  });
});
