import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./projectStore";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";
import { projectDuration, sourceToTimeline } from "@panoptik/engine";
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

  describe("staged background", () => {
    const bgOf = (id: string) =>
      useProjectStore.getState().project!.segments.find((x) => x.id === id)!.background;
    const twoSegments = () => {
      const st = useProjectStore.getState();
      const p = structuredClone(st.project!);
      const second = structuredClone(p.segments[0]!);
      second.id = "s2";
      p.segments.push(second);
      st.setProject(p);
    };

    it("an unrelated commit does not bake in a theme that was only previewed", () => {
      // The reported bug: preview a theme, do something else, and from then on
      // Discard restores the previewed theme instead of the real one. Vercel is
      // the first tile in the grid, so it is the one that kept coming back.
      const committed = bgOf("s1");
      useProjectStore.getState().stageBackground({ kind: "gradient", stops: ["#007cf0", "#7928ca"] });
      useProjectStore.getState().addZoomPoint({
        t: 2,
        to: { scale: 2, x: 0.5, y: 0.5 },
        dur: 0.7,
        ease: "easeInOutCubic",
      });

      const st = useProjectStore.getState();
      expect(st.history[st.historyIndex]!.segments[0]!.background).toEqual(committed);

      useProjectStore.getState().clearStaged();
      expect(bgOf("s1")).toEqual(committed);
    });

    it("discard restores every clip a theme was staged across", () => {
      twoSegments();
      const committed = bgOf("s1");
      useProjectStore.setState({ selectedSegmentIds: ["s1", "s2"], selectedSegmentId: "s1" });

      useProjectStore.getState().stageBackground({ kind: "solid", color: "#123456" });
      expect(bgOf("s2")).toEqual({ kind: "solid", color: "#123456" });

      useProjectStore.getState().clearStaged();
      // s2 used to keep the unapproved theme for good, with the badge gone.
      expect(bgOf("s1")).toEqual(committed);
      expect(bgOf("s2")).toEqual(committed);
    });

    it("discard reaches a theme staged on a clip that is no longer selected", () => {
      twoSegments();
      const committed = bgOf("s1");
      useProjectStore.setState({ selectedSegmentIds: ["s1"], selectedSegmentId: "s1" });
      useProjectStore.getState().stageBackground({ kind: "solid", color: "#abcdef" });

      // The user clicks another clip before hitting Discard.
      useProjectStore.setState({ selectedSegmentIds: ["s2"], selectedSegmentId: "s2" });
      useProjectStore.getState().clearStaged();

      expect(bgOf("s1")).toEqual(committed);
    });

    it("applying keeps the theme and clears the staging record", () => {
      const staged = { kind: "solid", color: "#0a0a0a" } as const;
      useProjectStore.getState().stageBackground(staged);
      useProjectStore.getState().commitAll();

      const st = useProjectStore.getState();
      expect(bgOf("s1")).toEqual(staged);
      expect(st.history[st.historyIndex]!.segments[0]!.background).toEqual(staged);
    });
  });

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

  it("stageZoomProposals applies directly to zoomPoints and history", () => {
    const before = seg().zoomPoints.length;
    const histBefore = useProjectStore.getState().historyIndex;
    useProjectStore
      .getState()
      .stageZoomProposals([zp("ghost-1", 12)]);
    const s = useProjectStore.getState();
    expect(seg().stagedZoomPoints).toHaveLength(0);
    expect(seg().zoomPoints).toHaveLength(before + 1);
    expect(s.historyIndex).toBe(histBefore + 1);
  });

  it("commitAll merges state cleanly", () => {
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

  it("removeStagedZoom drops zoom point", () => {
    const s = useProjectStore.getState();
    s.stageZoomProposals([zp("a", 1), zp("b", 2)]);
    s.removeStagedZoom("a");
    expect(seg().zoomPoints.some((z) => z.id === "a")).toBe(false);
    expect(seg().zoomPoints.some((z) => z.id === "b")).toBe(true);
  });

  it("removeStagedTextOverlay drops text overlay", () => {
    const s = useProjectStore.getState();
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
    expect(seg().textOverlays.some((t) => t.id === "txt-a")).toBe(false);
    expect(seg().textOverlays.some((t) => t.id === "txt-b")).toBe(true);
  });

  it("stageBackground sets background immediately and commits", () => {
    const s = useProjectStore.getState();
    s.stageBackground({
      kind: "gradient",
      stops: ["#ff0000", "#0000ff"],
    });
    expect(seg().background).toEqual({
      kind: "gradient",
      stops: ["#ff0000", "#0000ff"],
    });
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
    const initialIdx = s.historyIndex;
    // add zoom
    s.stageZoomProposals([zp("g1", 2)]);
    // set background
    s.stageBackground({ kind: "solid", color: "#ff0000" });
    // add text
    s.stageTextOverlay({
      id: "t1",
      text: "hi",
      timestamp: 3,
      position: "top",
      staged: true,
    });

    const fullIdx =
      useProjectStore.getState().historyIndex;
    expect(fullIdx).toBe(initialIdx + 3);

    // undo all 3
    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    useProjectStore.getState().undo();
    expect(
      useProjectStore.getState().historyIndex,
    ).toBe(initialIdx);

    // redo all 3
    useProjectStore.getState().redo();
    useProjectStore.getState().redo();
    useProjectStore.getState().redo();
    expect(
      useProjectStore.getState().historyIndex,
    ).toBe(fullIdx);
  });

  it("clearStagedCaptions clears captions", () => {
    const s = useProjectStore.getState();
    s.stageCaptions([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
    ]);
    expect(seg().captions.length).toBeGreaterThanOrEqual(2);
    useProjectStore.getState().clearStagedCaptions();
    expect(seg().captions).toHaveLength(0);
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

  it("splitAt keeps segment B's annotations at absolute source time", () => {
    useProjectStore.getState().setProject(
      singleSegProject({
        zoomPoints: [
          {
            id: "z-b",
            t: 6,
            to: { scale: 2, x: 0.5, y: 0.5 },
            dur: 0.5,
            ease: "linear",
            staged: false,
          },
        ],
        stagedZoomPoints: [
          {
            id: "zg-b",
            t: 7,
            to: { scale: 2, x: 0.5, y: 0.5 },
            dur: 0.5,
            ease: "linear",
            staged: true,
          },
        ],
        textOverlays: [
          { id: "t-b", text: "hi", timestamp: 8, position: "top", staged: false },
        ],
        stagedTextOverlays: [
          { id: "tg-b", text: "hey", timestamp: 9, position: "bottom", staged: true },
        ],
        captions: [{ text: "cap", start: 5, end: 9 }],
      } as unknown as Partial<Segment>),
    );
    useProjectStore.getState().splitAt(4); // srcT 4 → b.srcStart = 4
    const { project } = useProjectStore.getState();
    const b = project!.segments[1]!;
    expect(b.srcStart).toBe(4);
    // Annotations keep their ABSOLUTE source time — no `- t` rebasing.
    expect(b.zoomPoints[0]!.t).toBe(6);
    expect(b.stagedZoomPoints[0]!.t).toBe(7);
    expect(b.textOverlays[0]!.timestamp).toBe(8);
    expect(b.stagedTextOverlays[0]!.timestamp).toBe(9);
    expect(b.captions[0]!.start).toBe(5);
    expect(b.captions[0]!.end).toBe(9);
    // ...and stay inside b's source window so render/sourceToTimeline match them.
    for (const t of [6, 7, 8, 9, 5]) {
      expect(t).toBeGreaterThanOrEqual(b.srcStart);
      expect(t).toBeLessThanOrEqual(b.srcEnd);
    }
    // The diamond is not dropped: sourceToTimeline resolves b's annotation.
    expect(sourceToTimeline(project!, b.id, 6)).not.toBeNull();
  });

  it("updateSegment clamps speed to the 0.25–3 grid", () => {
    useProjectStore.getState().setProject(singleSegProject());
    const id = useProjectStore.getState().project!.segments[0]!.id;
    useProjectStore.getState().updateSegment(id, { speed: 9 });
    expect(useProjectStore.getState().project!.segments[0]!.speed).toBe(3);
    useProjectStore.getState().updateSegment(id, { speed: 0.1 });
    expect(useProjectStore.getState().project!.segments[0]!.speed).toBe(0.25);
    useProjectStore.getState().updateSegment(id, { speed: 2.32 });
    expect(useProjectStore.getState().project!.segments[0]!.speed).toBe(2.3);
  });

  it("deleteSegment removes a segment when multiple segments exist, updates selection and pushes history", () => {
    useProjectStore.getState().setProject(singleSegProject());
    // Split at 5s to create 2 segments
    useProjectStore.getState().splitAt(5);
    const s1 = useProjectStore.getState();
    expect(s1.project!.segments).toHaveLength(2);
    const seg1Id = s1.project!.segments[0]!.id;
    const seg2Id = s1.project!.segments[1]!.id;

    // Delete the second segment
    useProjectStore.getState().deleteSegment(seg2Id);
    const s2 = useProjectStore.getState();
    expect(s2.project!.segments).toHaveLength(1);
    expect(s2.project!.segments[0]!.id).toBe(seg1Id);
    expect(s2.selectedSegmentId).toBe(seg1Id);

    // Undo restores the deleted segment
    useProjectStore.getState().undo();
    const s3 = useProjectStore.getState();
    expect(s3.project!.segments).toHaveLength(2);
    expect(s3.project!.segments[1]!.id).toBe(seg2Id);
  });

  it("deleteSegment is a no-op when only one segment remains in the project", () => {
    useProjectStore.getState().setProject(singleSegProject());
    const initialSegments = useProjectStore.getState().project!.segments;
    expect(initialSegments).toHaveLength(1);
    const singleId = initialSegments[0]!.id;

    useProjectStore.getState().deleteSegment(singleId);
    expect(useProjectStore.getState().project!.segments).toHaveLength(1);
    expect(useProjectStore.getState().project!.segments[0]!.id).toBe(singleId);
  });

  it("setProject restores saved history snapshots and historyIndex across sessions", () => {
    const base = singleSegProject();
    const snap1 = structuredClone(base);
    const snap2 = structuredClone(base);
    snap2.segments[0]!.speed = 2;

    useProjectStore.getState().setProject(snap2, [snap1, snap2], 1);
    const s = useProjectStore.getState();
    expect(s.history).toHaveLength(2);
    expect(s.historyIndex).toBe(1);
    expect(s.project!.segments[0]!.speed).toBe(2);

    // Undo reverts to snap1
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.segments[0]!.speed).toBe(1);
    expect(useProjectStore.getState().historyIndex).toBe(0);

    // Redo restores snap2
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project!.segments[0]!.speed).toBe(2);
    expect(useProjectStore.getState().historyIndex).toBe(1);
  });

  it("undo and redo preserve the active session media and audio URLs even if history had older URLs", () => {
    const base = singleSegProject();
    base.media.src = "blob:active-url";
    base.audioSrc = "blob:active-audio";

    // Older history snapshot with obsolete URL
    const oldSnap = singleSegProject();
    oldSnap.media.src = "blob:stale-url";
    oldSnap.audioSrc = "blob:stale-audio";
    oldSnap.segments[0]!.speed = 1.5;

    useProjectStore.getState().setProject(base, [oldSnap, base], 1);

    // Undo should restore segment properties from oldSnap, but retain active media URLs
    useProjectStore.getState().undo();
    const undone = useProjectStore.getState().project!;
    expect(undone.segments[0]!.speed).toBe(1.5);
    expect(undone.media.src).toBe("blob:active-url");
    expect(undone.audioSrc).toBe("blob:active-audio");

    // Redo should also retain active media URLs
    useProjectStore.getState().redo();
    const redone = useProjectStore.getState().project!;
    expect(redone.segments[0]!.speed).toBe(1);
    expect(redone.media.src).toBe("blob:active-url");
    expect(redone.audioSrc).toBe("blob:active-audio");
  });

  it("setCurrentTime updates selectedSegmentId to the active segment during playback", () => {
    useProjectStore.getState().setProject(singleSegProject());
    // Split at 5s -> Segment 1: [0, 5], Segment 2: [5, 10]
    useProjectStore.getState().splitAt(5);
    const p = useProjectStore.getState().project!;
    const seg1Id = p.segments[0]!.id;
    const seg2Id = p.segments[1]!.id;

    // Start playback at 2s (in segment 1)
    useProjectStore.getState().seek(2);
    useProjectStore.getState().play();
    expect(useProjectStore.getState().selectedSegmentId).toBe(seg1Id);

    // Playback advances into segment 2 (at 7s)
    useProjectStore.getState().setCurrentTime(7);
    expect(useProjectStore.getState().selectedSegmentId).toBe(seg2Id);

    // Seeking back to segment 1 updates selectedSegmentId
    useProjectStore.getState().seek(3);
    expect(useProjectStore.getState().selectedSegmentId).toBe(seg1Id);
  });

  it("supports multi-segment selection and applies grouped settings across all selected clips", () => {
    useProjectStore.getState().setProject(singleSegProject());
    // Split into 3 segments: [0..3], [3..6], [6..10]
    useProjectStore.getState().splitAt(3);
    useProjectStore.getState().splitAt(6);
    const p = useProjectStore.getState().project!;
    expect(p.segments).toHaveLength(3);

    const [s1, s2, s3] = p.segments;

    // Single select s1
    useProjectStore.getState().selectSegment(s1!.id, false);
    expect(useProjectStore.getState().selectedSegmentIds).toEqual([s1!.id]);

    // Ctrl+Click s2 to multi-select [s1, s2]
    useProjectStore.getState().selectSegment(s2!.id, true);
    expect(useProjectStore.getState().selectedSegmentIds).toEqual([s1!.id, s2!.id]);

    // Grouped padding update: apply 32px padding to both s1 and s2
    useProjectStore.getState().setStagePadding(32);
    let updated = useProjectStore.getState().project!;
    expect(updated.segments[0]!.stagePadding).toBe(32);
    expect(updated.segments[1]!.stagePadding).toBe(32);
    expect(updated.segments[2]!.stagePadding).toBe(0); // s3 untouched

    // Grouped speed update: set 2x speed on both s1 and s2
    useProjectStore.getState().updateSelectedSegments({ speed: 2 });
    updated = useProjectStore.getState().project!;
    expect(updated.segments[0]!.speed).toBe(2);
    expect(updated.segments[1]!.speed).toBe(2);
    expect(updated.segments[2]!.speed).toBe(1); // s3 untouched

    // Grouped aspect update
    useProjectStore.getState().setAspectPreset("9:16");
    updated = useProjectStore.getState().project!;
    expect(updated.segments[0]!.aspectPreset).toBe("9:16");
    expect(updated.segments[1]!.aspectPreset).toBe("9:16");
    expect(updated.segments[2]!.aspectPreset).toBe("source");

    // Grouped background update
    useProjectStore.getState().setBackground({ kind: "solid", color: "#123456" });
    updated = useProjectStore.getState().project!;
    expect(updated.segments[0]!.background).toEqual({ kind: "solid", color: "#123456" });
    expect(updated.segments[1]!.background).toEqual({ kind: "solid", color: "#123456" });

    // Select all segments
    useProjectStore.getState().selectAllSegments();
    expect(useProjectStore.getState().selectedSegmentIds).toEqual([s1!.id, s2!.id, s3!.id]);

    // Toggle off s2 from multi-selection
    useProjectStore.getState().selectSegment(s2!.id, true);
    expect(useProjectStore.getState().selectedSegmentIds).toEqual([s1!.id, s3!.id]);
  });
});
