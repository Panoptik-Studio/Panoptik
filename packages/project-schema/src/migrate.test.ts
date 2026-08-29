import { describe, expect, it } from "vitest";
import {
  FIRST_MEDIA_ID,
  mediaById,
  mediaForSegment,
  migrateProject,
  primaryMedia,
  type AudioTrack,
  type Media,
  type Project,
  type Segment } from "./index";

/** A v1.2 segment: no mediaId, since there was only ever one clip. */
const v12Segment = (over: Record<string, unknown> = {}) =>
  ({
    id: "s1",
    srcStart: 0,
    srcEnd: 5,
    speed: 1,
    stagePadding: 0,
    aspectPreset: "source",
    background: { kind: "solid", color: "#000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [],
    stagedZoomPoints: [],
    textOverlays: [],
    stagedTextOverlays: [], ...over }) as unknown as Segment;

describe("migrateProject v1.1 → v1.3", () => {
  it("builds one full-range segment from a legacy single-clip project", () => {
    const legacy = {
      id: "p1",
      clip: { src: "blob:x", duration: 10, width: 1920, height: 1080 },
      playbackRate: 2,
      aspectPreset: "16:9",
      facecam: { src: null, x: 0.2, y: 0.3, size: 0.25, shape: "circle" },
      zoomPoints: [{ id: "z1", t: 3, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: false }],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [], background: { kind: "solid", color: "#000000" },
      clickLog: [] } as unknown as Record<string, unknown>;

    const p = migrateProject(legacy);
    expect(p.media).toEqual([
      { id: FIRST_MEDIA_ID, src: "blob:x", duration: 10, width: 1920, height: 1080 } ]);
    expect(p.segments).toHaveLength(1);
    const seg = p.segments[0]!;
    // The lone segment has to point at the clip it was built from.
    expect(seg.mediaId).toBe(FIRST_MEDIA_ID);
    expect(seg.srcStart).toBe(0);
    expect(seg.srcEnd).toBe(10);
    expect(seg.speed).toBe(2);
    expect(seg.aspectPreset).toBe("16:9");
    expect(seg.facecam.size).toBe(0.25);
    expect(seg.zoomPoints).toHaveLength(1);
    expect(seg.zoomPoints[0]!.t).toBe(3);
  });
});

describe("migrateProject v1.2 → v1.3", () => {
  const v12 = () => ({
    id: "n",
    media: { src: "blob:x", duration: 5, width: 800, height: 600 },
    segments: [v12Segment()],
    audioSrc: null,
    clickLog: [] });

  it("wraps the single clip into the media array and keeps its values", () => {
    const p = migrateProject(v12());
    expect(Array.isArray(p.media)).toBe(true);
    expect(p.media).toHaveLength(1);
    expect(p.media[0]).toMatchObject({ src: "blob:x", duration: 5, width: 800, height: 600 });
  });

  it("points every existing segment at the wrapped clip", () => {
    const p = migrateProject(v12());
    expect(p.segments[0]!.mediaId).toBe(p.media[0]!.id);
  });

  it("assigns the media id deterministically", () => {
    // A project is migrated on every load. Random ids would mint a new one each
    // time and orphan the segments pointing at the old one.
    const a = migrateProject(v12());
    const b = migrateProject(v12());
    expect(a.media[0]!.id).toBe(FIRST_MEDIA_ID);
    expect(b.media[0]!.id).toBe(a.media[0]!.id);
  });

  it("preserves every edit on the segment", () => {
    const p = migrateProject({
      ...v12(),
      segments: [v12Segment({ speed: 2, srcEnd: 4 })] });
    const seg = p.segments[0]!;
    expect(seg.speed).toBe(2);
    expect(seg.srcEnd).toBe(4);
  });
});

describe("migrateProject v1.3", () => {
  const v13 = (): Project => ({
    id: "n",
    media: [{ id: "m1", src: "blob:a", duration: 5, width: 800, height: 600 }],
    segments: [v12Segment({ mediaId: "m1" })],
    audioSrc: null,
    clickLog: [],
    audioTracks: [] });

  it("passes an already-migrated project straight through", () => {
    const p = v13();
    expect(migrateProject(p)).toBe(p);
  });

  it("is idempotent", () => {
    // The v1.2 branch tests `typeof media === "object"`, which an array also
    // satisfies — so a v1.3 project would be re-wrapped into media[[…]] unless
    // the array case is checked first.
    const once = migrateProject(v13());
    const twice = migrateProject(once);
    expect(twice.media).toHaveLength(1);
    expect(twice.media[0]!.src).toBe("blob:a");
    expect(twice.segments[0]!.mediaId).toBe("m1");
  });

  it("keeps several clips and their segment links", () => {
    const many: Project = {
      id: "n",
      media: [
        { id: "m1", src: "blob:a", duration: 5, width: 800, height: 600 },
        { id: "m2", src: "blob:b", duration: 8, width: 1920, height: 1080 } ],
      segments: [v12Segment({ id: "s1", mediaId: "m1" }), v12Segment({ id: "s2", mediaId: "m2" })],
      audioSrc: null,
      clickLog: [],
      audioTracks: [] };
    const p = migrateProject(many);
    expect(p.media).toHaveLength(2);
    expect(p.segments.map((s) => s.mediaId)).toEqual(["m1", "m2"]);
  });
});

describe("media accessors", () => {
  const project: Project = {
    id: "n",
    media: [
      { id: "m1", src: "blob:a", duration: 5, width: 800, height: 600 },
      { id: "m2", src: "blob:b", duration: 8, width: 1920, height: 1080 } ],
    segments: [v12Segment({ id: "s1", mediaId: "m2" })],
    audioSrc: null,
    clickLog: [],
    audioTracks: [] };

  it("resolves a segment to the clip it cuts from", () => {
    expect(mediaForSegment(project, project.segments[0]!).src).toBe("blob:b");
  });

  it("falls back to the first clip when a segment points at a removed one", () => {
    // Degrading to something renderable beats throwing inside the render loop.
    const orphan = { ...project.segments[0]!, mediaId: "gone" };
    expect(mediaForSegment(project, orphan).src).toBe("blob:a");
  });

  it("looks a clip up by id, and reports a miss", () => {
    expect(mediaById(project, "m2")?.duration).toBe(8);
    expect(mediaById(project, "nope")).toBeUndefined();
  });

  it("primaryMedia is the first clip", () => {
    expect(primaryMedia(project).id).toBe("m1");
  });
});

describe("audioTracks (phase 2)", () => {
  const media = { id: "m1", src: "blob:x", duration: 10, width: 1280, height: 720 } as Media;
  const seg: Segment = {
    id: "s1", mediaId: "m1", srcStart: 0, srcEnd: 10, speed: 1,
    stagePadding: 0, aspectPreset: "source",
    background: { kind: "solid", color: "#000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [] };

  it("fast-path v1.2 projects gain an empty audioTracks array", () => {
    const p = migrateProject({ id: "p1", media, segments: [seg], clickLog: [] });
    expect(p.audioTracks).toEqual([]);
  });

  it("legacy clip projects gain audioTracks through the migration path", () => {
    const p = migrateProject({ id: "old", clip: { src: "blob:y", duration: 5, width: 640, height: 360 } });
    expect(p.audioTracks).toEqual([]);
  });

  it("existing audioTracks survive migration", () => {
    const track: AudioTrack = { id: "t1", kind: "music", src: "blob:z", duration: 30, volume: 1, startT: 2, ducking: 0.5 };
    const p = migrateProject({ id: "p2", media, segments: [], audioTracks: [track], clickLog: [] });
    expect(p.audioTracks).toEqual([track]);
  });
});
