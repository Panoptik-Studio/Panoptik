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
3. `prepareFrame/getAudioBuffer/...` entry points get a media-resolution
   wrapper:
   - resolve the segment at `t` via `resolveSegment`
   - `mediaId = segment.mediaId ?? FIRST_MEDIA_ID`
   - if `mediaId !== activeMediaId` → `await swapToMedia(project, mediaId)`:
     `teardown()`, `openMedia(media.src)` (a blob URL already minted at
     import/restore)
   - for the facecam: same keying rule — when the **segment's** `facecam.src`
     differs from the loaded facecam, `setFacecamBlob(src)` swap. Export already
     does per-segment facecam swaps (`encode.ts:387`); this makes preview match.
   - audio sink: reopen from the same clip (its audio track), so both preview
     audio and `getAudioBuffer` serve the active clip.
4. Prefetch: in `prepareAllFrames`, if the upcoming boundary within 2s has a
   different `mediaId` and that media is not loaded, warm-open it **in
   parallel** without tearing down the active pipeline. On swap, keep open the
   prefetched pipeline (no double open).
5. Export (`encode.ts` already resolves `mediaForSegment` for sizing): the
   per-frame `prepareFrame` swap logic applies the same way — boundary swaps
   happen once per group of adjacent same-media segments. Verified path: keep
   `__isExporting` context; do NOT run prefetch in export.
6. `MediaEngine` interface: add `resolveMediaSwap` nothing public — swaps stay
   internal to prepare calls. `restoreProject` stays as-is (mints URLs; decode
   opens lazily).

Tests (`decode.test.ts` additions):
- two clips swapped at segment boundary: prepareFrame on seg A → seg B →
  seg A; the correct surfaces are presented (mock Inputs, count open/close).
- prefetch warms next media and swap reuses it.
- `loadClip` still tears down + fresh project (existing tests keep passing).

### B. Store — append actions (`apps/web/src/stores/projectStore.ts`)

1. `appendClip(media: Media, segment: Segment)`
   - `media: [...project.media, media]`
   - `segments: [...project.segments, segment]`
   - pushes history via existing `pushHistoryAndSet` (undo/redo free).
2. `appendRecordedProject(recorded: Project)`
   - for each `recorded.media[i]` push to `media`, for each segment push to
     `segments` — segment `mediaId` already points at the corresponding media
     id; facecam `src` URL and `audioSrc` ride along as-is.
   - history push.
3. Guard: no-op when `exportProgress !== null`.

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
   - canvas size effect: `mediaForSegment(project, activeSegment)` instead of
     `media[0]` (fall back to `primaryMedia(project)`).
   - clip audio `<audio>` element binds to the active segment's media src so
     sound follows the segment being previewed.
2. `useTimelineThumbnails.ts`
   - signature changes to key by media id: `Map<mediaId, cache>`. Timeline
     uses `cache = caches.get(seg.mediaId)` per filmstrip segment.
   - `generateThumbnailTimestamps` untouched (per-media durations).
3. Timeline drawing: segment filmstrip already per-segment; only the lookup of
   thumbnails needs the per-media cache. `useTimelineThumbnails` currently
   takes `project.media[0].src` — change to `(project)` with per-media caches.

### E. Persistence

No engine persistence changes: `opfs.ts` already writes/reads
`media-<id>.bin` and iterates all media on save and restore. Verify:
`saveProject` writes every media entry; `loadProjectRecord` mints URLs for all;
`restoreProject` decodes the active one lazily.

## Hot paths and risks

- `prepareFrame` gains a `resolveSegment` + `mediaId` branch per call (~µs).
- Prefetch must not tear down the active pipeline — only parallel warm; the
  swap path itself is the only teardown.
- Export must not prefetch (steady-state memory); swaps only at boundaries.
- Double-facecam-URL regressions: facecam key must be the segment src, not the
  media id (two segments can share a clip but have different takes).
- Old projects: v1.2/v1.3 migrations put `mediaId` in place, so swap path
  always resolves; guard `mediaId` undefined → `FIRST_MEDIA_ID`.

## Verification

- `pnpm test` — all existing 258 + new decode swap, store append, thumbnail
  per-media tests.
- `pnpm typecheck` — clean.
- `pnpm build` — clean.
- Manual: import clip A; plus → import clip B (appears at end, both filmstrip
  blocks correct); play across boundary (no stall thanks to prefetch); export
  (correct frames per segment); record take C (appends); reload page (both
  clips restore and play); undo/redo across append.
