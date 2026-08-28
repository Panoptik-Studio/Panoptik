import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./projectStore";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";
import { projectDuration } from "@panoptik/engine";
import {
  migrateProject,
  type Project,
  type Segment,
} from "@panoptik/schema";

const fresh = () =>
  useProjectStore.getState().setProject(structuredClone(mockProject()));
const seg = () => {
  const s = useProjectStore.getState();
  return s.project!.segments.find(
    (x) => x.id === s.selectedSegmentId,
  )!;
};
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
      seg().zoomPoints.some((z) => z.t === 9),
    ).toBe(true);
    expect(s.historyIndex).toBe(before + 1);
  });

  it("staging adds ghosts without touching committed state or history", () => {
    const before = seg().zoomPoints.length;
    useProjectStore
      .getState()
      .stageZoomProposals([zp("ghost-1", 12)]);
    const s = useProjectStore.getState();
    expect(seg().stagedZoomPoints).toHaveLength(1);
    expect(seg().zoomPoints).toHaveLength(before);
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
    expect(seg().stagedZoomPoints).toHaveLength(0);
    expect(
      seg().zoomPoints.find((z) => z.id === "g")
        ?.staged,
    ).toBe(false);
  });

  it("undo reverts a commit, redo reapplies; boundaries never throw", () => {
    const countBefore = seg().zoomPoints.length;
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 4)]);
    s0.commitAll();
    useProjectStore.getState().undo();
    expect(seg().zoomPoints.length).toBe(countBefore);
    useProjectStore.getState().redo();
    expect(seg().zoomPoints.length).toBe(countBefore + 1);
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
    const origBg = structuredClone(seg().background);
    const s = useProjectStore.getState();
    s.stageBackground({ kind: "solid", color: "#ff0000" });
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(true);
    s.clearStaged();
    expect(seg().background).toEqual(origBg);
    expect(
      useProjectStore.getState().pendingBackgroundBadge,
    ).toBe(false);
  });

  it("removeStagedZoom drops one ghost only", () => {
    const s = useProjectStore.getState();
    s.stageZoomProposals([zp("a", 1), zp("b", 2)]);
    s.removeStagedZoom("a");
    expect(seg().stagedZoomPoints.map((z) => z.id)).toEqual(["b"]);
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
    expect(seg().stagedTextOverlays.map((t) => t.id)).toEqual(["txt-b"]);
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
    const duration = projectDuration(useProjectStore.getState().project!);
    // Playback parks the playhead at the end; play there should replay, not
    // sit at the end and stop again immediately.
    useProjectStore.getState().setCurrentTime(duration);
    useProjectStore.getState().play();
    expect(useProjectStore.getState().currentTime).toBe(0);
    expect(useProjectStore.getState().isPlaying).toBe(true);
  });

  it("togglePlay also restarts from the end", () => {
    const duration = projectDuration(useProjectStore.getState().project!);
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
    const duration = projectDuration(useProjectStore.getState().project!);
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
    expect(seg().stagedCaptions).toHaveLength(2);
    useProjectStore.getState().clearStagedCaptions();
    expect(seg().stagedCaptions).toHaveLength(0);
  });

  it("segment speed starts at 1 from migration and drives duration", () => {
    const s = useProjectStore.getState();
    expect(s.selectedSegmentId).toBe(seg().id);
    expect(seg().speed).toBe(1);
    // mock clip is 15s at 1x → whole project duration
    expect(projectDuration(s.project!)).toBe(15);
    // speed up the selected segment → shorter timeline
    s.updateSegment(seg().id, { speed: 2 });
    expect(projectDuration(useProjectStore.getState().project!)).toBeCloseTo(
      7.5,
    );
  });

  it("setStagePadding/setAspectPreset forward to the selected segment", () => {
    const s = useProjectStore.getState();
    s.setStagePadding(32);
    s.setAspectPreset("1:1");
    expect(seg().stagePadding).toBe(32);
    expect(seg().aspectPreset).toBe("1:1");
  });

  it("splitAt is a no-op at the timeline boundaries", () => {
    useProjectStore.getState().setProject(singleSegProject());
    useProjectStore.getState().splitAt(0);
    useProjectStore.getState().splitAt(10);
    expect(useProjectStore.getState().project!.segments).toHaveLength(1);
  });
});

function singleSegProject(overrides?: Partial<Segment>): Project {
  return migrateProject({
    id: "p",
    clip: { src: "blob:v", duration: 10, width: 800, height: 600 },
    playbackRate: 1,
    aspectPreset: "source",
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [],
    stagedZoomPoints: [],
    textOverlays: [],
    stagedTextOverlays: [],
    captions: [],
    stagedCaptions: [],
    background: { kind: "solid", color: "#000" },
    clickLog: [],
    ...overrides,
  } as never) as Project;
}

describe("segment split + selection", () => {
  it("splitAt divides the containing segment into two covering the full range", () => {
    useProjectStore.getState().setProject(singleSegProject());
    useProjectStore.getState().splitAt(4); // 0..4 and 4..10 at 1x
    const { project } = useProjectStore.getState();
    expect(project!.segments).toHaveLength(2);
    expect(project!.segments[0]!.srcEnd).toBe(project!.segments[1]!.srcStart);
    expect(project!.segments[1]!.srcEnd).toBe(10);
  });

  it("updateSegment only mutates the targeted segment's speed", () => {
    useProjectStore.getState().setProject(singleSegProject());
    useProjectStore.getState().splitAt(4);
    useProjectStore
      .getState()
      .updateSegment(useProjectStore.getState().project!.segments[0]!.id, {
        speed: 2,
      });
    const segs = useProjectStore.getState().project!.segments;
    expect(segs[0]!.speed).toBe(2);
    expect(segs[1]!.speed).toBe(1);
  });

  it("setFacecam targets the selected segment", () => {
    useProjectStore.getState().setProject(singleSegProject());
    useProjectStore.getState().splitAt(4);
    const [a, b] = useProjectStore.getState().project!.segments;
    useProjectStore.getState().selectSegment(b!.id);
    useProjectStore.getState().setFacecam({ size: 0.5 });
    const segs = useProjectStore.getState().project!.segments;
    expect(segs[0]!.facecam.size).toBe(0.2);
    expect(segs[1]!.facecam.size).toBe(0.5);
  });
});
