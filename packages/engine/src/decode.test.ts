import { describe, expect, it, vi, beforeEach } from "vitest";

const FPS = 30;

/** Counts of the calls the old ring-buffer path made per displayed frame. */
const stats = { seeks: 0, framesDecoded: 0 };

vi.mock("mediabunny", () => {
  return {
    ALL_FORMATS: "all",
    BlobSource: vi.fn().mockImplementation((f: File) => ({ file: f })),
    AudioBufferSink: vi.fn().mockImplementation((track: { id: string }) => ({ track })),
    Input: vi.fn().mockImplementation((opts: { source: { file: { name?: string } } }) => {
      const name = opts?.source?.file?.name ?? "";
      return {
        getPrimaryVideoTrack: vi.fn().mockResolvedValue({
          canDecode: vi.fn().mockResolvedValue(true),
          computeDuration: vi.fn().mockResolvedValue(10),
          getDisplayWidth: vi.fn().mockResolvedValue(1920),
          getDisplayHeight: vi.fn().mockResolvedValue(1080),
        }),
        // Only the file standing in for the camera recording carries the mic.
        getPrimaryAudioTrack: vi.fn().mockResolvedValue(
          name.includes("mic") ? { id: "mic-track", canDecode: vi.fn().mockResolvedValue(true) } : null,
        ),
        dispose: vi.fn(),
      };
    }),
    CanvasSink: vi.fn().mockImplementation(() => ({
      // Yields frames on an FPS grid starting at the frame covering `start`.
      canvases: (start = 0) => {
        stats.seeks++;
        let ts = Math.floor(start * FPS) / FPS;
        return (async function* () {
          while (ts < 10) {
            stats.framesDecoded++;
            yield { canvas: { _mock: true, ts }, timestamp: ts, duration: 1 / FPS };
            ts += 1 / FPS;
          }
        })();
      },
    })),
  };
});

// Fresh import per test file — module-level cached state is reset by vi.resetModules()
const loadFresh = async () => {
  vi.resetModules();
  const mod = await import("./decode");
  return mod;
};

beforeEach(() => {
  stats.seeks = 0;
  stats.framesDecoded = 0;
});

describe("decode", () => {
  it("loadClip returns a valid Project", async () => {
    const { loadClip } = await loadFresh();
    const file = new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" });
    const project = await loadClip(file);
    expect(project.media[0]!.duration).toBe(10);
    expect(project.media[0]!.width).toBe(1920);
    expect(project.media[0]!.height).toBe(1080);
    expect(project.segments).toHaveLength(1);
    expect(project.segments[0]!.srcStart).toBe(0);
    expect(project.segments[0]!.srcEnd).toBe(10);
    expect(project.segments[0]!.speed).toBe(1);
    expect(project.segments[0]!.facecam.src).toBeNull();
    expect(project.segments[0]!.zoomPoints).toEqual([]);
    expect(project.segments[0]!.background).toEqual({ kind: "solid", color: "#000000" });
  });

  it("prepareFrame caches sample at given time", async () => {
    const { loadClip, prepareFrame, currentFrame } = await loadFresh();
    const file = new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" });
    await loadClip(file);
    await prepareFrame(2.5);
    expect(currentFrame()).not.toBeNull();
  });

  it("prepareFrame does not re-fetch if time unchanged", async () => {
    const { loadClip, prepareFrame, currentFrame } = await loadFresh();
    const file = new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" });
    await loadClip(file);
    await prepareFrame(2.5);
    const first = currentFrame();
    await prepareFrame(2.5);
    expect(currentFrame()).toBe(first);
  });

  it("currentFrame returns null before any prepareFrame", async () => {
    const { currentFrame } = await loadFresh();
    expect(currentFrame()).toBeNull();
  });

  it("playback steps one iterator instead of seeking per frame", async () => {
    const { loadClip, prepareFrame } = await loadFresh();
    await loadClip(new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" }));
    stats.seeks = 0;
    stats.framesDecoded = 0;

    // Two seconds of 60fps rAF ticks over a 30fps source.
    for (let i = 0; i < 120; i++) {
      await prepareFrame(i / 60);
    }

    expect(stats.seeks).toBe(1);
    expect(stats.framesDecoded).toBeLessThanOrEqual(2 * FPS + 2);
  });

  it("overlapping prepareFrame calls coalesce onto one decode", async () => {
    const { loadClip, prepareFrame } = await loadFresh();
    await loadClip(new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" }));
    stats.seeks = 0;
    stats.framesDecoded = 0;

    // Fire without awaiting, the way a rAF loop does.
    await Promise.all(
      Array.from({ length: 60 }, (_, i) => prepareFrame(i / 60)),
    );

    expect(stats.seeks).toBe(1);
    expect(stats.framesDecoded).toBeLessThanOrEqual(FPS + 2);
  });

  it("seeking backwards restarts the iterator", async () => {
    const { loadClip, prepareFrame } = await loadFresh();
    await loadClip(new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" }));
    await prepareFrame(5);
    stats.seeks = 0;

    await prepareFrame(1);
    expect(stats.seeks).toBe(1);
  });

  it("a far forward jump seeks rather than decoding the gap", async () => {
    const { loadClip, prepareFrame } = await loadFresh();
    await loadClip(new File([new Uint8Array(2048)], "test.mp4", { type: "video/mp4" }));
    await prepareFrame(0);
    stats.seeks = 0;
    stats.framesDecoded = 0;

    await prepareFrame(8);
    expect(stats.seeks).toBe(1);
    expect(stats.framesDecoded).toBeLessThanOrEqual(2);
  });
});

describe("audio routing", () => {
  const silentScreen = () => new File([new Uint8Array(2048)], "screen.webm", { type: "video/webm" });
  const micRecording = () => new File([new Uint8Array(2048)], "mic-camera.webm", { type: "video/webm" });

  it("a screen recording on its own has no audio", async () => {
    const { loadClip } = await loadFresh();
    const { getAudioSinkTrackId } = await import("./audio");
    await loadClip(silentScreen());
    // getDisplayMedia captures with audio:false, so this is expected...
    expect(getAudioSinkTrackId()).toBeNull();
  });

  it("takes audio from the camera recording, where the mic actually is", async () => {
    const mod = await loadFresh();
    const { getAudioSinkTrackId } = await import("./audio");
    await mod.loadClip(silentScreen());
    // ...and this is the step that was missing: narration was recorded into the
    // camera blob and then never read back.
    await mod.setAudioBlob(micRecording());
    expect(getAudioSinkTrackId()).toBe("mic-track");
  });

  it("does not leak one take's audio into the next", async () => {
    const mod = await loadFresh();
    const { getAudioSinkTrackId } = await import("./audio");
    await mod.loadClip(silentScreen());
    await mod.setAudioBlob(micRecording());
    expect(getAudioSinkTrackId()).toBe("mic-track");

    // Importing a silent clip afterwards must not keep playing the old mic.
    await mod.loadClip(silentScreen());
    expect(getAudioSinkTrackId()).toBeNull();
  });
});

describe("variable-rate footage", () => {
  const file = () => new File([new Uint8Array(2048)], "screen.webm", { type: "video/webm" });

  it("settles on a time that falls in a hole between frames", async () => {
    // A screen recording emits nothing while the picture is still. Here there
    // is no frame covering 22.800 — 22.760 ends at 22.778 and the next starts
    // at 22.808 — which is the shape that stalled a real export.
    const FRAMES = [
      { timestamp: 22.742, duration: 0.018 },
      { timestamp: 22.760, duration: 0.018 },
      { timestamp: 22.808, duration: 0.018 },
      // A long tail: decoding through it to look for a cover is the failure.
      ...Array.from({ length: 400 }, (_, i) => ({ timestamp: 23 + i * 0.018, duration: 0.018 })),
    ];
    let decoded = 0;

    vi.resetModules();
    vi.doMock("mediabunny", () => ({
      ALL_FORMATS: "all",
      BlobSource: vi.fn().mockImplementation((f: File) => ({ file: f })),
      AudioBufferSink: vi.fn(),
      Input: vi.fn().mockImplementation(() => ({
        getPrimaryVideoTrack: vi.fn().mockResolvedValue({
          canDecode: vi.fn().mockResolvedValue(true),
          computeDuration: vi.fn().mockResolvedValue(40),
          getDisplayWidth: vi.fn().mockResolvedValue(1920),
          getDisplayHeight: vi.fn().mockResolvedValue(1080),
        }),
        getPrimaryAudioTrack: vi.fn().mockResolvedValue(null),
        dispose: vi.fn(),
      })),
      CanvasSink: vi.fn().mockImplementation(() => ({
        canvases: (start = 0) => {
          const from = FRAMES.filter((f) => f.timestamp + f.duration > start);
          return (async function* () {
            for (const f of from) {
              decoded++;
              yield { canvas: { _mock: true }, ...f };
            }
          })();
        },
      })),
    }));

    const mod = await import("./decode");
    await mod.loadClip(file());

    decoded = 0;
    await Promise.race([
      mod.prepareFrame(22.8),
      new Promise((_, reject) => setTimeout(() => reject(new Error("pump did not settle")), 3000)),
    ]);

    // It should stop at the first frame past the hole, not chew through the
    // remaining 400.
    expect(decoded).toBeLessThan(10);

    // And the hole must now read as covered, so the next request is a hit
    // rather than another scan.
    const afterFirst = decoded;
    await mod.prepareFrame(22.8);
    expect(decoded).toBe(afterFirst);

    vi.doUnmock("mediabunny");
  });
});

describe("facecam during export", () => {
  const camFile = () => new File([new Uint8Array(2048)], "cam.webm", { type: "video/webm" });

  /**
   * The camera track has holes just like the screen does. Hunting for a frame
   * that contains the requested time drains the iterator on the first hole and
   * then the camera is frozen for every remaining frame of the export — the
   * stall that the export path used to race a 200ms timeout against.
   */
  it("crosses a hole without draining the rest of the camera track", async () => {
    const FRAMES = [
      { timestamp: 2.60, duration: 0.033 },
      { timestamp: 2.65, duration: 0.033 },
      // Nothing covers 2.7: 2.65 ends at 2.683 and the next starts at 2.90.
      { timestamp: 2.90, duration: 0.033 },
      ...Array.from({ length: 400 }, (_, i) => ({ timestamp: 3 + i * 0.033, duration: 0.033 })),
    ];
    let decoded = 0;

    vi.resetModules();
    vi.doMock("mediabunny", () => ({
      ALL_FORMATS: "all",
      BlobSource: vi.fn().mockImplementation((f: File) => ({ file: f })),
      AudioBufferSink: vi.fn(),
      Input: vi.fn().mockImplementation(() => ({
        getPrimaryVideoTrack: vi.fn().mockResolvedValue({
          canDecode: vi.fn().mockResolvedValue(true),
          computeDuration: vi.fn().mockResolvedValue(20),
          getDisplayWidth: vi.fn().mockResolvedValue(640),
          getDisplayHeight: vi.fn().mockResolvedValue(480),
        }),
        getPrimaryAudioTrack: vi.fn().mockResolvedValue(null),
        dispose: vi.fn(),
      })),
      CanvasSink: vi.fn().mockImplementation(() => ({
        canvases: (start = 0) => {
          const from = FRAMES.filter((f) => f.timestamp + f.duration > start);
          return (async function* () {
            for (const f of from) {
              decoded++;
              yield { canvas: { _mock: true }, ...f };
            }
          })();
        },
      })),
    }));

    const mod = await import("./decode");
    (globalThis as unknown as { window: Record<string, unknown> }).window = { __isExporting: true };
    await mod.setFacecamBlob(camFile());

    // Walk up to the hole, then straight through it.
    await mod.prepareFacecamFrame(2.6);
    decoded = 0;
    await Promise.race([
      mod.prepareFacecamFrame(2.7),
      new Promise((_, reject) => setTimeout(() => reject(new Error("facecam stalled on the hole")), 3000)),
    ]);
    expect(decoded).toBeLessThan(10);

    // The hole must now read as covered. If the frame past it were recorded as
    // starting at 2.90, asking for 2.7 again would look like a backwards seek
    // and rewind the iterator to 0 — re-decoding the track once per frame.
    decoded = 0;
    await mod.prepareFacecamFrame(2.7);
    expect(decoded).toBe(0);

    // The camera must keep advancing after the hole rather than being pinned
    // to one frame for the rest of the export.
    decoded = 0;
    await mod.prepareFacecamFrame(3.5);
    expect(decoded).toBeGreaterThan(0);

    await mod.resetFacecamExportIterator();
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.doUnmock("mediabunny");
  });
});
