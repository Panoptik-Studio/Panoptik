# Panoptik Feature Expansion — Design

**Date:** 2026-08-29
**Status:** Approved (design reviewed section-by-section with owner)
**Scope:** 10 features: A5 (export/preview improvements), B1 (music + ducking), B2 (segment fades), B3 (annotations), B5 (multi-clip), C1 (auto-polish), C2 (auto-chapters), C3 (voiceover), C4 (WebMCP restructuring tools), L1 (library "start new project")

---

## Context

Panoptik is a client-side demo video editor + screen recorder (Next.js 15 + pnpm monorepo, mediabunny/WebCodecs, Zustand, OPFS). Shipped today: single-media multi-segment timeline, dual-stream recording with reshoot takes, zoom keyframes with staged ghost proposals, dual-track audio with WSOLA time-stretch, facecam PiP, backgrounds, local Whisper captions, 9 WebMCP tools with staging/commit flow, MP4/WebM export 720p–4K, library page. 208 tests green.

The current data model (`schema v1.2`) has `Project.media: Media` (single clip) and `Segment` with `srcStart/srcEnd/speed/...` mapping into that one media.

## Decisions locked with owner

1. **Multi-clip model:** one flat continuous timeline. Segments reference a `mediaId` into `Project.media: Media[]`. Clips can be interleaved and reordered.
2. **Sequencing:** foundation first — Phase 1 data model (B5+C2) → Phase 2 audio (B1+C3) → Phase 3 visual (B2+B3+A5) → Phase 4 AI (C4+C1). No rework; later features build against the final model.
3. **YAGNI cuts:** no crossfade transitions (timeline is strictly sequential), no music speed-stretch (music runs on wall-clock timeline time), no per-track EQ/compressor, no agent-supplied audio files.

---

## 0. Library "Start New Project" (L1)

The library page (`/projects`, the birds-eye view of all clips) currently only opens existing projects — there is no way to begin a fresh one from there; "Open editor" restores whatever was last open.

- A dashed **"+ New project"** card as the first tile in the grid (Figma/Canva pattern), sized like a `ProjectCard`; plus a **"New project"** button in the header next to "Open editor".
- Behavior: clear the `LAST_PROJECT_KEY` localStorage pointer, `clearProject()` on the store, navigate to `/editor` — landing in the editor's fresh state (drop zone + Record entry), never silently restoring the last clip. This reuses the exact restore mechanism the cards use, keeping a single restore path.
- The empty state's "Record or import" button stays as-is (same action).
- No schema or engine changes — pure UI plus the two existing calls (`localStorage` + `clearProject()`).

---

## 1. Schema v1.3 + Multi-Clip Foundation (B5) + Chapters (C2)

### Schema (`packages/project-schema/src/index.ts`)

```ts
export type Media = {
  id: string;             // stable id, referenced by segments
  src: string;            // object URL for this session; re-minted from OPFS on load
  duration: number; width: number; height: number;
};

export type Segment = {
  id: string;
  mediaId: string;        // which clip this segment cuts from
  name?: string;          // chapter/scene name (C2)
  // ...existing fields unchanged (srcStart/srcEnd reference the segment's media)
};

export type Project = {
  id: string;
  name?: string;
  media: Media[];         // single object → array
  segments: Segment[];
  clickLog: ClickEvent[];
  // audioTracks, annotations, transitions also land here (see §2–§3)
};
```

**Migration:** one bump to v1.3 introducing ALL new fields with defaults (wrap `media` into array, stamp `mediaId = media[0].id`, `audioTracks: []`, `annotations: []`, transitions undefined). Old projects load unchanged. All later phases light up without further migrations.

### Engine

- **decode.ts:** the single global `Input`/`CanvasSink` becomes a `Map<mediaId, MediaDecoder>` registry. Each `MediaDecoder` = Input + CanvasSink + surface, built exactly like today's pipeline (pump/hole logic preserved per instance). Seeking across a media boundary targets the next media's decoder. Export keeps the sequential-iterator pattern per media.
- **audio.ts:** `getAudioBuffer(project)` → `getMediaAudioBuffer(mediaId)`; per-segment `sliceAndStretchAudio` mixing pulls from each segment's own media buffer.
- **opfs.ts:** `clip.webm` → `media/<mediaId>.<ext>` per clip; load re-mints object URLs per media id; deleting a media removes its file.
- **Store:** new `reorderSegments(from, to)` action + timeline drag. Import appends segments for the new media after the selected segment (or at end).

### UX

- Toolbar "Import" → "Add clip"; timeline shows a divider + clip label at media boundaries; Inspector shows "Source clip" row.
- **C2 chapters:** "Auto-chapters" action groups captions into chapters at silence gaps > 1.5s, names each segment from its first caption words, writes `Segment.name`. Timeline displays names. Fully local, uses existing Whisper output.

### Tests

Migration v1.3 roundtrip; decoder-registry tests (seek across media boundary, dispose on media removal); OPFS multi-media save/load roundtrip; chapter grouping pure-function tests; reorder action with undo/redo.

---

## 2. Audio Layer — Music, Ducking, Voiceover (B1 + C3)

### Schema

```ts
export type AudioTrack = {
  id: string;
  kind: "music" | "voiceover";
  name?: string;
  src: string;              // object URL; re-minted from OPFS on load
  duration: number;
  volume: number;           // 0–2
  startT: number;           // timeline offset where the track begins
  fadeIn?: number; fadeOut?: number;   // seconds
  ducking?: number | null;  // 0–1, how much to duck under dialogue (music only)
};
// Project gains: audioTracks: AudioTrack[]
```

### Behavior

- Music and voiceover run on **wall-clock timeline time** — they ignore segment speed (background music would sound wrong time-stretched; one consistent rule for both kinds).
- **Import:** file input → `decodeViaAudioContext` (exists in audio.ts) → AudioBuffer cached in a registry keyed by track id. MP3/WAV/M4A/OGG via decodeAudioData.
- **Export:** the existing per-segment mix loop (screen + mic, speed-stretched) produces the base track unchanged. A new pass sums each AudioTrack at its `startT` with a volume envelope (fadeIn/fadeOut/track volume). **Ducking** = pure function `computeDuckingEnvelope(baseBuffer, { amount })`: RMS over ~50ms windows of the dialogue mix, music gain eases down where speech is present. Both envelope and mix are unit-testable pure functions.
- **Preview:** tracks play via Web Audio `AudioBufferSourceNode` scheduled by the existing playback loop — sample-accurate, no `<audio>` element juggling.
- **Voiceover (C3):** "Record voiceover" → optional countdown → timeline plays from playhead while `getUserMedia({ audio: true })` + `MediaRecorder` capture → stop decodes to an AudioTrack (`kind: "voiceover"`, `startT` = playhead position at start). Multiple takes = multiple tracks. Audio-only reuse of `record.ts` capture patterns; no new engine surface.

### UX

- **Audio panel** in Inspector: track list, volume sliders, fade in/out, ducking toggle + amount, mute, delete.
- Timeline: thin lane under the existing audio waveform; each track's waveform block draggable to move `startT`.

### OPFS

`audio/<trackId>.<ext>` alongside `media/`; round-trips on load like facecam takes.

### Tests

Ducking envelope; mix math (fades, offsets, overlap summing); voiceover track creation; store actions (add/update/remove AudioTrack with history); OPFS roundtrip.

---

## 3a. Visual Layer — Fades, Annotations, Export/Preview (B2 + B3 + A5)

### Segment fades (B2)

```ts
// Segment gains:
transitionIn?: { kind: "fade" | "dipToBlack"; dur: number };
transitionOut?: { kind: "fade" | "dipToBlack"; dur: number };
```

- No crossfades — the timeline is strictly sequential; crossfades would require holding two segments' frames. Fades render the segment background (or black) with an alpha ramp; the audio mix loop applies the same ramp at boundaries so sound doesn't pop.
- UI: transition controls in the segment Inspector (kind + duration).

### Annotations (B3)

```ts
export type Annotation = {
  id: string;
  kind: "arrow" | "rect" | "highlight" | "freehand";
  points: number[];      // flat [x,y,...] normalized 0–1 relative to FRAME
  color: string; strokeWidth: number;
  startT: number; endT: number;
  staged: boolean;
};
// Segment gains: annotations: Annotation[]; stagedAnnotations: Annotation[]
```

- Drawn **inside the camera transform** (after video frame, before facecam/text) so arrows follow zoomed content.
- UI: arrow/rect/highlight/freehand tools; draw on paused preview (pointer capture like focal-drag); timeline timing bar like text overlays; Inspector for color/width/timing/delete. Staged annotations render amber ghosts (existing staging system).

### Export/preview improvements (A5)

- **Cancel:** `AbortSignal` through the encode loop; Cancel button in ExportPanel disposes output and restores UI.
- **Background export:** decoder is shared with preview, so true parallel editing is out of scope; closing the export modal keeps exporting with a progress chip in the Toolbar.
- **Preview-quality toggle:** Full (decode ≤1920, current) vs Fast (decode ≤960). Sink re-created on toggle; export always full res.

---

## 3b. AI Layer — WebMCP Tools + Auto-Polish (C4 + C1)

### New WebMCP tools (C4)

`split_segment(t)`, `delete_range(start, end)` (split-split-delete composite), `set_speed(segmentIds, speed)`, `add_music(trackId, startT)`.

- Timeline geometry can't be meaningfully ghosted → these use the **confirm-dialog** path (like `export_clip`), not staging. All map onto existing store actions.
- `add_music` picks from **already-imported** audio tracks + sets `startT`; returns an actionable error when none exist (agents cannot upload audio locally).
- Refactor: tool bodies move into lib functions callable both by `modelContext` registration and by auto-polish directly.

### Auto-polish (C1)

`lib/autoEdit.ts` — one "Polish this demo" button runs a local pipeline with progress steps; **everything lands staged** for human commit (existing flow):

1. Captions via Whisper if none exist
2. Chapters → `Segment.name` (C2 logic)
3. Zoom proposals from `clickLog` + caption/text activity heuristics
4. Background suggestion (curated gradient rotation)

Review panel = existing StagingPanel; Commit/Discard unchanged.

---

## Rollout

| Phase | Features | Exit criteria |
|---|---|---|
| 1 | L1 + B5 + C2 | "New project" from library lands in a fresh editor; multi-clip import/reorder/export works end-to-end; chapters name segments; all tests green |
| 2 | B1 + C3 | music + voiceover audible in preview & export; ducking verifiable; all tests green |
| 3 | B2 + B3 + A5 | fades + annotations render in preview & export; export cancel works; quality toggle |
| 4 | C4 + C1 | 4 tools tested through an agent session; auto-polish produces a committable staged diff |

Each phase: TDD where logic is pure (mixing, envelopes, chapter grouping, geometry), `pnpm test && pnpm typecheck` green before moving on, conventional commits per feature, branch per phase.

## Out of scope (explicitly cut)

Crossfade transitions; music/voiceover speed manipulation; per-track effects (EQ/compressor); agent-uploaded audio; true parallel preview-while-exporting; PDF import; GIF export; Chrome extension (unchanged from earlier roadmap cuts).
