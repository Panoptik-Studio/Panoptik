# Split Timeline — Design

Date: 2026-08-28
Status: Approved (brainstorming)

## Goal

Give the timeline a non-destructive **split** feature: divide the loaded recording
into independently-configurable segments, each with its own speed, stage padding,
facecam placement, aspect, background, and annotations (zooms / text / captions).
The timeline shows the clip as a thumbnail filmstrip split into adjacent segment
blocks, and splitting divides it into separate clips.

## Current model (v1.1)

- `Project` has a single `clip: { src, duration, width, height }`.
- All settings are global: `playbackRate`, `stagePadding`, `facecam`, `background`,
  `aspectPreset`, `zoomPoints`, `textOverlays`, `captions`.
- Timeline renders one block spanning the whole clip; playhead time is
  `source / globalRate`.

## New model (v1.2)

Replace the single clip with a shared media source plus a non-destructive segment
list. Segments reference the same source file by time range — splitting never
duplicates or re-encodes video.

```ts
type Media = {
  src: string;
  duration: number; // total source duration, seconds
  width: number;
  height: number;
};

type Segment = {
  id: string;
  srcStart: number; // seconds into the source (inclusive)
  srcEnd: number;   // seconds into the source (exclusive)
  speed: number;    // 0.25–3
  // per-segment presentation
  stagePadding: number;
  aspectPreset: AspectPreset;
  background: Background;
  facecam: Facecam; // pos / size / shape
  // per-segment annotations
  zoomPoints: ZoomPoint[];
  stagedZoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
};

type Project = {
  id: string;
  media: Media;               // replaces `clip`
  audioSrc?: string | null;
  segments: Segment[];        // concatenated, played back-to-back
  clickLog: ClickEvent[];
};
```

Removed from the global Project: `clip`, `playbackRate`, `stagePadding`,
`aspectPreset`, `background`, `facecam`, `zoomPoints`, `stagedZoomPoints`,
`textOverlays`, `stagedTextOverlays`, `captions`, `stagedCaptions` — all moved
onto `Segment`.

## Time mapping

On-timeline time is the concatenation of `segment.sourceDuration / segment.speed`.
A single shared utility (in the engine, e.g. `layout.ts` or a new `timeline.ts`)
is the only place this mapping lives, and preview, export, timeline, and inspector
all use it:

```ts
function segmentDuration(seg: Segment): number;                    // (srcEnd-srcStart)/speed
function projectDuration(project: Project): number;                // sum
function resolveSegment(project, timelineT): { segment; srcT };
function sourceToTimeline(project, segmentId, srcT): number;       // -1 if outside
```

- `splitAt(timelineT)` resolves the segment + source time, then replaces
  `[a, b]` with `[a, S]` and `[S, b]`, each a deep copy inheriting settings and
  annotations split by source time.
- Playhead stores **on-timeline** time. Preview/export convert to `srcT` for decode
  and `renderFrame`.

## Engine

- **decode.ts**: unchanged media-level. `prepareFrame(srcT)` already decodes source
  time; callers pass `srcT` from the resolver. Facecam pipeline unchanged (same
  shared source file).
- **render.ts**: `renderFrame(ctx, project, timelineT)` resolves `(segment, srcT)`
  and uses that segment's `background`, `aspectPreset`, `facecam`, `padding`,
  `zoomPoints`. Camera geometry helpers key off `project.media.*` +
  `segment.aspectPreset` instead of `project.clip.* + project.aspectPreset`.
- **encode.ts**: export iterates segments sequentially. Each segment renders frames
  at its own `speed`; audio is time-stretched per-segment with the existing WSOLA
  `timeStretch`, then concatenated segment-to-segment.
- **layout.ts**: `frameRect` / `outputSize` take `(media, aspectPreset)`.

## Store

Global `playbackRate` becomes per-segment `speed`; the old speed control edits the
**selected segment**. `facecam`, `stagePadding`, `background`, `aspectPreset`, and
annotation actions all operate on the **selected segment**.

New/rewritten actions:

```ts
setProject(p: Project): void;
clearProject(): void;
selectSegment(id: string): void;
splitAt(timelineT: number): void;                    // idempotent at exact boundary
updateSegment(id, updates: Partial<Segment>): void;  // any mutable scalar (speed, padding…)

// annotations now float against the selected segment:
addZoomPoint / removeZoomPoint / updateZoomPoint / stageZoomProposals / removeStagedZoom
addTextOverlay / updateTextOverlay / removeTextOverlay / stageTextOverlay / removeStagedTextOverlay
setCaptions / stageCaptions / clearStagedCaptions
setBackground / stageBackground
setFacecam
setStagePadding
setAspectPreset

// transport, undo/redo, export lock, persist — unchanged in spirit
```

Undo/redo snapshots the full `Project` (including `segments`) as today.

## Timeline UI

- **Segment blocks** drawn as a thumbnail filmstrip: evenly-spaced sampled frames
  within each segment via the existing decode, so the timeline shows the clip's
  actual content.
- Block width = `segmentDuration` (speed-driven); blocks are concatenated
  back-to-back; **split marks** render at boundaries.
- Click a block → `selectSegment`. A **Split** toolbar button splits at the playhead
  (or selected boundary).
- Playhead sweeps the concatenated strip.
- Zoom diamonds / text / captions / facecam render per-segment inside their block.

## Inspector / settings

The existing per-clip controls (speed, padding, facecam, background, aspect,
annotations panels) now target the **selected segment**. Selecting a different
segment re-targets them immediately; a badge/seg label indicates which segment is
active.

## Migration

Existing saved projects (v1.1, single `clip`) are upgraded on load: `media` is
copied from `clip`, and one implicit segment spans the full source
(`srcStart: 0, srcEnd: duration`) inheriting all previously-global settings and
annotations. `clip` is mapped to `media`; there is no drop of existing edits.

## Test plan

- **time mapping**: `resolveSegment`, `sourceToTimeline`, `projectDuration`,
  `segmentDuration` across multiple segments with differing speeds; split-point
  boundaries (exact, inside a hole, midpoint).
- **split**: produces two segments covering the full range, settings deep-copied,
  annotations partitioned by source time, idempotent at exact boundaries.
- **migration**: a v1.1 project object loads as a v1.2 project with one full-range
  segment and equivalent settings.
- **render**: `renderFrame` uses the segment active at `timelineT`
  (background/facecam/aspect/zooms switch at boundaries).
- **export**: sequential segments produce correct per-segment speed and audio
  durations; output duration equals `projectDuration`.
- **UI**: split button, block selection, filmstrip rendering (manual/integration).

## Implementation phases

1. Schema v1.2 + migration (`@panoptik/schema`, `opfs` load path).
2. Time-mapping utility + store rewrite (`engine`, `projectStore`).
3. Engine render/decode/export segment resolution.
4. Timeline filmstrip + split + selection UI.
5. Inspector per-segment settings wiring.
6. Verification: full test suite + typecheck + manual preview/export pass.

Each phase is independently testable; tests run per layer before moving on.
