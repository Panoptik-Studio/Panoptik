import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("mediabunny", () => {
  return {
    ALL_FORMATS: "all",
    BlobSource: vi.fn().mockImplementation((f: File) => ({ file: f })),
    Input: vi.fn().mockImplementation(() => ({
      getPrimaryVideoTrack: vi.fn().mockResolvedValue({
        canDecode: vi.fn().mockResolvedValue(true),
        computeDuration: vi.fn().mockResolvedValue(10),
        displayWidth: 1920,
        displayHeight: 1080,
      }),
    })),
    VideoSampleSink: vi.fn().mockImplementation(() => ({
      getSample: vi.fn().mockImplementation(async (t: number) => ({
        t,
        close: vi.fn(),
        draw: vi.fn(),
      })),
    })),
  };
});

// Fresh import per test file — module-level cached state is reset by vi.resetModules()
const loadFresh = async () => {
  vi.resetModules();
  const mod = await import("./decode");
  return mod;
};

describe("decode", () => {
  it("loadClip returns a valid Project", async () => {
    const { loadClip } = await loadFresh();
    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    const project = await loadClip(file);
    expect(project.clip.duration).toBe(10);
    expect(project.clip.width).toBe(1920);
    expect(project.clip.height).toBe(1080);
    expect(project.zoomPoints).toEqual([]);
    expect(project.background).toEqual({ kind: "solid", color: "#000000" });
  });

  it("prepareFrame caches sample at given time", async () => {
    const { loadClip, prepareFrame, currentFrame } = await loadFresh();
    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
    await loadClip(file);
    await prepareFrame(2.5);
    expect(currentFrame()).not.toBeNull();
  });

  it("prepareFrame does not re-fetch if time unchanged", async () => {
    const { loadClip, prepareFrame, currentFrame } = await loadFresh();
    const file = new File(["dummy"], "test.mp4", { type: "video/mp4" });
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
});
