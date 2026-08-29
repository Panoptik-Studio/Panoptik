# Multiclip Append — Design

**Date:** 2026-08-29
**Status:** approved
**Phases:** A (engine), B (store), C (UI), D (preview)

## Problem

The schema has supported multi-clip (`Project.media: Media[]`, `Segment.mediaId`)
since v1.3, but you can never create a project with more than one clip:

- `engine.loadClip()` always tears down and returns a fresh single-clip `Project`.
- Every import/record path replaces the whole project.
- The decode pipeline (`decode.ts`) holds exactly one clip's `Input`/`CanvasSink`.
- The preview ("preview window" sizing, filmstrip thumbnails, clip audio) only
  references `project.media[0]`.

The user's ask: build multiclip for real — a "+" affordance at the end of the
timeline, popup (import | record), and the new clip appended to the end of the
timeline as a new full-length segment.

## Goals

1. A "+" button at the end of the video filmstrip track in the timeline.
2. Clicking it opens a popover: **Import video** / **Record take**.
3. Import → decode file → clip appended as one full-length segment at the end.
4. Record → existing `RecordModal`; on stop, the take appends instead of
   replacing the project.
5. The engine decodes whichever media is under the playhead (swap-on-demand),
   for both preview and export, so a timeline mixing two clips plays and
   renders correctly.
6. Everything persists (OPFS already iterates `media[]`), restores, and
   survives a reload.

Non-goals this round (per user):
- No clip-manager popover (no rename clip, no delete-whole-clip action).
- Appended clips are trimmed/split/deleted via existing timeline controls only.
- No reordering of `media[]` (exists at schema level; not touched here).
- No trimming dialog at import time — full clip lands, user trims later.

## Approach

Swap-on-demand decode (option A):

- Only the media under the playhead has an open decode pipeline.
- The pipeline is torn down and reopened when a different `mediaId` becomes
  active.
- A prefetch warms the next media's pipeline as the playhead approaches a
  boundary (within 2s), so the swap is invisible during playback.
- Lazy open also benefits restore: only the active clip is decoded at any
  moment, not every clip in the project.

Chosen over all-open registry (B) for memory and for touching far less of the
delicate single-pipeline state the existing tests pin down; the LRU registry
(C) is a later drop-in if projects regularly hold 5+ distinct clips.

## Architecture

### A. Engine — swap-on-demand (`packages/engine/src/decode.ts`, `real-engine.ts`)

Current: `input`, `sink`, `depth`, `iterator`, `objectUrl` are module-level and
describe exactly one clip. `loadClip()` calls `teardown()` then opens the new
file, and returns a Project with ONE media.

Changes:

1. Track the loaded media: `let activeMediaId: string | null = null;`
2. Extract the "open a clip from blob + url" body of `loadClip` into
   `openMedia(url: string): Promise<{ duration, width, height }>`, called by
   `loadClip` and by the swap path.
3. The caller drives the swap — `prepareFrame(t)` receives a **source** time
   for the active clip and has no `Project` context, so a new exported
   function carries the state:
   ```ts
   export async function activateMedia(
     mediaId: string,        // FIRST_MEDIA_ID for single-clip projects
     src: string | null,     // blob URL of the clip to make active
   ): Promise<void>
   ```
   `activateMedia` is a no-op when `mediaId === activeMediaId`; otherwise it
   tears down (`teardown()`) and re-opens via `openMedia(src)`, and resets
   `activeMediaId`. The facecam swap mirrors it: activate keyed on the
   **segment's** `facecam.src` (two segments can share a clip with different
   takes).
   - `loadClip` keeps its behavior — sets `activeMediaId = FIRST_MEDIA_ID`.
   - `loadRecording`/`restoreProject` set it too (single active clip on open).
4. `MediaEngine` interface: add `activateMedia` so `real-engine.ts` forwards it.
5. Prefetch: in `PreviewCanvas`'s loop (it has the `Project` and the active
   segment) — when the playhead is within 2s of a boundary with a different
   `mediaId`, call `activateMedia` for that media *and* warm its frames via a
   parallel `prepareFrame` — see "hot paths" below. Export does **no**
   prefetch; its per-segment loop calls `activateMedia(mediaId, media.src)`
   once per boundary (adjacent same-media segments group into one swap).

Tests (`decode.test.ts` additions):
- two clips swapped at segment boundary: prepareFrame on seg A → seg B →
  seg A; the correct surfaces are presented (mock Inputs, count open/close).
- activateMedia is idempotent for the same id (no teardown).
- `loadClip` still tears down + fresh project (existing tests keep passing).

### B. Store — append actions (`apps/web/src/stores/projectStore.ts`)

1. `appendClip(media: Media, segment: Segment)`
   - `media: [...project.media, media]`
   - `segments: [...project.segments, segment]`
   - pushes history via existing `pushHistoryAndSet` (undo/redo free).
2. `appendRecordedProject(recorded: Project)`
   - for each `recorded.media[i]` push to `media`, for each segment push to
     `segments` — segment `mediaId` already points at the corresponding media
     id; facecam `src` URL and `audioSrc` ride along as-is. Ensure the recorded
     project's media ids are unique against the current project (rename via
     `crypto.randomUUID()` if a collision occurs).
   - history push.
3. Guard: both no-op when `exportProgress !== null` or no loaded project.

Tests (`projectStore.test.ts`):
- `appendClip` adds media + one segment, undo removes, redo restores.
- `appendRecordedProject` merges all media & segments; undo reverts.

### C. UI — timeline "+" and popover (`apps/web/src/components/Timeline.tsx`)

1. Draw a subtle dashed "add-clip" zone on the canvas after the last segment in
   the video track (`VIDEO_TRACK_Y`, width ≈ 40px at `x=timeToX(duration)`).
   A round `+` button sits as a DOM overlay inside the scroll area at that
   position (DOM for clickability and hover styling; canvas just draws the
   dashed zone).
2. Button click → popover (`AddClipPopover` local component):
   - **Import video file** — hidden `<input type=file accept="video/*">`, on
     file: `engine.loadClip(file)` → take `proj.media[0]` & `proj.segments[0]`
     → `store.appendClip(...)`. The preview's existing effects and rAF
     `prepareFrame` loop pick up the new project automatically.
   - **Record take** — `window.dispatchEvent(open-record-modal)` with an
     append flag on the event detail so `RecordModal` knows to append.
   - Cancel / click-away closes popover.
3. `RecordModal.tsx`: on take finish, if append mode → `engine.loadRecording`
   already ran; instead of `setProject(proj)` call
   `appendRecordedProject(proj)`, then clear append flag.
4. Loading/disabled states: `+` button disabled while `exportProgress !== null`.

Tests: component-level for popover open/close and option click wiring
(openRecordModal dispatch), RecordModal append flag behavior (may be covered
by store-level append test + manual).

### D. Preview — follow active segment

1. `PreviewCanvas.tsx`
   - rAF loop: `resolveActive` already yields the active segment; before
     `prepareAllFrames`, call `await engine.activateMedia(active.mediaId,
     mediaForSegment(project, seg).src)` (idempotent per clip).
   - **Facecam keying**: when the active segment's `facecam.src` differs from
     the facecam currently loaded, hit `engine.setFacecamBlob` with the segment
     src — same rule export uses (`encode.ts:387`).
   - canvas size effect: `mediaForSegment(project, activeSegment)` instead of
     `media[0]` (fall back to `primaryMedia(project)`).
   - clip audio `<audio>` element binds to the active segment's media src so
     sound follows the segment being previewed (reuse existing
     `screenSrc`-per-frame logic; swap to `mediaForSegment`-resolved src).
   - **Prefetch**: within 2s of a boundary whose next segment has a different
     `mediaId`, warm `activateMedia(nextMediaId, nextSrc)` + one
     `prepareFrame` at the boundary start time; guard so it never runs twice
     for the same boundary and never fights export (`__isExporting`).
2. `useTimelineThumbnails.ts`
   - signature changes to key by media id: `Map<mediaId, cache>`. Timeline
     uses `cache = caches.get(seg.mediaId)` per filmstrip segment.
   - `generateThumbnailTimestamps` untouched (per-media durations).
3. Timeline drawing: segment filmstrip already per-segment; only the lookup of
   thumbnails needs the per-media cache. `useTimelineThumbnails` currently
   takes `project.media[0].src` — change to `(project)` with per-media caches.

Export swap: `encode.ts`'s frame loop calls `activateMedia(seg.mediaId,
mediaForSegment(project, seg).src)` at each segment boundary so frames come
from the right clip (no prefetch there).

### E. Persistence

`saveProject` already iterates every media entry and writes `media-<id>.bin`
(`opfs.ts:183-186`); `mediaFileName` is correct. But restore is single-clip
today and needs work:

- `loadProjectRecord` (`opfs.ts:299`) reads only `clip.webm` — it returns one
  `media: Blob`. Change to `mediaFiles: (Blob | null)[]` aligned with
  `project.media` order (`clip.webm` for index 0 has the historic fallback).
- `real-engine.restoreProject` (`real-engine.ts:60-104`) demuxes via
  `loadRecording(saved.media)`, which produces a 1-clip `fresh` project;
  `mergeSavedProject` then maps `fresh.media` — so clips 2+ would vanish.
  Change: keep the demux of media[0] (primes the pipeline + facecam/audio),
  then mint blob URLs for every other `mediaFiles[i]` and extend
  `fresh = { ...fresh, media: [fresh.media[0], ...mintedAdditional] }` before
  the merge. `mergeSavedProject` already handles multi-media and per-segment
  `mediaId` (`sanitize.ts:286-335`).
- Decode opens additional media lazily by its minted src when the app activates
  a segment from it — no restore-time decode of every clip.

Verify with manual test: save project with 2 clips, reload, both clips play.

## Hot paths and risks

- `prepareFrame(t)` grabs a `const mediaId = activeMediaId` before starting the
  pump; a swap in-flight changes the pipeline underneath — the pump must abort
  and re-run after activation (documented: activation is `await`ed by the
  caller before `prepareFrame`).
- Prefetch only warms the *next* media pipeline; the active one is never torn
  down concurrently. Guard: keep a `prefetchBoundaryKey` and a flag so the same
  boundary cannot warm twice.
- Facecam swap must be keyed on segment `facecam.src`, never on media id
  (two segments can share a clip but use different takes).
- Export: swaps once per media boundary; no prefetch. `__isExporting` remains
  the gate for both preview pause and prefetch suppression.
- Old projects: v1.2/v1.3 migrations put `mediaId` in place, so swap path
  always resolves; guard `mediaId` undefined → `FIRST_MEDIA_ID`.
- Recorded take id collisions: `loadRecording` mints fresh ids per take, but
  re-append after undo could collide — `appendRecordedProject` renames on
  collision.

## Verification

- `pnpm test` — all existing 258 + new decode swap, store append, thumbnail
  per-media tests.
- `pnpm typecheck` — clean.
- `pnpm build` — clean.
- Manual: import clip A; plus → import clip B (appears at end, both filmstrip
  blocks correct); play across boundary (no stall thanks to prefetch); export
  (correct frames per segment); record take C (appends); reload page (both
  clips restore and play); undo/redo across append.
