import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./projectStore";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";

const fresh = () =>
  useProjectStore.getState().setProject(structuredClone(mockProject()));
const zp = (id: string, t: number) =>
  ({
    id,
    t,
    to: { scale: 2, x: 0.5, y: 0.5 },
    dur: 0.5,
    ease: "linear",
    staged: true,
  }) as const;

describe("projectStore", () => {
  beforeEach(fresh);

  it("addZoomPoint commits immediately and pushes history", () => {
    const before = useProjectStore.getState().historyIndex;
    useProjectStore.getState().addZoomPoint({
      t: 9,
      to: { scale: 2, x: 0.5, y: 0.5 },
      dur: 0.7,
      ease: "easeInOutCubic",
    });
    const s = useProjectStore.getState();
    expect(
      s.project!.zoomPoints.some((z) => z.t === 9),
    ).toBe(true);
    expect(s.historyIndex).toBe(before + 1);
  });

  it("staging adds ghosts without touching committed state or history", () => {
    const before =
      useProjectStore.getState().project!.zoomPoints.length;
    useProjectStore
      .getState()
      .stageZoomProposals([zp("ghost-1", 12)]);
    const s = useProjectStore.getState();
    expect(s.project!.stagedZoomPoints).toHaveLength(1);
    expect(s.project!.zoomPoints).toHaveLength(before);
    expect(s.historyIndex).toBe(0);
  });

  it("getStagedDiff counts across kinds", () => {
    const s0 = useProjectStore.getState();
    // mockProject starts with 1 stagedTextOverlay — clear it first
    s0.clearStaged();
    s0.stageZoomProposals([zp("g", 1)]);
    s0.stageCaptions([{ text: "hi", start: 0, end: 1 }]);
    expect(s0.getStagedDiff().totalCount).toBe(2);
  });

  it("commitAll merges staged into committed and clears staged", () => {
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 2)]);
    s0.commitAll();
    const s1 = useProjectStore.getState();
    expect(s1.project!.stagedZoomPoints).toHaveLength(0);
    expect(
      s1.project!.zoomPoints.find((z) => z.id === "g")
        ?.staged,
    ).toBe(false);
  });

  it("undo reverts a commit, redo reapplies; boundaries never throw", () => {
    const countBefore =
      useProjectStore.getState().project!.zoomPoints.length;
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 4)]);
    s0.commitAll();
    useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().project!.zoomPoints.length,
    ).toBe(countBefore);
    useProjectStore.getState().redo();
    expect(
      useProjectStore.getState().project!.zoomPoints.length,
    ).toBe(countBefore + 1);
    const s = useProjectStore.getState();
    s.undo();
    s.undo();
    s.redo();
    s.redo();
    expect(s.historyIndex).toBeLessThanOrEqual(
      s.history.length - 1,
    );
  });

  it("clearStaged discards ghosts and reverts pending background", () => {
    const origBg = structuredClone(
      useProjectStore.getState().project!.background,
    );
    const s = useProjectStore.getState();
    s.stageBackground({ kind: "solid", color: "#ff0000" });
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(true);
    s.clearStaged();
    expect(
      useProjectStore.getState().project!.background,
    ).toEqual(origBg);
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(false);
  });

  it("removeStagedZoom drops one ghost only", () => {
    const s = useProjectStore.getState();
    s.stageZoomProposals([zp("a", 1), zp("b", 2)]);
    s.removeStagedZoom("a");
    expect(
      useProjectStore
        .getState()
        .project!.stagedZoomPoints.map((z) => z.id),
    ).toEqual(["b"]);
  });

  it("removeStagedTextOverlay drops one ghost only", () => {
    const s = useProjectStore.getState();
    // Clear mockProject's initial staged text overlays first
    s.clearStaged();
    s.stageTextOverlay({
      id: "txt-a",
      text: "hello",
      timestamp: 1,
      position: "top",
      staged: true,
    });
    s.stageTextOverlay({
      id: "txt-b",
      text: "world",
      timestamp: 2,
      position: "bottom",
      staged: true,
    });
    s.removeStagedTextOverlay("txt-a");
    expect(
      useProjectStore
        .getState()
        .project!.stagedTextOverlays.map((t) => t.id),
    ).toEqual(["txt-b"]);
  });

  it("stageBackground sets badge, commitAll clears it", () => {
    const s = useProjectStore.getState();
    s.stageBackground({
      kind: "gradient",
      stops: ["#ff0000", "#0000ff"],
    });
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(true);
    useProjectStore.getState().commitAll();
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(false);
  });

  it("markMoment appends to clickLog", () => {
    const before =
      useProjectStore.getState().project!.clickLog.length;
    useProjectStore.getState().markMoment(5.5);
    const log =
      useProjectStore.getState().project!.clickLog;
    expect(log).toHaveLength(before + 1);
    expect(log[log.length - 1]).toEqual({
      t: 5.5,
      x: 0.5,
      y: 0.5,
      type: "manual",
    });
  });

  it("play/pause/togglePlay work", () => {
    const s = useProjectStore.getState();
    expect(s.isPlaying).toBe(false);
    s.play();
    expect(useProjectStore.getState().isPlaying).toBe(true);
    s.togglePlay();
    expect(useProjectStore.getState().isPlaying).toBe(false);
    s.togglePlay();
    expect(useProjectStore.getState().isPlaying).toBe(true);
    s.pause();
    expect(useProjectStore.getState().isPlaying).toBe(false);
  });

  it("play restarts from the top once the clip has finished", () => {
    const duration = useProjectStore.getState().project!.clip.duration;
    // Playback parks the playhead at the end; play there should replay, not
    // sit at the end and stop again immediately.
    useProjectStore.getState().setCurrentTime(duration);
    useProjectStore.getState().play();
    expect(useProjectStore.getState().currentTime).toBe(0);
    expect(useProjectStore.getState().isPlaying).toBe(true);
  });

  it("togglePlay also restarts from the end", () => {
    const duration = useProjectStore.getState().project!.clip.duration;
    useProjectStore.getState().setCurrentTime(duration);
    useProjectStore.getState().togglePlay();
    expect(useProjectStore.getState().currentTime).toBe(0);
    expect(useProjectStore.getState().isPlaying).toBe(true);
  });

  it("play mid-clip resumes where it was", () => {
    useProjectStore.getState().setCurrentTime(3);
    useProjectStore.getState().play();
    expect(useProjectStore.getState().currentTime).toBe(3);
  });

  it("pausing at the end does not rewind", () => {
    const duration = useProjectStore.getState().project!.clip.duration;
    useProjectStore.getState().setCurrentTime(duration);
    useProjectStore.getState().play();
    useProjectStore.getState().setCurrentTime(duration);
    useProjectStore.getState().togglePlay(); // pause
    expect(useProjectStore.getState().isPlaying).toBe(false);
    expect(useProjectStore.getState().currentTime).toBe(duration);
  });

  it("seek sets time and pauses", () => {
    useProjectStore.getState().play();
    useProjectStore.getState().seek(5.5);
    const s = useProjectStore.getState();
    expect(s.currentTime).toBe(5.5);
    expect(s.isPlaying).toBe(false);
  });

  it("selectedZoomId tracks correctly", () => {
    const s = useProjectStore.getState();
    expect(s.selectedZoomId).toBeNull();
    s.setSelectedZoom("z1");
    expect(
      useProjectStore.getState().selectedZoomId,
    ).toBe("z1");
    s.setSelectedZoom(null);
    expect(
      useProjectStore.getState().selectedZoomId,
    ).toBeNull();
  });

  it("removeZoomPoint clears selectedZoomId if it matches", () => {
    useProjectStore.getState().setSelectedZoom("z1");
    useProjectStore.getState().removeZoomPoint("z1");
    expect(
      useProjectStore.getState().selectedZoomId,
    ).toBeNull();
  });

  it("multi-step undo/redo across feature kinds", () => {
    const s = useProjectStore.getState();
    // add zoom
    s.stageZoomProposals([zp("g1", 2)]);
    s.commitAll();
    // set background
    s.stageBackground({ kind: "solid", color: "#ff0000" });
    s.commitAll();
    // add text
    s.stageTextOverlay({
      id: "t1",
      text: "hi",
      timestamp: 3,
      position: "top",
      staged: true,
    });
    s.commitAll();

    const fullIdx =
      useProjectStore.getState().historyIndex;

    // undo all 3
    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().historyIndex,
    ).toBe(0);

    // redo all 3
    useProjectStore.getState().redo();
    useProjectStore.getState().redo();
    useProjectStore.getState().redo();
    expect(
      useProjectStore.getState().historyIndex,
    ).toBe(fullIdx);
  });

  it("clearStagedCaptions removes only staged captions", () => {
    const s = useProjectStore.getState();
    s.stageCaptions([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
    ]);
    expect(
      useProjectStore.getState().project!.stagedCaptions,
    ).toHaveLength(2);
    useProjectStore.getState().clearStagedCaptions();
    expect(
      useProjectStore.getState().project!.stagedCaptions,
    ).toHaveLength(0);
  });

  it("playbackRate defaults to 1 and clamps 0.25–3", () => {
    const s = useProjectStore.getState();
    expect(s.playbackRate).toBe(1);
    s.setPlaybackRate(10);
    expect(useProjectStore.getState().playbackRate).toBe(3);
    s.setPlaybackRate(0);
    expect(useProjectStore.getState().playbackRate).toBe(0.25);
    s.setPlaybackRate(1.33);
    expect(useProjectStore.getState().playbackRate).toBeCloseTo(1.35, 1);
  });

  it("effectiveDuration divides clip duration", () => {
    useProjectStore.getState().setProject(structuredClone(mockProject()));
    const dur = useProjectStore.getState().project!.clip.duration; // 15 from mock
    useProjectStore.getState().setPlaybackRate(2);
    expect(useProjectStore.getState().project!.clip.duration / useProjectStore.getState().playbackRate).toBe(dur / 2);
    useProjectStore.getState().setPlaybackRate(0.5);
    expect(useProjectStore.getState().project!.clip.duration / useProjectStore.getState().playbackRate).toBe(dur / 0.5);
  });

  it("persists playbackRate across reload", () => {
    const s = useProjectStore.getState();
    // Mock localStorage for node environment
    const store: Record<string, string> = {};
    const mockLS = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
    } as unknown as Storage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = mockLS;
    // Also ensure window.localStorage if exists
    if (typeof window !== "undefined") (window as unknown as { localStorage: Storage }).localStorage = mockLS;
    s.setPlaybackRate(2.5);
    expect(mockLS.getItem("panoptik:playbackRate")).toBe("2.5");
  });
});
