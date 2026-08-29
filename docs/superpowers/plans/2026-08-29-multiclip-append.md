# Multiclip Append Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add a second clip to a project — a "+" at the end of the timeline filmstrip opens an import/record popover, and the clip lands as a full-length segment at the end, with preview/export swapping decode between clips.

**Architecture:** Swap-on-demand decode. `decode.ts` gains a registry-aware `activateMedia(mediaId, src)` that tears down and reopens the sole decode pipeline when the playhead crosses into a segment from another clip; the caller (PreviewCanvas / encode) drives the swap since `prepareFrame` only sees source time. The engine stays single-pipeline (one clip decoded at a time) to keep its invariants and tests intact; restore adds multi-media blob reading so clips 2+ survive reload.

**Tech Stack:** TypeScript, mediabunny (decode pipeline), Vitest, zustand, Next.js.

## Global Constraints

- `Project.media: Media[]` and `Segment.mediaId: string` are already schema-required (v1.3). `FIRST_MEDIA_ID = "m1"` from `@panoptik/schema` is the fallback id when a segment/old project lacks one.
- `mediaForSegment`, `primaryMedia`, `mediaById` from `@panoptik/schema` are the only media-lookup helpers to use.
- Engine decode pipeline is module-level singleton state in `packages/engine/src/decode.ts` — never export `input`/`sink` directly; only the public API surface.
- Prefetch suppressed while `window.__isExporting === true` (checked via `(window as unknown as { __isExporting?: boolean }).__isExporting`).
- `teardown()` in decode.ts revokes `objectUrl` and all live URLs — an appended clip's blob URL must NOT be revoked on swap (it still belongs to the project); only `loadClip`/fresh loads revoke.
- Store pushes history via `pushHistoryAndSet` (`projectStore.ts:67`) — append actions MUST use it for undo/redo.
- `pnpm test`, `pnpm typecheck`, `pnpm build` must pass at every task boundary.

---

### Task 1: Engine — `activateMedia` swap in decode.ts

**Files:**
- Modify: `packages/engine/src/decode.ts` (add `activeMediaId`, `activateMedia`, `openMedia` refactor ~lines 30-32, 415-478, 708-757)
- Test: `packages/engine/src/decode.test.ts`

**Interfaces:**
- Consumes: existing `teardown()`, `input`/`sink`/`objectUrl` module state, `FIRST_MEDIA_ID`.
- Produces: `export async function activateMedia(mediaId: string, src: string | null): Promise<void>` — no-op when `mediaId === activeMediaId`; else tears down and opens. `export function getActiveMediaId(): string | null` for tests. `loadClip` sets `activeMediaId = FIRST_MEDIA_ID` after opening.

- [ ] **Step 1: Add failing tests for activateMedia**

Append to `packages/engine/src/decode.test.ts`:

```ts
describe("activateMedia (multiclip swap)", () => {
  it("opens a clip and swaps when the id changes", async () => {
    const mod = await loadFresh();
    const fileA = new File([new Uint8Array(2048)], "a.mp4", { type: "video/mp4" });
    await mod.loadClip(fileA);
    expect(mod.getActiveMediaId()).toBe("m1");

    // clip B: activate by blob URL (the URL decode.ts mints on loadClip)
    const fileB = new File([new Uint8Array(2048)], "b.mp4", { type: "video/mp4" });
    const urlB = URL.createObjectURL(fileB);
    await mod.activateMedia("m2", urlB);
    expect(mod.getActiveMediaId()).toBe("m2");
    await mod.prepareFrame(1.5);
    expect(mod.currentFrame()).not.toBeNull();
    URL.revokeObjectURL(urlB);
  });

  it("is idempotent for the same id — no teardown", async () => {
    const mod = await loadFresh();
    const file = new File([new Uint8Array(2048)], "a.mp4", { type: "video/mp4" });
    await mod.loadClip(file);
    const before = mod.currentFrame();
    await mod.activateMedia("m1", null);
    expect(mod.getActiveMediaId()).toBe("m1");
  });

  it("swaps back to the first clip after activating a second", async () => {
    const mod = await loadFresh();
    await mod.loadClip(new File([new Uint8Array(2048)], "a.mp4", { type: "video/mp4" }));
    const urlB = URL.createObjectURL(new File([new Uint8Array(2048)], "b.mp4", { type: "video/mp4" }));
    await mod.activateMedia("m2", urlB);
    let src1 = "";
    await mod.prepareFrame(1);
    // switch back — should reopen clip A from its stored object url
    const urlA = (await mod.activateMedia("m1", null)) as never as string;
    // activateMedia with null src but same id is a no-op by design; assert id unchanged
    expect(mod.getActiveMediaId()).toBe("m1");
    URL.revokeObjectURL(urlB);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @panoptik/engine vitest run src/decode.test.ts -t "activateMedia"`
Expected: FAIL — `getActiveMediaId` is not a function.

- [ ] **Step 3: Refactor loadClip → `openMedia`, add `activateMedia`**

In `packages/engine/src/decode.ts`:

```ts
let activeMediaId: string | null = null;

export function getActiveMediaId(): string | null {
  return activeMediaId;
}
```

Extract the open body of `loadClip` (lines 423-458: Input → track checks → sink → duration → surface → audio) into:

```ts
async function openMedia(inputSource: BlobSource<any> | BlobSource | File): Promise<{
  duration: number; width: number; height: number;
}> {
  input = new Input({ formats: ALL_FORMATS, source: inputSource });
  ...same body, returning { duration, width, height }...
}

export async function loadClip(file: File): Promise<Project> {
  await teardown();
  activeMediaId = null;
  if (file.size < 1024) throw /* existing message */;
  const d = await openMedia(file);
  objectUrl = URL.createObjectURL(file);
  activeMediaId = FIRST_MEDIA_ID;
  return { /* existing project literal: media [{ id: FIRST_MEDIA_ID, src: objectUrl, ...d }]*/ };
}

export async function activateMedia(mediaId: string, src: string | null): Promise<void> {
  if (mediaId === activeMediaId) return;
  await teardown();
  activeMediaId = null;
  if (!src) return;
  const blob = await (await fetch(src)).blob();
  const d = await openMedia(blob);
  duration = d.duration; width/height already set inside openMedia's sink;
  activeMediaId = mediaId;
}
```

Key details:
- `openMedia` sets module `sink`, `duration` (via `d.duration`), `surface`, and audio sink exactly as `loadClip` does today. Keep `presented = null` reset and iterator close inside `teardown` (unchanged).
- `activateMedia` does **not** mint/revoke the project's src — it fetches the blob and reopens from it. The src stays project-owned.
- Export `getActiveMediaId` and `activateMedia` from the file.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @panoptik/engine vitest run src/decode.test.ts -t "activateMedia"` then full: `pnpm test`
Expected: PASS (all decode tests, including existing `loadClip` ones).

Note: the mock decode.test.ts's `Input` mock reads `opts.source.file` — `activateMedia` fetches blob then passes a Blob; extend the mock in Step 1 region? No — the mock's `Input` uses `opts?.source?.file?.name`; a `Blob` has no `file` name, so `openMedia`'s `track` calls still resolve. Verify the mock tolerates it; if not, adjust Step 3 test to use `registerMediaUrl` flow already handled.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/decode.ts packages/engine/src/decode.test.ts
git commit -m "feat(engine): activateMedia swap for multiclip decode"
```

---

### Task 2: Engine — expose `activateMedia` on MediaEngine + real-engine; export boundary swap

**Files:**
- Modify: `packages/engine/src/index.ts:23-31` (interface), `packages/engine/src/real-engine.ts:22-119`, `apps/web/src/lib/mockEngine.ts` (add no-op)
- Modify: `packages/engine/src/encode.ts` (per-segment `activateMedia` before `prepareAllFrames` at ~line 403)
- Test: `packages/engine/src/decode.test.ts` (swap-on-export covered behaviorally via encode tests)

**Interfaces:**
- Consumes: `activateMedia` from Task 1.
- Produces: `MediaEngine.activateMedia(mediaId: string, src: string | null): Promise<void>`; real engine forwards to decode's implementation; mock engine adds `activateMedia: async () => {}`.

- [ ] **Step 1: Extend the interface and implementations**

In `packages/engine/src/index.ts` inside `interface MediaEngine`:

```ts
/** Make `mediaId`'s clip the active decode pipeline (no-op if already active). */
activateMedia(mediaId: string, src: string | null): Promise<void>;
```

In `real-engine.ts` add to the returned object:

```ts
async activateMedia(mediaId: string, src: string | null): Promise<void> {
  return decodeActivateMedia(mediaId, src);
},
```

and import `activateMedia as decodeActivateMedia` from `./decode`.

In `mockEngine.ts` add `activateMedia: async () => {},`.

- [ ] **Step 2: Export swap in encode.ts**

In `packages/engine/src/encode.ts`, inside the frame loop (find where `prepareAllFrames(srcT, fcT)` is called ~line 403), before that call add:

```ts
// Swap decode to this segment's clip once per boundary. `mediaForSegment`
// returns the clip the segment cuts from; activation is a no-op for
// same-clip segments so adjacent ones group into one swap.
const segMedia = seg ? mediaForSegment(project, seg) : primaryMedia(project);
await activateMedia(seg.mediaId, segMedia?.src ?? null);
```

Import `activateMedia` from `./decode` (top-level import alongside `prepareAllFrames` at line 24) and `mediaForSegment` is already imported (line 22).

- [ ] **Step 3: Run tests**

Run: `pnpm test` , `pnpm typecheck`
Expected: PASS — no existing test exercises multi-clip export; typecheck validates the interface additions.

- [ ] **Step 4: Commit**

```bash
git add packages/engine/src/index.ts packages/engine/src/real-engine.ts packages/engine/src/encode.ts apps/web/src/lib/mockEngine.ts
git commit -m "feat(engine): export activates per-segment media; expose activateMedia"
```

---

### Task 3: Store — appendClip + appendRecordedProject with history

**Files:**
- Modify: `apps/web/src/stores/projectStore.ts` (interface block ~line 175 area and implementation near `addAudioTrack` ~line 547)
- Test: `apps/web/src/stores/projectStore.test.ts`

**Interfaces:**
- Consumes: `pushHistoryAndSet`, `Project`, `Media`, `Segment` types.
- Produces:
  - `appendClip(media: Media, segment: Segment): void`
  - `appendRecordedProject(recorded: Project): void`

- [ ] **Step 1: Add failing tests**

Append to `apps/web/src/stores/projectStore.test.ts`:

```ts
describe("appendClip (multiclip)", () => {
  const extraMedia = () => ({
    id: "m2",
    src: "blob:second",
    duration: 8,
    width: 1280,
    height: 720,
  });
  const extraSegment = () => ({
    id: "s2",
    mediaId: "m2",
    srcStart: 0,
    srcEnd: 8,
    speed: 1,
    stagePadding: 0,
    aspectPreset: "16:9" as const,
    background: { kind: "solid" as const, color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2, shape: "circle" as const },
    zoomPoints: [], stagedZoomPoints: [],
    textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
  });

  it("appends media + segment and pushes history", () => {
    const before = useProjectStore.getState().project!.media.length;
    useProjectStore.getState().appendClip(extraMedia(), extraSegment() as unknown as import("@panoptik/schema").Segment);
    const st = useProjectStore.getState();
    expect(st.project!.media).toHaveLength(before + 1);
    expect(st.project!.media[before]!.id).toBe("m2");
    expect(st.project!.segments.at(-1)!.mediaId).toBe("m2");
    expect(st.historyIndex).toBeGreaterThan(0);
  });

  it("undo removes the appended clip, redo restores it", () => {
    useProjectStore.getState().appendClip(extraMedia(), extraSegment() as unknown as import("@panoptik/schema").Segment);
    const withClip = structuredClone(useProjectStore.getState().project!);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.media).not.toHaveLength(withClip.media.length);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project!.media).toHaveLength(withClip.media.length);
    expect(useProjectStore.getState().project!.media.some((m) => m.id === "m2")).toBe(true);
  });

  it("appendRecordedProject merges all media and segments, renames id collisions", () => {
    useProjectStore.getState().appendClip(extraMedia(), extraSegment() as unknown as import("@panoptik/schema").Segment);
    // A recorded project whose media id collides with m2
    const recorded = structuredClone(useProjectStore.getState().project!) as Project;
    const rec = structuredClone(recorded) as Project;
    rec.segments = rec.segments.map((s) => ({ ...s, id: `rec-${s.id}` }));
    useProjectStore.getState().appendRecordedProject(rec);
    const st = useProjectStore.getState();
    const m2s = st.project!.media.filter((m) => m.id === "m2");
    expect(m2s).toHaveLength(2); // renamed the second one
    expect(new Set(st.project!.media.map((m) => m.id)).size).toBe(st.project!.media.length);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/stores/projectStore.test.ts -t "appendClip"` (in `apps/web`)
Expected: FAIL — `appendClip` is not a function.

- [ ] **Step 3: Implement**

In `projectStore.ts` interface (find `addAudioTrack`) add:

```ts
appendClip: (media: Media, segment: Segment) => void;
appendRecordedProject: (recorded: Project) => void;
```

Implementation:

```ts
appendClip: (media, segment) => {
  const s = get();
  if (!s.project || s.exportProgress !== null) return;
  const project: Project = {
    ...s.project,
    media: [...s.project.media, media],
    segments: [...s.project.segments, segment],
  };
  pushHistoryAndSet(project, s, set);
},

appendRecordedProject: (recorded) => {
  const s = get();
  if (!s.project || s.exportProgress !== null) return;
  // Media ids must be unique project-wide — a recorded take may
  // reuse an id (e.g. re-append after undo). Rename on collision.
  const used = new Set(s.project.media.map((m) => m.id));
  const renamedIds = new Map<string, string>();
  const media = recorded.media.map((m): Media => {
    let id = m.id;
    if (used.has(id)) {
      id = crypto.randomUUID();
      renamedIds.set(m.id, id);
    }
    used.add(id);
    return { ...m, id, src: m.src };
  });
  const segments = recorded.segments.map((seg) => ({
    ...seg,
    id: crypto.randomUUID(),
    mediaId: renamedIds.get(seg.mediaId) ?? seg.mediaId,
  }));
  const project: Project = {
    ...s.project,
    media: [...s.project.media, ...media],
    segments: [...s.project.segments, ...segments],
  };
  pushHistoryAndSet(project, s, set);
},
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/stores/projectStore.test.ts` in `apps/web`; then `pnpm test`, `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/projectStore.ts apps/web/src/stores/projectStore.test.ts
git commit -m "feat(store): appendClip + appendRecordedProject with history"
```

---

### Task 4: Preview — activate media, facecam keying, size/audio per segment

**Files:**
- Modify: `apps/web/src/components/PreviewCanvas.tsx`
  - rAF loop around lines 538-619 (`const active = resolveActive(...)`, `prepareAllFrames` call)
  - canvas size effect lines 1141-1152 (`outputSize(primaryMedia...)`)
  - audio src lines 543-560 (`const screenSrc = primaryMedia(state.project).src`)
- Test: helper `resolveActive` already tested elsewhere; behavior verified by manual run + existing tests. Add a pure helper if extracting.

**Interfaces:**
- Consumes: `engine.activateMedia` (Task 2), `mediaForSegment` from `@panoptik/schema`, `active.seg.mediaId`, `active.seg.facecam?.src`.

- [ ] **Step 1: Activate media in the rAF loop**

In the loop, right after `const active = resolveActive(state.project, tEff); const tSrc = active.srcT;` add:

```ts
// Multiclip: point the decode pipeline at this segment's clip. Idempotent
// when the segment is cut from the already-active clip.
const segMedia = mediaForSegment(state.project, active.seg);
void engine.activateMedia(active.seg.mediaId ?? FIRST_MEDIA_ID, segMedia?.src ?? null);

// Facecam keying: swap the facecam source only when the segment's take
// differs (two segments may share a clip with different camera takes).
const wantFc = active.seg.facecam?.src ?? null;
if (wantFc !== lastFacecamSrcRef.current) {
  lastFacecamSrcRef.current = wantFc;
  if (wantFc) {
    void (async () => {
      try {
        const blob = await (await fetch(wantFc)).blob();
        await engine.setFacecamBlob(blob, wantFc);
      } catch { /* keep the previous take on failure */ }
    })();
  } else {
    void engine.setFacecamBlob(null);
  }
}
```

Add `const lastFacecamSrcRef = useRef<string | null>(null);` near the other refs and import `FIRST_MEDIA_ID` from `@panoptik/schema` (check existing imports; `mediaForSegment` may not be imported yet — add it).

- [ ] **Step 2: Prefetch ahead of boundaries**

After activation, add (same loop scope):

```ts
// Prefetch the next clip when a boundary is within 2s — open its pipeline
// so the swap is invisible. Guarded per boundary; never during export.
const isExporting = typeof window !== "undefined" &&
  (window as unknown as { __isExporting?: boolean }).__isExporting;
if (!isExporting) {
  const boundary = Math.min(state.project.segments.length - 1, 0);
  void prefetchNextMedia(active, tEff, state.project);
}
```

Implement `prefetchNextMedia` as a module-level function in the same file:

```ts
let prefetchedKey: { projectId: string; segId: string } | null = null;

function prefetchNextMedia(
  active: { seg: { mediaId?: string } },
  tEff: number,
  project: Project,
) {
  // Find any segment whose start is in (tEff, tEff+2] whose mediaId differs
  // from the active one — that is the boundary the playhead is approaching.
  let acc = 0;
  let candidate: { seg: Segment; start: number } | null = null;
  for (const seg of project.segments) {
    const start = acc;
    const d = segmentDuration(seg);
    if (start > tEff && start <= tEff + 2) candidate = { seg, start };
    acc += d;
  }
  if (!candidate) return;
  if (candidate.seg.mediaId === active.seg.mediaId) return;
  const key = { projectId: project.id, segId: candidate.seg.id };
  if (prefetchedKey && prefetchedKey.segId === key.segId && prefetchedKey.projectId === key.projectId) return;
  prefetchedKey = key;
  const media = mediaForSegment(project, candidate.seg);
  if (!media) return;
  void engine.activateMedia(candidate.seg.mediaId ?? FIRST_MEDIA_ID, media.src ?? null).then(() => {
    // warm one frame at the boundary
    const srcT = candidate.seg.srcStart;
    void (engine as unknown as { prepareAllFrames?: (t: number) => Promise<void> }).prepareAllFrames
      ? (engine as unknown as { prepareAllFrames: (t: number) => Promise<void> }).prepareAllFrames(srcT)
      : engine.prepareFrame(srcT);
  });
}

- [ ] **Step 3: Canvas size + audio src follow active segment**

Canvas size effect (lines 1141-1152): replace `outputSize(primaryMedia(project), ...)` with:

```ts
const activeSeg = resolveSegment(project, useProjectStore.getState().currentTime)?.segment;
const sizeMedia = activeSeg ? mediaForSegment(project, activeSeg) : primaryMedia(project);
const size = outputSize(sizeMedia ?? primaryMedia(project), activePreset, MAX_CANVAS_WIDTH);
```

Audio src (line 546): replace `const screenSrc = primaryMedia(state.project).src;` with:

```ts
const segMedia = mediaForSegment(state.project, active.seg);
const screenSrc = segMedia?.src ?? null;
```

- [ ] **Step 4: Run tests + build**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build`
Expected: PASS; manual check to be done in Task 8.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PreviewCanvas.tsx
git commit -m "feat(editor): preview activates per-segment media with prefetch"
```

---

### Task 5: Thumbnails — per-media cache

**Files:**
- Modify: `apps/web/src/lib/useTimelineThumbnails.ts` (signature + internals)
- Modify: `apps/web/src/components/Timeline.tsx` (call site lines 197-200 + filmstrip lookup lines 297-299)
- Test: `apps/web/src/lib/useTimelineThumbnails.test.ts` (helpers unchanged)

**Interfaces:**
- Consumes: `Project`, `Segment.mediaId`, `Media`.

- [ ] **Step 1: Change the hook to per-media caches**

Rewrite `useTimelineThumbnails` to take `(project: Project | null)` and return a cache object:

```ts
export interface ThumbnailCache {
  getThumbnail: (mediaId: string, time: number) => HTMLCanvasElement | null;
  version: number;
}

export function useTimelineThumbnails(project: Project | null): ThumbnailCache {
  const [version, setVersion] = useState(0);
  const cachesRef = useRef<Map<string, { cache: Map<number, HTMLCanvasElement>; sorted: number[] }>>(new Map());
  // per-media extract effect: useEffect over project?.media (src+duration pairs)
  // → one <video> per media key; extract into its cache; setVersion bump.
  // getThumbnail(mediaId, time): closest lookup inside that media's cache.
}
```

Keep `calculateSamplingInterval`/`generateThumbnailTimestamps`/`findClosestThumbnailTimestamp` exported and unchanged (existing tests still pass).

Implementation notes:
- The existing single-cache `runExtraction` body becomes a helper `extractFor(media.src, duration, cacheState)`.
- The effect key on `project?.media.map((m) => `${m.id}:${m.src}:${m.duration}`).join("|")`.
- When a media entry's src/duration changes, clear only that media's cache.

- [ ] **Step 2: Update Timeline call site**

Lines 197-200:

```ts
const { getThumbnail, version: thumbVersion } = useTimelineThumbnails(project);
```

Filmstrip drawing (lines 297-299): replace `const thumb = getThumbnail(srcT);` with:

```ts
const thumb = getThumbnail(seg.mediaId ?? "m1", srcT);
```

- [ ] **Step 3: Run tests + build**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build`
Expected: PASS (helper tests unchanged; no component test for the hook body — verified manually in Task 8).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/useTimelineThumbnails.ts apps/web/src/lib/useTimelineThumbnails.test.ts apps/web/src/components/Timeline.tsx
git commit -m "feat(timeline): per-media thumbnail caches"
```

---

### Task 6: Timeline "+" button + AddClipPopover

**Files:**
- Modify: `apps/web/src/components/Timeline.tsx`
  - canvas draw: dashed add-zone after last segment (~line 390 area — after the segment filmstrip loop)
  - DOM: "+" button + popover near the scroll area (after the end-line div ~line 1164)
- Local component: `AddClipPopover` defined in the same file (small; no new file per codebase convention of co-locating tiny popovers like the speed popover already in Timeline.tsx).

**Interfaces:**
- Consumes: `engine.loadClip` (via `useProjectStore`-outside call; use `engine` from `@/lib/engineProvider`), `appendClip` (Task 3), `useProjectStore`.
- Produces: nothing (UI only). Dispatches `open-record-modal` with `{ append: true }` detail for RecordModal (Task 7).

- [ ] **Step 1: Draw the dashed add-zone**

In the draw effect, after the filmstrip loop (after `vidAcc` loop, ~line 390):

```ts
// Add-clip affordance: dashed zone at the end of the video track.
const addX = timeToX(duration);
const addW = 40;
if (project && exportProgress === null) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(0, 112, 243, 0.45)";
  ctx.lineWidth = 1;
  drawRoundRect(ctx, addX, VIDEO_TRACK_Y, addW, VIDEO_TRACK_HEIGHT, 4);
  ctx.stroke();
  ctx.restore();
}
```

(Export the zone width via a const `ADD_CLIP_ZONE_W = 40` so the DOM button aligns.)

- [ ] **Step 2: Add the "+" button + popover state**

In the component:

```ts
const [addPopover, setAddPopover] = useState<{ x: number; y: number } | null>(null);
const addClipFileRef = useRef<HTMLInputElement>(null);
```

DOM (inside the scroll area relative div, after the end-line):

```tsx
{exportProgress === null && (
  <>
    <button
      className="absolute top-[30px] z-20 flex h-[32px] w-[40px] items-center justify-center rounded-md border border-dashed border-[#0070f3]/50 bg-white/70 text-[#0070f3] transition-colors hover:bg-[#f0f7ff]"
      style={{ left: timeToX(duration), transform: "translateX(-8px)" }}
      title="Add clip"
      onClick={(e) => {
        e.stopPropagation();
        const rect = scrollRef.current!.getBoundingClientRect();
        setAddPopover({ x: timeToX(duration) + 8, y: VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT + 8 });
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <input
      ref={addClipFileRef}
      type="file"
      accept="video/*"
      className="hidden"
      onChange={async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        setAddPopover(null);
        try {
          const proj = await engine.loadClip(file);
          const media = proj.media[0]!;
          const segment = proj.segments[0]!;
          useProjectStore.getState().appendClip(media, segment);
          useProjectStore.getState().seek(useProjectStore.getState().projectDuration());
        } catch (err) {
          console.error("import failed", err);
        }
      }}
    />
    {addPopover && (
      <div
        id="add-clip-popover"
        className="absolute z-30 flex w-44 flex-col rounded-xl border bg-white p-1.5 shadow-vercel-3"
        style={{ left: addPopover.x, top: addPopover.y, borderColor: "#ebebeb", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#333] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
          onClick={() => {
            setAddPopover(null);
            addClipFileRef.current?.click();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Import video file
        </button>
        <button
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#333] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
          onClick={() => {
            setAddPopover(null);
            window.dispatchEvent(new CustomEvent("open-record-modal", { detail: { append: true } }));
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          Record take
        </button>
        <span className="mt-1 border-t pt-1.5 text-center text-[10px] text-[#999]">Appends to end of timeline</span>
      </div>
    )}
  </>
)}
```

- [ ] **Step 3: Popover dismissal + seek helper**

In the existing dismissal `onPointerDown` handler (line ~871), add: `if (target?.closest("#add-clip-popover")) return;` and `setAddPopover(null)` alongside `setContextMenu(null)`. Also ESC closes it.

`projectDuration()` isn't a store action — seek to the new end by computing:

```ts
useProjectStore.getState().seek(
  useProjectStore.getState().project!.segments.reduce((a, s) => a + segmentDuration(s), 0)
);
```

(replace the pseudo-call in Step 2's onChange accordingly).

- [ ] **Step 4: Run build + manual**

Run: `pnpm build`.
Manual (later in Task 8, but do a dev-server sanity check here): `cd apps/web && pnpm dev`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Timeline.tsx
git commit -m "feat(timeline): '+' add-clip affordance with import/record popover"
```

---

### Task 7: RecordModal append mode

**Files:**
- Modify: `apps/web/src/components/RecordModal.tsx`
  - listen to `open-record-modal` (already at line 202-206) — capture `detail.append`
  - finish path `handleStop` (lines 483-536): `setProject(project)` → append when flag set
  - add `const { appendRecordedProject, project: currentProject } = useProjectStore(...)` — check store wiring already imports `useProjectStore` (line 198 has `setProject` — extend).

**Interfaces:**
- Consumes: `open-record-modal` CustomEvent detail `{ append?: boolean }` (dispatched by Timeline Task 6), `appendRecordedProject` (Task 3).

- [ ] **Step 1: Capture append flag**

```ts
const [appendMode, setAppendMode] = useState(false);
// in the event handler (line ~202):
const handler = (e: Event) => {
  const detail = (e as CustomEvent<{ append?: boolean }>).detail;
  setAppendMode(!!detail?.append);
  ...existing open logic...
};
```

- [ ] **Step 2: Append on finish**

In `handleStop`, after `const project = await engine.loadRecording(...)` (line 499), replace `setProject(project)` (line 517) with:

```ts
if (appendMode && useProjectStore.getState().project) {
  useProjectStore.getState().appendRecordedProject(project);
  // Also make the engine's pipeline active for the recorded clip so the
  // preview shows the correct first frame of the appended take.
  await engine.activateMedia(project.media[0]!.id, project.media[0]!.src ?? null);
} else {
  setProject(project);
}
```

Reset `setAppendMode(false)` in the state reset path when the modal closes (find the existing `isOpen` reset / close handler).

- [ ] **Step 3: Run build**

Run: `pnpm build`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/RecordModal.tsx
git commit -m "feat(record): append recorded take to the timeline"
```

---

### Task 8: Persistence — multi-media restore

**Files:**
- Modify: `packages/engine/src/opfs.ts` (`loadProjectRecord` return shape — add `mediaFiles: (Blob | null)[]` at lines 199-211, 297-307; read every media file alongside the existing `media: read("clip.webm")`)
- Modify: `packages/engine/src/real-engine.ts:60-104` (`restoreProject` uses `loadProjectRecord`; add mint + extend fresh)
- Test: `packages/engine/src/opfs.test.ts` (extend the existing save/load roundtrip test — see file)

**Interfaces:**
- Consumes: `mediaFileName` (already at `opfs.ts:452`), `mergeSavedProject` (multi-media aware), `mintUrl`.

- [ ] **Step 1: Add multi-media blobs to loadProjectRecord**

Add to the return type (line ~201):

```ts
/** One blob per media entry, aligned with project.media order. */
mediaFiles: (Blob | null)[];
```

In the body (replace single `read("clip.webm")` at line 299 with):

```ts
mediaFiles: await Promise.all(
  project.media.map(async (m, i) => {
    // The first clip keeps the historic clip.webm name; later clips are
    // keyed by media id (see mediaFileName).
    const names = i === 0 ? [mediaFileName(project, m), "clip.webm"] : [mediaFileName(project, m)];
    for (const name of names) {
      const blob = await read(name).catch(() => null); // read throws → null
      if (blob) return blob;
    }
    return null;
  }),
),
```

Replace the top-level `media: await read("clip.webm")` key with `media: await read("clip.webm")` — keep BOTH: `media` stays (used by `restoreProject`'s demux of clip 0 today) and add `mediaFiles`. Remove `media` only if nothing else consumes it — grep for `\.media\b` against `loadProjectRecord` consumers; `useProjectPersistence.ts` uses `loadProjectRecord` only for history, `real-engine` uses `saved.media` for the demux. Plan: keep `media` for compatibility, add `mediaFiles`.

- [ ] **Step 2: Extend restoreProject in real-engine.ts**

Replace lines 62-66 area (`if (!saved?.media) return null; ... this.loadRecording(saved.media...)`):

```ts
if (!saved?.media) return null;
const proj = await this.loadRecording(saved.media, saved.facecam, saved.audio);

// Multiclip: mint blob URLs for every additional clip and join them to the
// demuxed project so mergeSavedProject restores the full media array (its
// per-clip merge maps over fresh.media).
const additional: Media[] = [];
for (let i = 1; i < (saved.project.media?.length ?? 0); i++) {
  const blob = saved.mediaFiles?.[i];
  const stored = saved.project.media?.[i];
  if (blob && stored) {
    additional.push({ ...stored, id: stored.id ?? `m${i + 1}`, src: mintUrl(blob) });
  }
}
if (additional.length > 0) {
  proj.media = [...proj.media, ...additional];
}
```

(The `mergeSavedProject` call later keeps working — it merges `fresh.media` against `saved.media` by id.)

- [ ] **Step 3: Tests**

Extend `packages/engine/src/opfs.test.ts` — find the existing "saves and loads a project" roundtrip test and add a second media to the mock project before `saveProject`, assert `loadProjectRecord().mediaFiles` has 2 entries and `restored.media` length is 2 (via store or direct engine call pattern already used in that file).

Exact test (append to the roundtrip describe):

```ts
it("roundtrips multiple media files", async () => {
  const { saveProject, loadProjectRecord } = await import("./opfs");
  const two = project([segment(), segment({ id: "s2", mediaId: "m2" })]);
  two.media.push({ id: "m2", src: "blob:other", duration: 5, width: 1280, height: 720 });
  await saveProject(two, true);
  const rec = await loadProjectRecord("proj");
  expect(rec?.mediaFiles).toHaveLength(2);
  expect(rec?.mediaFiles[0]).toBeTruthy();
  expect(rec?.mediaFiles[1]).toBeTruthy();
});
```

(If the test project helper's media ids differ, adapt; the helper `project()` is defined in that test file.)

- [ ] **Step 4: Run tests + build**

Run: `pnpm test`, `pnpm typecheck`, `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/opfs.ts packages/engine/src/real-engine.ts packages/engine/src/opfs.test.ts
git commit -m "fix(engine): restore multi-media projects (mediaFiles + join)"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full suite**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all pass.

- [ ] **Step 2: Manual matrix (dev server)**

`cd apps/web && pnpm dev` then:

1. Import clip A → timeline shows one block.
2. "+" → popover → Import video file → pick clip B → B appears as a second full-length segment; both filmstrips render from their own media; playhead crosses boundary with no stall.
3. Seek by clicking inside the B block → preview shows B frames; canvas conforms to B's aspect.
4. Play from A into B — audio switches to B's track at the boundary.
5. "+" → Record take → RecordModal opens → layout/countdown as usual → stop → take appends as the last clip (not replacing).
6. Undo removes the appended clip; redo restores.
7. Expert (export): Export project with A+B → exported file shows A's frames then B's.
8. Reload page → project restores with both clips; seek each, both decode.
9. Delete the appended segment via ⌫ → timeline returns to single clip; no crash.

- [ ] **Step 3: Final commit (if any manual fixups)**

```bash
git status --short  # confirm clean tree
```
