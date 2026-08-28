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
    expect(project.clip.duration).toBe(10);
    expect(project.clip.width).toBe(1920);
    expect(project.clip.height).toBe(1080);
    expect(project.zoomPoints).toEqual([]);
    expect(project.background).toEqual({ kind: "solid", color: "#000000" });
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
