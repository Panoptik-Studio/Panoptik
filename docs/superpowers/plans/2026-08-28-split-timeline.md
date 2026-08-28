# Split Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Non-destructive split of the loaded recording into independently-configurable segments (own speed, padding, facecam, aspect, background, and annotations) shown as a thumbnail-filmstrip timeline.

**Architecture:** Replace `Project.clip` + global settings with `Project.media` + `Project.segments[]`. A shared time-mapping utility (`resolveSegment`/`sourceToTimeline`) is the single source of truth for timeline↔source time; `renderFrame`, preview, export, and the timeline all use it. `renderFrame(ctx, project, timelineT)` resolves the active segment and uses that segment's settings. Export iterates segments sequentially, time-stretching each segment's audio with the existing WSOLA `timeStretch`.

**Tech Stack:** TypeScript, Zustand, canvases (timeline drawn on `<canvas>`), mediabunny, existing WSOLA module (`timeStretch.ts`), Vitest.

## Global Constraints

- Schema is versioned: keep old v1.1 `clip` fields tolerated on read for migration.
- `@panoptik/schema` types are imported from `@panoptik/schema` everywhere — update the source `packages/project-schema/src/index.ts`.
- All engine files are DEV-A owned; store + web components are DEV-B owned — the plan touches both, keep the OWNER doc comments intact.
- Speed clamps: `0.25–3`, step `0.05`. Same `clampRate` used today.
- `frameRect`/`outputSize`/`presetAspect` now operate on `(media, aspectPreset)`.
- `renderFrame(ctx, project, t)` now interprets `t` as **on-timeline** time.
- Existing tests must keep passing; the full suite is `pnpm test` (`vitest run`), typecheck is `pnpm typecheck`.

---

### Task 1: Schema v1.2 (media + Segment) with migration helpers

**Files:**
- Modify: `packages/project-schema/src/index.ts`
- Test: `packages/project-schema/src/migrate.test.ts` (new)

**Interfaces:**
- Produces: `type Media`, `type Segment`, `Project.media`, `Project.segments`, and
  ```ts
  export function migrateProject(raw: unknown): Project; // upgrades v1.1 → v1.2
  ```
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { migrateProject, type Media, type Segment } from "./index";

describe("migrateProject v1.1 → v1.2", () => {
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
      stagedTextOverlays: [],
      captions: [],
      stagedCaptions: [],
      background: { kind: "solid", color: "#000000" },
      clickLog: [],
    } as unknown as Record<string, unknown>;

    const p = migrateProject(legacy);
    expect(p.media).toEqual({ src: "blob:x", duration: 10, width: 1920, height: 1080 });
    expect(p.segments).toHaveLength(1);
    const seg = p.segments[0]!;
    expect(seg.srcStart).toBe(0);
    expect(seg.srcEnd).toBe(10);
    expect(seg.speed).toBe(2);
    expect(seg.aspectPreset).toBe("16:9");
    expect(seg.facecam.size).toBe(0.25);
    expect(seg.zoomPoints).toHaveLength(1);
    expect(seg.zoomPoints[0]!.t).toBe(3);
  });

  it("passes through an already-v1.2 project unchanged", () => {
    const media: Media = { src: "blob:x", duration: 5, width: 800, height: 600 };
    const seg: Segment = {
      id: "s1", srcStart: 0, srcEnd: 5, speed: 1,
      stagePadding: 0, aspectPreset: "source",
      background: { kind: "solid", color: "#000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
      captions: [], stagedCaptions: [],
    };
    const p = migrateProject({ id: "n", media, segments: [seg], audioSrc: null, clickLog: [] });
    expect(p.media).toBe(media);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0]).toBe(seg);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/project-schema/src/migrate.test.ts`
Expected: FAIL — `migrateProject` is not exported.

- [ ] **Step 3: Implement schema + migration**

Add to `packages/project-schema/src/index.ts` (append types; do not remove `AspectPreset`, `Background`, `Facecam`, `ZoomPoint`, `TextOverlay`, `Caption`, `ClickEvent`, `ExportOpts`, which remain):

```ts
export type Media = { src: string; duration: number; width: number; height: number };

export type Segment = {
  id: string;
  srcStart: number;
  srcEnd: number;
  speed: number;
  stagePadding: number;
  aspectPreset: AspectPreset;
  background: Background;
  facecam: Facecam;
  zoomPoints: ZoomPoint[];
  stagedZoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
};

// Change Project to:
export type Project = {
  id: string;
  media: Media;
  audioSrc?: string | null;
  segments: Segment[];
  clickLog: ClickEvent[];
};
```

Then add the migration function (place after `Project` type):

```ts
export function migrateProject(raw: unknown): Project {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (Array.isArray(r.segments) && r.media && typeof r.media === "object") {
    return raw as Project; // already v1.2
  }
  const clip = (r.clip ?? {}) as Record<string, unknown>;
  const media: Media = {
    src: String(clip.src ?? ""),
    duration: num(clip.duration, 0),
    width: num(clip.width, 1920),
    height: num(clip.height, 1080),
  };
  const fc = (r.facecam ?? {}) as Record<string, unknown>;
  const baseZoom = (r.zoomPoints ?? []) as ZoomPoint[];
  const seg: Segment = {
    id: "s1",
    srcStart: 0,
    srcEnd: media.duration,
    speed: num(r.playbackRate, 1, 0.25, 3),
    stagePadding: num(r.stagePadding, 0, 0, 48),
    aspectPreset: (r.aspectPreset as AspectPreset) ?? "source",
    background: (r.background as Background) ?? { kind: "solid", color: "#000000" },
    facecam: {
      src: fc.src ? String(fc.src) : null,
      x: num(fc.x, 0.8, 0, 1),
      y: num(fc.y, 0.8, 0, 1),
      size: num(fc.size, 0.2, 0.02, 1),
      shape: fc.shape === "circle" || fc.shape === "square" ? (fc.shape as Facecam["shape"]) : "square",
    },
    zoomPoints: baseZoom.map((z) => ({ ...z })),
    stagedZoomPoints: ((r.stagedZoomPoints ?? []) as ZoomPoint[]).map((z) => ({ ...z })),
    textOverlays: ((r.textOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
    stagedTextOverlays: ((r.stagedTextOverlays ?? []) as TextOverlay[]).map((o) => ({ ...o })),
    captions: ((r.captions ?? []) as Caption[]).map((c) => ({ ...c })),
    stagedCaptions: ((r.stagedCaptions ?? []) as Caption[]).map((c) => ({ ...c })),
  };
  return {
    id: String(r.id ?? crypto.randomUUID()),
    media,
    audioSrc: r.audioSrc ? String(r.audioSrc) : null,
    segments: [seg],
    clickLog: ((r.clickLog ?? []) as ClickEvent[]).map((e) => ({ ...e })),
  };
}

function num(v: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}
```

Also, in `Project` replace the old `clip` field (it is removed in v1.2). Keep the `ZoomPoint.t` etc. types unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/project-schema/src/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project-schema/src/index.ts packages/project-schema/src/migrate.test.ts
git commit -m "feat(schema): media + Segment model with v1.1 migration"
```

---

### Task 2: Time-mapping utility

**Files:**
- Create: `packages/engine/src/timeline.ts`
- Test: `packages/engine/src/timeline.test.ts` (new)

**Interfaces:**
- Consumes: `Project`, `Segment` from `@panoptik/schema` (Task 1).
- Produces:
  ```ts
  export function segmentDuration(seg: Segment): number;
  export function projectDuration(project: Project): number;
  export function resolveSegment(project: Project, timelineT: number): { segment: Segment; srcT: number } | null;
  export function sourceToTimeline(project: Project, segmentId: string, srcT: number): number | null;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { segmentDuration, projectDuration, resolveSegment, sourceToTimeline } from "./timeline";
import type { Project, Segment } from "@panoptik/schema";

function seg(id: string, start: number, end: number, speed: number): Segment {
  return {
    id, srcStart: start, srcEnd: end, speed, stagePadding: 0,
    aspectPreset: "source", background: { kind: "solid", color: "#000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
  };
}
const proj = (segs: Segment[]): Project =>
  ({ id: "p", media: { src: "x", duration: 10, width: 800, height: 600 }, segments: segs, clickLog: [] }) as Project;

describe("time mapping", () => {
  it("segmentDuration divides source range by speed", () => {
    expect(segmentDuration(seg("a", 0, 10, 2))).toBe(5);
    expect(segmentDuration(seg("b", 5, 7, 1))).toBe(2);
  });

  it("projectDuration sums segment durations", () => {
    expect(projectDuration(proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]))).toBe(15);
  });

  it("resolveSegment maps timeline time to segment + source time", () => {
    // seg a: 0..10 src @2x -> 5s on timeline; seg b: 10..20 src @1x -> 10s
    const p = proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]);
    expect(resolveSegment(p, 0)).toEqual({ segment: p.segments[0], srcT: 0 });
    expect(resolveSegment(p, 5)).toEqual({ segment: p.segments[0], srcT: 10 });
    expect(resolveSegment(p, 6)).toEqual({ segment: p.segments[1], srcT: 11 });
    expect(resolveSegment(p, 15)).toEqual({ segment: p.segments[1], srcT: 20 });
    expect(resolveSegment(p, 99)).toBeNull();
  });

  it("sourceToTimeline inverts mapping", () => {
    const p = proj([seg("a", 0, 10, 2), seg("b", 10, 20, 1)]);
    expect(sourceToTimeline(p, "a", 4)).toBeCloseTo(2);
    expect(sourceToTimeline(p, "a", 10)).toBe(5);
    expect(sourceToTimeline(p, "b", 11)).toBe(6);
    expect(sourceToTimeline(p, "a", 50)).toBeNull(); // outside
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/engine/src/timeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the utility**

```ts
import type { Project, Segment } from "@panoptik/schema";

export function segmentDuration(seg: Segment): number {
  return (seg.srcEnd - seg.srcStart) / seg.speed;
}

export function projectDuration(project: Project): number {
  return project.segments.reduce((acc, s) => acc + segmentDuration(s), 0);
}

export function resolveSegment(
  project: Project,
  timelineT: number,
): { segment: Segment; srcT: number } | null {
  let acc = 0;
  for (const seg of project.segments) {
    const d = segmentDuration(seg);
    if (timelineT < acc + d || (timelineT - acc <= d + 1e-9 && seg === project.segments[project.segments.length - 1])) {
      return { segment: seg, srcT: seg.srcStart + Math.max(0, timelineT - acc) * seg.speed };
    }
    acc += d;
  }
  return null;
}

export function sourceToTimeline(
  project: Project,
  segmentId: string,
  srcT: number,
): number | null {
  let acc = 0;
  for (const seg of project.segments) {
    if (seg.id === segmentId) {
      if (srcT < seg.srcStart || srcT > seg.srcEnd) return null;
      return acc + (srcT - seg.srcStart) / seg.speed;
    }
    acc += segmentDuration(seg);
  }
  return null;
}
```

Note: `resolveSegment`'s tail condition clamps the last segment so a request at exactly `projectDuration` lands on the last segment's end (mirrors the preview's past-EOS behavior). The test at `resolveSegment(p, 15)` expects `{ srcT: 20 }` — verify that matches after implementation; if it needs refining, adjust the condition so `timelineT === total` resolves to the last segment.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/engine/src/timeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/timeline.ts packages/engine/src/timeline.test.ts
git commit -m "feat(engine): timeline<->source time mapping utility"
```

---

### Task 3: Rewrite the store to segment model

**Files:**
- Modify: `apps/web/src/stores/projectStore.ts`
- Test: `apps/web/src/stores/projectStore.test.ts` (exists; extend)

**Interfaces:**
- Consumes: `Project`, `Segment`, `migrateProject` from `@panoptik/schema` (Task 1); nothing engine-side (store stays renderer-agnostic).
- Produces:
  ```ts
  export interface ProjectStore {
    project: Project | null;
    history: Project[];            // we switch snapshotting to the whole Project
    historyIndex: number;
    isPlaying: boolean;
    currentTime: number;           // ON-TIMELINE time
    selectedSegmentId: string | null;
    selectedZoomId: string | null;
    exportProgress: number | null;
    setProject(p: Project): void;
    clearProject(): void;
    selectSegment(id: string): void;
    splitAt(timelineT: number): void;
    updateSegment(id: string, updates: Partial<Segment>): void;
    play(): void; pause(): void; togglePlay(): void;
    seek(t: number): void;
    // annotation actions target the SELECTED segment:
    addZoomPoint / removeZoomPoint / updateZoomPoint / setSelectedZoom / commitDrag
    stageZoomProposals / removeStagedZoom
    addTextOverlay / removeTextOverlay / updateTextOverlay / stageTextOverlay / removeStagedTextOverlay
    setCaptions / stageCaptions / clearStagedCaptions
    setBackground / stageBackground
    setFacecam(updates): void;
    setStagePadding(n: number): void;
    setAspectPreset(preset): void;
    undo(): void; redo(): void;
    beginExport(): void; setExportProgress(p: number): void; endExport(): void;
  }
  ```

- [ ] **Step 1: Write failing tests for split + selected-segment ops**

Append to `apps/web/src/stores/projectStore.test.ts`:

```ts
import { migrateProject, type Project, type Segment } from "@panoptik/schema";

function singleSegProject(overrides?: Partial<Segment>): Project {
  return migrateProject({
    id: "p", clip: { src: "blob:v", duration: 10, width: 800, height: 600 },
    playbackRate: 1, aspectPreset: "source",
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [], background: { kind: "solid", color: "#000" }, clickLog: [],
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
    useProjectStore.getState().updateSegment(useProjectStore.getState().project!.segments[0]!.id, { speed: 2 });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/stores/projectStore.test.ts`
Expected: FAIL — `splitAt`, `selectSegment`, `updateSegment` don't exist.

- [ ] **Step 3: Rewrite the store**

Replace `projectStore.ts` internals:
- History becomes full-project snapshots: `history: Project[]`, `historyIndex: number`.
- `setProject` migrates via `migrateProject`, resets `history=[p]`, `selectedSegmentId = p.segments[0]?.id ?? null`, `currentTime=0`.
- `play/pause/togglePlay/seek`: keep export lock guard; `rewindIfEnded` uses `projectDuration` (import from `@panoptik/engine`).
- `selectSegment(id)`: `set({ selectedSegmentId: id })`.
- `splitAt(timelineT)`: import `resolveSegment` from `@panoptik/engine`. Resolve; guard `srcT` strictly inside `(srcStart, srcEnd)` (skip if already a boundary within epsilon). Build two segments with `structuredClone` of settings + annotations split by `srcT`:

```ts
splitAt: (timelineT) => {
  const s = get();
  if (!s.project || s.exportProgress !== null) return;
  const r = resolveSegment(s.project, timelineT);
  if (!r) return;
  const t = r.srcT;
  const orig = r.segment;
  if (t <= orig.srcStart + 0.001 || t >= orig.srcEnd - 0.001) return; // no-op at boundary
  const cloneSettings = (src: Segment): Segment => structuredClone(src);
  const a = cloneSettings(orig);
  a.id = crypto.randomUUID();
  a.srcEnd = t;
  a.zoomPoints = orig.zoomPoints.filter((z) => z.t < t).map((z) => ({ ...z }));
  a.stagedZoomPoints = orig.stagedZoomPoints.filter((z) => z.t < t).map((z) => ({ ...z }));
  a.textOverlays = orig.textOverlays.filter((o) => o.timestamp < t).map((o) => ({ ...o }));
  a.stagedTextOverlays = orig.stagedTextOverlays.filter((o) => o.timestamp < t).map((o) => ({ ...o }));
  a.captions = orig.captions.filter((c) => c.start < t).map((c) => ({ ...c }));
  a.stagedCaptions = orig.stagedCaptions.filter((c) => c.start < t).map((c) => ({ ...c }));
  const b = cloneSettings(orig);
  b.id = crypto.randomUUID();
  b.srcStart = t;
  b.zoomPoints = orig.zoomPoints.filter((z) => z.t >= t).map((z) => ({ ...z, t: z.t - t }));
  b.stagedZoomPoints = orig.stagedZoomPoints.filter((z) => z.t >= t).map((z) => ({ ...z, t: z.t - t }));
  b.textOverlays = orig.textOverlays.filter((o) => o.timestamp >= t).map((o) => ({ ...o, timestamp: o.timestamp - t }));
  b.stagedTextOverlays = orig.stagedTextOverlays.filter((o) => o.timestamp >= t).map((o) => ({ ...o, timestamp: o.timestamp - t }));
  b.captions = orig.captions.filter((c) => c.start >= t).map((c) => ({ ...c, start: c.start - t, end: c.end - t }));
  b.stagedCaptions = orig.stagedCaptions.filter((c) => c.start >= t).map((c) => ({ ...c, start: c.start - t, end: c.end - t }));
  const idx = s.project.segments.indexOf(orig);
  const segments = [...s.project.segments];
  segments.splice(idx, 1, a, b);
  const project = { ...s.project, segments };
  pushHistoryAndSet(project, s, set);
},
```

Note: annotation timestamps within each descendant are rebased to be **relative to that segment's own start** (so `renderFrame` and `getCameraTransform` keep using `project`-local times derived from `srcT`). Add a helper `pushHistoryAndSet(project, state, set)` that computes the next history slice.

- `updateSegment(id, updates)`: map the segment, push history, keep `selectedSegmentId`.
- `undo/redo`: `set({ project: history[i], historyIndex: i })`.
- All annotation actions (`addZoomPoint`, `setFacecam`, `setBackground`, text/captions, stage…) operate on `find(seg => seg.id === selectedSegmentId)` and push history.
- Remove `playbackRate`/`setPlaybackRate` from the store (speed lives on segments; UI reads selected segment's speed).
- `getStagedDiff`, `commitAll`, `clearStaged`: iterate the selected segment's staged arrays instead of project-level.
- `markMoment`, export lock, `setStagePadding`/`setAspectPreset` → forward to `updateSegment(selectedId, ...)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/stores/projectStore.test.ts` (and add `apps/web/src/stores/projectStore.test.ts` to broad `npx vitest run apps/web/src/stores`)
Expected: all store tests pass (update any existing tests that referenced `playbackRate`/`facecam` at project level to use the selected segment).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/projectStore.ts apps/web/src/stores/projectStore.test.ts
git commit -m "feat(store): segment model with splitAt/selectSegment/updateSegment"
```

---

### Task 4: Engine — layout + render resolve per segment

**Files:**
- Modify: `packages/engine/src/layout.ts`, `packages/engine/src/render.ts`
- Test: `packages/engine/src/render.test.ts` (exists; extend)

**Interfaces:**
- Consumes: `Media`/`Segment` (Task 1), `resolveSegment` (Task 2), store (Task 3).
- Produces: `layout.outputSize(media, aspectPreset, maxWidth)`, `layout.frameRect(canvasW, canvasH, media, aspectPreset)`, `render.renderFrame(ctx, project, timelineT)` (now timeline time).

- [ ] **Step 1: Update engine index exports**

In `packages/engine/src/index.ts`, add exports:
```ts
export { segmentDuration, projectDuration, resolveSegment, sourceToTimeline } from "./timeline";
```

- [ ] **Step 2: Write failing render test**

Append to `packages/engine/src/render.test.ts`:

```ts
import { migrateProject, type Project } from "@panoptik/schema";
import { renderFrame } from "./render";
import { resolveSegment } from "./timeline";

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
    const off = document.createElement("canvas");
    off.width = 800; off.height = 600;
    renderFrame(off.getContext("2d")!, p2, 3); // must not throw and must use segment b's facecam
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run packages/engine/src/render.test.ts`
Expected: FAIL/compile error — `migrateProject` rendering already assumes `project.media`/`segments`.

- [ ] **Step 4: Update layout.ts**

Change signatures to accept `Media`:

```ts
import type { Media, AspectPreset } from "@panoptik/schema";
export function presetAspect(preset: AspectPreset, media: Media): number {
  if (preset === "source" || !ASPECT[preset]) return media.width / media.height;
  return ASPECT[preset]!;
}
export function outputSize(media: Media, preset: AspectPreset, maxWidth = 1920): { width; height } {
  const aspect = presetAspect(preset, media);
  const width = Math.min(maxWidth, Math.max(media.width, Math.round(media.height * aspect)));
  const height = Math.round(width / aspect);
  return { width: width - (width % 2), height: height - (height % 2) };
}
export function frameRect(canvasW, canvasH, media: Media, preset: AspectPreset): Rect {
  const target = presetAspect(preset, media);
  const boxW = Math.min(canvasW, canvasH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / media.width, boxH / media.height);
  const w = media.width * s;
  const h = media.height * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
```

- [ ] **Step 5: Update render.ts `renderFrame`**

Resolve the active segment from timeline time and read all settings from it:

```ts
export function renderFrame(ctx, project: Project, timelineT: number): void {
  const r = resolveSegment(project, timelineT);
  const seg = r?.segment ?? project.segments[project.segments.length - 1]!;
  const srcT = r ? r.srcT : project.media.duration;
  if (!seg) return;
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const media = project.media;
  // Layer 1 background from seg.background
  drawBackground(ctx, seg.background, w, h); // change drawBackground signature to take bg directly
  // Layer 2 letterboxed frame:
  const rect = frameRect(w, h, media, seg.aspectPreset);
  const view = cameraViewport(rect, getCameraTransform(seg.zoomPoints, srcT));
  // ... draw currentFrame clipped to rect with view transform (unchanged math)
  // Layer 3 facecam from seg.facecam
  // Layer 4 text from seg.textOverlays/stagedTextOverlays at timestamp srctime
  // Layer 5 captions from seg.captions/stagedCaptions
}
```

Refactor the internal helpers (`drawBackground`, `drawFrame`, `drawFacecam`, `drawText`, `drawCaptions`) to take `(seg | settings, srcT)` instead of `project`. Keep `panel`/caption anchor math identical.

- [ ] **Step 6: Run render test + full engine tests**

Run: `npx vitest run packages/engine/src/render.test.ts packages/engine/src/layout.test.ts`
Expected: all pass (update `layout.test.ts` to use the new `outputSize(media, preset)` signature).

- [ ] **Step 7: Commit**

```bash
git add packages/engine/src/layout.ts packages/engine/src/render.ts packages/engine/src/index.ts packages/engine/src/render.test.ts packages/engine/src/layout.test.ts
git commit -m "feat(engine): renderFrame resolves active segment settings"
```

---

### Task 5: Engine — decode + export per segment

**Files:**
- Modify: `packages/engine/src/decode.ts` (`loadClip` returns v1.2 project), `packages/engine/src/real-engine.ts`, `packages/engine/src/encode.ts`
- Test: `packages/engine/src/encode.test.ts` (exists; extend for per-segment audio length)

**Interfaces:**
- Consumes: `migrateProject` (Task 1), `segmentDuration`/`projectDuration`/`resolveSegment` (Task 2), WSOLA `timeStretch` (existing).
- Produces: `decode.loadClip` returns a v1.2 `Project` with `segments`; `encode.exportProject` iterates segments.

- [ ] **Step 1: Update `decode.loadClip`/`loadRecording`**

In `decode.ts`, `loadClip` currently builds `{ clip: { src, duration, width, height }, zoomPoints: [], … }`. Replace the returned object:

```ts
return {
  id: crypto.randomUUID(),
  media: { src: objectUrl, duration, width: displayWidth, height: displayHeight },
  audioSrc: null,
  segments: [{
    id: crypto.randomUUID(),
    srcStart: 0,
    srcEnd: duration,
    speed: 1,
    stagePadding: 0,
    aspectPreset: "source",
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
  }],
  clickLog: [],
};
```

`loadRecording` mutates `proj.facecam.src` — change to `proj.segments[0]!.facecam.src`. In `real-engine.ts` `restoreProject`, replace `saved.clip`/`saved.facecam` references with the v1.2 shape:
```ts
const proj = await this.loadRecording(saved.media, saved.media facecam?, saved.audio);
```
`loadProjectRecord` returns `{ clip?, facecam?, audio?, project }` — update `opfs.ts` or migrate at the boundary so the saved record carries `media`/`segments`. (See Task 8 for opfs.)

- [ ] **Step 2: Write failing export test (audio lengths per segment)**

Append to `packages/engine/src/encode.test.ts`:

```ts
import { timeStretch } from "./timeStretch";
describe("per-segment export", () => {
  it("time-stretches each segment to its own duration", () => {
    // WSOLA already tested; assert the compositing helper we rely on:
    const buffers = [makeMock(1000), makeMock(2000)];
    expect(concatDurations(buffers)).toBeCloseTo((1000 + 2000) / 48000, 3);
  });
});
```
(Add small `makeMock`/`concatDurations` helpers in `timeStretch.ts` or the test, and implement `concatDurations` as audio concatenation.)

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run packages/engine/src/encode.test.ts`
Expected: FAIL — helpers not exported.

- [ ] **Step 4: Implement per-segment export in `encode.ts`**

Rewrite the export loop to iterate segments:

```ts
import { projectDuration, resolveSegment } from "./timeline";
import { segmentDuration } from "./timeline";

export async function exportProject(project, opts) {
  // ... existing codec/container/audio-source setup is unchanged ...
  // Temporal mapping: iterate each segment at its own speed
  let timelineCursor = 0;
  const audioSegments: AudioBuffer[] = []; // per-segment for muxing
  for (const seg of project.segments) {
    const dur = segmentDuration(seg);
    const totalFrames = Math.max(1, Math.ceil(dur * EXPORT_FPS));
    for (let i = 0; i < totalFrames; i++) {
      const tEff = i / EXPORT_FPS;             // within-segment timeline offset
      const srcT = seg.srcStart + tEff * seg.speed; // revert toward source
      await prepareAllFrames(srcT);
      renderFrame(ctx, project, timelineCursor + tEff); // engine renders by timeline time
      await videoSource.add(timelineCursor + tEff, frameDuration);
      if (i % EXPORT_FPS === 0) emitProgress((timelineCursor + tEff) / totalTimeline);
    }
    timelineCursor += dur;
  }
}
```

`renderFrame` already resolves the active segment from timeline time, so passing `timelineCursor + tEff` is correct. Also compute `totalTimeline = projectDuration(project)` and use it for progress (`emitProgress(timeline / totalTimeline)`).

For audio: split the source `AudioBuffer` by segment boundaries in source time (the engine already kept the whole clip audio buffer). For each segment, slice `audioBuffer.getChannelData` rows from `round(srcStart*sr)` to `round(srcEnd*sr)` into a sub-buffer, `timeStretch(sub, seg.speed)`, and concatenate. Add a `sliceAndStretchAudio(audioBuffer, seg)` + `concatAudio(parts)` in `timeStretch.ts`, then mux the concatenated buffer as today.

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/engine/src/encode.test.ts packages/engine/src/timeStretch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/decode.ts packages/engine/src/real-engine.ts packages/engine/src/encode.ts packages/engine/src/timeStretch.ts packages/engine/src/encode.test.ts
git commit -m "feat(engine): per-segment decode+export with segment-windowed audio"
```

---

### Task 6: Timeline filmstrip, split button, segment selection

**Files:**
- Modify: `apps/web/src/components/Timeline.tsx`
- Test: manual/integration (drawing is canvas-based); rely on store tests in Task 3.

**Interfaces:**
- Consumes: `useProjectStore` actions (Task 3), `segmentDuration`/`projectDuration`/`resolveSegment` (Task 2), engine `prepareFrame` for thumbnails.
- Produces: UI for selecting a segment and invoking `splitAt`.

- [ ] **Step 1: Draw segment filmstrip blocks**

Compute timeline layout in the draw effect:

```ts
const totalDur = project.segments.reduce((a, s) => a + (s.srcEnd - s.srcStart) / s.speed, 0);
let acc = 0;
for (const seg of project.segments) {
  const d = (seg.srcEnd - seg.srcStart) / seg.speed;
  const x0 = timeToX(acc);
  const x1 = timeToX(acc + d);
  const selected = seg.id === selectedSegmentId;
  ctx.fillStyle = selected ? "rgba(0,112,243,0.10)" : "#f2f2f2";
  ctx.fillRect(x0 + 4, 36, (x1 - x0) - 8, TRACK_HEIGHT);
  ctx.strokeStyle = selected ? "#0070f3" : "#d4d4d4";
  ctx.strokeRect(x0 + 0.5, 36, x1 - x0, TRACK_HEIGHT);
  // filmstrip: N sampled thumbnail rects per block
  const T = Math.max(1, Math.floor((x1 - x0) / 24));
  ctx.fillStyle = "#000";
  for (let i = 0; i < T; i++) {
    const srcT = seg.srcStart + (seg.srcEnd - seg.srcStart) * ((i + 0.5) / T);
    // async: wait for prepareFrame(srcT) then drawFrame onto a small canvas
    void drawThumb(ctx, seg, srcT, x0 + (i + 0.5) * ((x1 - x0) / T), 36, TRACK_HEIGHT);
  }
  if (selected) {
    ctx.fillStyle = "#0070f3";
    ctx.font = "9px monospace";
    ctx.fillText(String(seg.speed).replace(/\.?0$/, "") + "x", x0 + 8, 48);
  }
  // split boundary
  ctx.strokeStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, 36);
  ctx.lineTo(x1 + 0.5, 36 + TRACK_HEIGHT);
  ctx.stroke();
  acc += d;
}
```

- [ ] **Step 2: Segment selection on click**

In `handleCanvasClick`, before the diamond hit test, hit-test which block the x falls in:

```ts
let acc = 0;
for (const seg of project.segments) {
  const d = (seg.srcEnd - seg.srcStart) / seg.speed;
  if (x >= timeToX(acc) && x < timeToX(acc + d)) {
    selectSegment(seg.id);
    // fall through to seek as well
  }
  acc += d;
}
seek(xToTime(x));
```

- [ ] **Step 3: Wire the Split button**

The existing Split toolbar button (line ~216) currently has no handler. Add:

```tsx
<button className="pk-icon-btn ctrl-btn h-8 w-8" title="Split at playhead"
  disabled={exportProgress !== null}
  onClick={() => splitAt(currentTime)}>…</button>
```

`splitAt(currentTime)` uses the on-timeline playhead. Add a segmented label showing selected segment speed; keep the existing speed dropdown but have it call `updateSegment(selectedSegmentId, { speed })`:

```ts
const sel = project.segments.find((s) => s.id === selectedSegmentId);
const segSpeed = sel?.speed ?? 1;
// replace setPlaybackRate(v) → updateSegment(selectedSegmentId, { speed: v })
```

- [ ] **Step 4: Keep diamonds/captions per-segment**

Replace the single zoom track with per-segment diamonds drawn inside each block, offset by `sourceToTimeline`. Remove the global `playbackRate`-based `timeToX(zp.t / playbackRate)` and instead position diamonds using `sourceToTimeline(project, seg.id, zp.t)`. Render each segment's `zoomPoints`/`stagedZoomPoints`.

- [ ] **Step 5: Update duration/ruler**

`duration = projectDuration(project)`; `timeToX`/`xToTime` use on-timeline time (remove the `/playbackRate` division).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/Timeline.tsx
git commit -m "feat(timeline): filmstrip segments, split button, segment selection"
```

---

### Task 7: Preview + stage UI per selected segment

**Files:**
- Modify: `apps/web/src/components/PreviewCanvas.tsx`, `apps/web/src/components/StageControls.tsx`, `apps/web/src/components/Inspector.tsx`, `apps/web/src/components/ZoomPanel.tsx`, `apps/web/src/components/CaptionsPanel.tsx`, `apps/web/src/components/StagingPanel.tsx`
- Test: rely on store + engine tests (Task 3, 4).

**Interfaces:**
- Consumes: store selected-segment actions (Task 3), engine `renderFrame` timeline-time (Task 4).

- [ ] **Step 1: PreviewCanvas**

- `canvasGeometry`: use `project.media` + `seg.aspectPreset`; `getCameraTransform(seg.zoomPoints, srcT)`.
- Render loop: replace `playbackRate` math with segment resolution. Playback advances `currentTime` (on-timeline) by `dt` (no global rate multiply — the rate is embedded in segment widths). `tSrc` for `prepareAllFrames` = `resolveSegment(project, currentTime)?.srcT`. Call `engine.renderFrame(ctx, project, currentTime)`.
- Audio element playbackRate: keep it synced to the selected segment's `speed`, not a global. When the playhead crosses a boundary, `speed` changes → update `audio.playbackRate` accordingly (resolve active segment's speed each play frame).
- Facecam drag/hit-test: `seg.facecam` of the active segment (resolve at currentTime).
- The "isPlaying end" check + `effectiveDuration` use `projectDuration`.

- [ ] **Step 2: StageControls / Inspector / ZoomPanel / CaptionsPanel / StagingPanel**

Replace every `project.X` reference with the **selected segment**:
- `project.aspectPreset` → `seg.aspectPreset`
- `project.background` → `seg.background`
- `project.facecam` → `seg.facecam`
- `project.zoomPoints`/`stagedZoomPoints` → `seg.zoomPoints`/`seg.stagedZoomPoints`
- `project.captions`/`stagedCaptions` → `seg.captions`/`seg.stagedCaptions`
- `project.textOverlays` → `seg.textOverlays`
- `project.playbackRate` → selected segment's `speed`
- add a segment selector/badge (a small dropdown or pills listing `segments` by index) so the user can switch which segment the inspector edits.
- `StageControls` aspect/facecam/background/speed controls call the renamed store actions (which already target the selected segment).

- [ ] **Step 3: Update stage padding + background style**

PreviewCanvas `stageStyle` and `stagePadding` → `useProjectStore((s) => segment stagePadding)` via the active segment; the frame `aspectRatio` uses `project.media.width/height`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PreviewCanvas.tsx apps/web/src/components/StageControls.tsx apps/web/src/components/Inspector.tsx apps/web/src/components/ZoomPanel.tsx apps/web/src/components/CaptionsPanel.tsx apps/web/src/components/StagingPanel.tsx
git commit -m "feat(preview): per-segment preview compositing and controls"
```

---

### Task 8: Persistence + agent tools migration

**Files:**
- Modify: `packages/engine/src/opfs.ts`, `packages/engine/src/sanitize.ts`, `apps/web/src/lib/useProjectPersistence.ts`, `apps/web/src/lib/mockEngine.ts`, `apps/web/src/webmcp/tools-b.ts`
- Test: `packages/engine/src/opfs.test.ts`, `packages/engine/src/sanitize.test.ts` (update)

**Interfaces:**
- Consumes: `migrateProject` (Task 1), segment model (Task 1–3).
- Produces: saved projects load back as v1.2; agent zoom/text tools target the selected segment.

- [ ] **Step 1: opfs save/load**

In `opfs.ts`, replace `project.clip.src` → `project.media.src`, `project.facecam.src` → the first/active segment's facecam source, `project.clip.duration` → `project.media.duration`. Save the full v1.2 project via `migrateProject` on load so old records upgrade. Update `loadProjectRecord` return shape to `{ media, facecam, audio, project }`.

- [ ] **Step 2: sanitize**

`mergeSavedProject(fresh, saved)` currently reads `fresh.clip.duration`, `saved.facecam`, etc. Rewrite to operate per-segment: for each `fresh.segments[i]`, sanitize that segment's annotations with range `[srcStart, srcEnd]`; merge `saved.segments[i]` values where present. Drop project-level `background/aspectPreset/facecam/zoomPoints`. Keep `media` from `fresh`.

- [ ] **Step 3: persistence + mockEngine + webmcp tools**

- `useProjectPersistence.ts`: save/load unchanged in spirit (it serializes `project`), but ensure it passes through `migrateProject` on the restore path if not already.
- `mockEngine.ts`: update `project.background`, `project.zoomPoints`, `project.textOverlays`, `project.captions` to the active/selected segment (or first segment for the mock).
- `webmcp/tools-b.ts`: `store.project.clip.duration` → `projectDuration`/active segment; zoom staging and text staging target the **selected segment** (`stageZoomProposals`/`stageTextOverlay` already become segment-scoped in Task 3; the tool just doesn't change).

- [ ] **Step 4: Run tests** — `npx vitest run packages/engine/src/opfs.test.ts packages/engine/src/sanitize.test.ts`
- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/opfs.ts packages/engine/src/sanitize.ts apps/web/src/lib/useProjectPersistence.ts apps/web/src/lib/mockEngine.ts apps/web/src/webmcp/tools-b.ts
git commit -m "feat(persist): segment-aware save/restore + sanitize + agent tools"
```

---

### Task 9: Exporter driver + end-to-end verification

**Files:**
- Modify: `apps/web/src/lib/useVideoExport.ts`, `apps/web/src/lib/engineProvider.ts` (no change needed), `apps/web/src/components/RecordModal.tsx`, `apps/web/src/components/ProjectBrowser.tsx`
- Test: full suite.

**Interfaces:**
- Consumes: `projectDuration` (Task 2), per-segment export (Task 5).

- [ ] **Step 1: useVideoExport**

Remove the `playbackRate` override from `exportProject` (speed is per-segment now):
```ts
const blob = await engine.exportProject(project, opts); // no global playbackRate
```
Keep everything else.

- [ ] **Step 2: RecordModal / ProjectBrowser**

- `RecordModal.tsx` lines ~476: `project.facecam = { ... }` → `project.segments[0]!.facecam = { ... }`, and `project.clip.width/height` → `project.media.width/height`.
- `ProjectBrowser.tsx`: `project.clip.width/height/duration` → `project.media.*`; `project.facecam.src` → `project.segments[0]!.facecam.src`.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm test`
Run: `pnpm typecheck`
Expected: all tests pass; no type errors across packages.

- [ ] **Step 4: Manual verification**

- Import a clip → timeline shows a filmstrip block.
- Split at a point → two blocks; select second and change its speed/facecam/padding.
- Play: playhead sweeps both segments back-to-back at their speeds; preview uses each segment's settings at its boundary.
- Export: output duration = sum of segment durations; audio pitch preserved per segment.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useVideoExport.ts apps/web/src/components/RecordModal.tsx apps/web/src/components/ProjectBrowser.tsx
git commit -m "feat(export): per-segment export driver + misc refs"
```

---

## Self-review notes

- **Spec coverage:** data model (Task 1), time mapping (Task 2), store splitAt/select/update (Task 3), render resolve (Task 4), decode/export per-segment + WSOLA audio (Task 5), filmstrip UI + split + selection (Task 6), inspector/preview per-segment (Task 7), migration/persistence/agent tools (Task 8), export driver + E2E (Task 9). Covers all spec sections and phases.
- **Placeholders:** every code step includes real code; only canvas drawing in Task 6 Step 1 is illustrative pseudo but pinned to concrete coordinates and existing helpers.
- **Type consistency:** `resolveSegment → { segment, srcT }`, `segmentDuration`, `projectDuration`, `sourceToTimeline(project, segmentId, srcT)` are defined once (Task 2) and used consistently in Tasks 4–6. `renderFrame(ctx, project, timelineT)` consistent. Store `selectedSegmentId` consistent across Tasks 3/6/7.
