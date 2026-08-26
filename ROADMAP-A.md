# Panoptik — Execution Roadmap: DEV A (Media Pipeline + Shell UI)

> **How to use this doc:** Work top-to-bottom, tick checkboxes (`- [ ]`) as you go. Every task lists exact files, verification commands, and a commit step. Your counterpart works from `ROADMAP-B.md`. File ownership is strict (matrix below) — you NEVER edit B-owned files, B never edits yours. If you want an agent to execute a task, hand it the task block verbatim (REQUIRED SUB-SKILL for agents: superpowers:subagent-driven-development or superpowers:executing-plans).

**Goal:** Own the byte-to-pixel pipeline — unified demux (video + audio), camera render, WebCodecs export — AND the app shell (page, toolbar, export modal, inspector, staging panel), plus 4 engine-facing WebMCP tools, the declarative form, deployment, README, and the Devpost technical sections.

**Architecture:** Browser-native media engine. mediabunny demuxes/muxes; WebCodecs decodes/encodes underneath; Canvas2D composites through ONE `renderFrame()` shared by preview and export ("preview equals export"). Zero server, zero uploads, zero ffmpeg.wasm.

**Tech Stack:** TypeScript, mediabunny (`Input`, `VideoSampleSink`, `AudioSampleSink`, `Output`, `CanvasSource`, `AudioBufferSource`), WebCodecs, `document.modelContext.registerTool` (WebMCP), Vitest, Vercel.

---

## Global constraints (apply to every task)

- **Deadline:** Thu Sep 3, 2026, 4:00 PM EDT (= 1:30 AM GMT+5:30 Fri Sep 4). Plan to submit Wed Sep 3 by noon EDT.
- **No server. No uploads. No API keys.** All media processing client-side. No ffmpeg.wasm.
- **API spelling:** `document.modelContext.registerTool(...)` — never `navigator.modelContext` in app code.
- Declarative HTML attributes hyphenated: `tool-name`, `tool-description`.
- Do NOT use `requestUserInteraction()` (doesn't exist). Confirmation = B's `showConfirmDialog()` called inside your `execute()`.
- Read-only tools MUST carry `annotations: { readOnlyHint: true }`.
- Do NOT use `toolautosubmit`.
- Package scope: `@panoptik/*`.
- Conventional commits, branch per task, PR to `main`, B reviews same day.

---

## File ownership matrix (LOCKED — the anti-conflict guarantee)

| YOU own (edit only you) | DEV B owns (never touch) |
|---|---|
| `packages/utils/**`; `packages/engine/src/{decode,render,encode,audio,layout,test-fixtures}.ts`; `index.ts` except B-region | `packages/engine/src/record.ts` + its re-export line in the B-region |
| `app/editor/page.tsx`; `components/{Toolbar,ExportPanel,Inspector,StagingPanel}.tsx`; `lib/engineProvider.ts` | `stores/**`; `lib/{mockEngine,zoomGeometry,audio16k}.ts`; `workers/**` |
| `webmcp/{lifecycle,tools-a,index}.ts`; `README.md`; Devpost technical sections; benchmarks | `webmcp/{confirm,tools-b}.ts` |
| Vercel config, deploy, CI-ish chores | `components/{PreviewCanvas,Timeline,RecordModal,CaptionsPanel,ConfirmDialog,ToolTrace}.tsx` |

Shared conventions making this safe:
- **Stub-first:** each dev creates their own component stubs on Day 1; your `page.tsx` imports all slots from Day 1 and never changes imports again.
- **engine/index.ts regions:** your exports at top; a `// #region B-modules (do not edit outside)` block where B adds the `record` re-export line.
- **Capture/ingest boundary:** DEV B's `record.ts` only CAPTURES (`getDisplayMedia`/`getUserMedia`/`MediaRecorder` → blobs). Blobs become a project via `engine.loadRecording(...)`, whose DEMUX half lives in YOUR `decode.ts`. Standard streams for B; zero raw-container parsing for them, no duplicated mediabunny state anywhere.
- You MAY *consume* B's store from your UI (`useProjectStore()` hooks / actions) — you just never EDIT store files. Your **WebMCP tools** remain read-only on the store.

---

## Calendar

| Day | Date | You: backend | You: frontend |
|---|---|---|---|
| Day 1 | Thu Aug 27 | Scaffold + contract + easing + camera math + decode | Page shell, drop zone, canvas proof |
| Day 2 | Fri Aug 28 | renderFrame v1 + facecam PiP + unified audio extraction | Toolbar wired to store |
| Day 3 | Sat Aug 29 | Export encoder (consumes YOUR getAudioBuffer) + progress events | ExportModal + Inspector; **14:00 integration host** |
| Day 4 | Sun Aug 30 | Perf + codec edge cases | StagingPanel + modal polish; **README.md**; **deploy to Vercel** |
| Day 5 | Mon Aug 31 | lifecycle.ts + 4 WebMCP tools | Annotate ExportPanel (declarative form) |
| Day 6 | Tue Sep 1 | Tool error-shape polish + final deploy | Demo support; **Devpost technical sections + architecture diagram + benchmarks** |
| Day 7 | Wed Sep 2 | Buffer + dress rehearsal (joint) | |
| SHIP | Thu Sep 3 | Submit before 4:00 PM EDT | |

**Fixed checkpoints you are accountable for:**

| When | You deliver |
|---|---|
| Day 1, 13:00 | Contract PR merged (joint) |
| Day 1 EOD | Drop file → decoded frame paints in the shell |
| Day 2 EOD | Real import through YOUR ui; unified `getAudioBuffer` green — B's captions depend on it |
| Day 3, 14:00 | `loadClip` + `prepareFrame` + `renderFrame` stable — B swaps off mockEngine |
| Day 3 EOD | Manual export (modal + progress) produces playable MP4 |
| Day 4, 17:00 | HTTPS Vercel URL rendering real video |
| Day 5, 09:30 | `lifecycle.ts` pushed — B depends on it |
| Day 6, 12:00 | Feature freeze; all your tools green in agent test |

---

## The locked contract (agreed jointly Day 1 — never change without both devs present)

Delta vs Spec.md (contract v1.1): `Background` is a discriminated union; GIF cut from `ExportOpts`; engine gains `prepareFrame`/`getAudioBuffer`; `renderFrame` synchronous off an internal cache; **audio extraction is unified into YOUR decode pipeline (single mediabunny `Input`, no duplicate parsing); only the persistence module is B's** (re-exported via the engine package).

```ts
// packages/project-schema/src/index.ts
export type ZoomPoint = {
  id: string;
  t: number;                                    // seconds
  to: { scale: number; x: number; y: number };  // focal, normalized 0-1 relative to FRAME rect
  dur: number;
  ease: string;                                 // key of EASINGS
  staged: boolean;                              // ghost proposal
};

export type TextOverlay = {
  id: string;
  text: string;
  timestamp: number;
  position: "top" | "bottom" | "center";
  staged: boolean;
};

export type Caption = { text: string; start: number; end: number };

export type Background =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; stops: [string, string] }
  | { kind: "blur" };

export type Facecam = { src: string | null; x: number; y: number; size: number };

export type ClickEvent = { t: number; x: number; y: number; type: "click" | "scroll" | "move" | "manual" };

export type AspectPreset = "16:9" | "9:16" | "1:1" | "4:3";

export type Project = {
  id: string;
  clip: { src: string; duration: number; width: number; height: number };
  zoomPoints: ZoomPoint[];          // committed — ONLY input to camera transform
  stagedZoomPoints: ZoomPoint[];    // ghosts — never affect rendering
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
  background: Background;
  facecam: Facecam;
  clickLog: ClickEvent[];
  aspectPreset: AspectPreset;
};

export type ExportOpts = {
  format: "mp4" | "webm";
  resolution: "720p" | "1080p" | "4k";
  burnCaptions: boolean;
};

// packages/engine — split ownership, one interface
export interface MediaEngine {
  prepareFrame(t: number): Promise<void>;                        // YOU
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number): void; // YOU
  loadClip(file: File): Promise<Project>;                        // YOU
  loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project>; // YOU
  getAudioBuffer(project: Project): Promise<AudioBuffer | null>; // YOU — unified with decode's single Input
  exportProject(project: Project, opts: ExportOpts): Promise<Blob>; // YOU
}
// Persistence (saveProject/loadProject/listProjects) lives in engine/opfs.ts — B's.
// Capture (startRecording → blobs) lives in engine/record.ts — B's; blobs land back here in loadRecording (yours).
```

**Rendering rules you implement (B relies on them):**
1. Camera transform from `project.zoomPoints` (committed) ONLY.
2. Composition order: background (full canvas) → letterboxed frame with camera transform → facecam PiP (screen space) → text overlays → captions. Staged text/captions drawn amber (#f59e0b).
3. Canvas ≠ clip size (aspect presets / export res): background fills canvas; frame letterboxed centered; ALL normalized coords relative to the **frame rect**.
4. Text overlays display 3s from timestamp; captions between start/end.
5. Keyframe semantics: at `k.t`, ease FROM current state TO `k.to` over `k.dur`, then hold. Zoom-out = keyframe targeting identity.

---

## Your fixtures

```ts
// packages/engine/src/test-fixtures.ts — yours; B imports it too
import type { Project } from "@panoptik/schema";

export function mockProject(): Project {
  return {
    id: "test",
    clip: { src: "", duration: 15, width: 1920, height: 1080 },
    zoomPoints: [
      { id: "z1", t: 3, to: { scale: 2.2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: false },
      { id: "z2", t: 6, to: { scale: 1, x: 0.5, y: 0.5 }, dur: 0.6, ease: "easeInOutCubic", staged: false },
    ],
    stagedZoomPoints: [],
    textOverlays: [{ id: "t1", text: "Sign in", timestamp: 3, position: "top", staged: false }],
    stagedTextOverlays: [{ id: "t2", text: "agent pending", timestamp: 8, position: "bottom", staged: true }],
    captions: [{ text: "Welcome to the demo", start: 0, end: 2 }],
    stagedCaptions: [],
    background: { kind: "gradient", stops: ["#6366f1", "#a855f7"] },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [{ t: 3.1, x: 0.5, y: 0.5, type: "click" }],
    aspectPreset: "16:9",
  };
}

export function mockProjectWithStaged(): Project {
  const p = mockProject();
  p.stagedZoomPoints = [{ id: "g1", t: 9, to: { scale: 2.5, x: 0.3, y: 0.3 }, dur: 0.7, ease: "easeInOutCubic", staged: true }];
  return p;
}
```

---

## Day 1 — Thu Aug 27: Scaffold + contract + decode + shell

### Task 0.1 (JOINT, morning ~2h): Monorepo scaffold + lock contract

- [ ] Scaffold (you drive terminal):

```bash
mkdir -p apps/web packages/engine/src packages/project-schema/src packages/utils/src
pnpm init
printf "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n" > pnpm-workspace.yaml
pnpm add -w -D typescript vitest
npx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
```

- [ ] `apps/web/next.config.ts`: `{ output: "export", images: { unoptimized: true } }`
- [ ] Package skeletons: `@panoptik/schema` (contract block above), `@panoptik/utils`, `@panoptik/engine` (+ `"mediabunny": "^1.0.0"`).
- [ ] Root `vitest.config.ts`: projects `packages/*/src` + `apps/web/src`, environment `node`.
- [ ] Licenses NOW (submission requirement): root `LICENSE` = AGPL-3.0; `packages/engine/LICENSE` = MIT.
- [ ] Root `vercel.json`:

```json
{
  "buildCommand": "pnpm --filter @panoptik/web build",
  "outputDirectory": "apps/web/out",
  "installCommand": "pnpm install",
  "framework": null
}
```

- [ ] Component stubs, split by ownership — B creates `PreviewCanvas`, `Timeline`, `RecordModal`, `CaptionsPanel`, `ToolTrace`, `ConfirmDialog`; YOU create `Inspector` + `StagingPanel` + your `Toolbar` (each `export function X() { return null; }`). You create `page.tsx` importing ALL slots. Neither of you edits `page.tsx` imports again.
- [ ] Green build → merge `chore: scaffold monorepo + lock contract v1.1`.

### Task 1.2: utils — easing (TDD)

**Files:** `packages/utils/src/easing.ts`, `easing.test.ts`

- [ ] Failing tests: endpoints/midpoint of `easeInOutCubic`, `lerp(1,3,0.5)=2`, registry keys `["easeInOutCubic","easeOutCubic","linear"]`.
- [ ] Implement:

```ts
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const EASINGS: Record<string, (t: number) => number> = {
  easeInOutCubic, easeOutCubic, linear: (t) => t,
};
```

- [ ] `pnpm vitest run packages/utils` PASS. Commit: `feat(utils): easing functions + registry`.

### Task 1.3: camera transform (TDD, pure)

**Files:** `packages/engine/src/render.ts`, `render.test.ts`

- [ ] Failing tests: identity before first keyframe; target reached after `dur`; mid-flight halfway; zoom-out via identity-target keyframe; staged points ignored.
- [ ] Implement sequential fold (fixes Spec.md §A3 bug where a lone keyframe skipped its ease-in):

```ts
import { EASINGS, easeInOutCubic, lerp } from "@panoptik/utils";
import type { ZoomPoint } from "@panoptik/schema";

export type Transform = { scale: number; x: number; y: number };
export const IDENTITY: Transform = { scale: 1, x: 0.5, y: 0.5 };

export function getCameraTransform(points: ZoomPoint[], t: number): Transform {
  let state = IDENTITY;
  for (const k of [...points].filter((p) => !p.staged).sort((a, b) => a.t - b.t)) {
    if (k.t > t) break;
    const p = Math.min(1, (t - k.t) / Math.max(k.dur, 0.001));
    const e = (EASINGS[k.ease] ?? easeInOutCubic)(p);
    state = { scale: lerp(state.scale, k.to.scale, e), x: lerp(state.x, k.to.x, e), y: lerp(state.y, k.to.y, e) };
  }
  return state;
}
```

- [ ] Commit: `feat(engine): camera transform with sequential folding`.

### Task 1.4: decode — mediabunny Input → frames

**Files:** `packages/engine/src/decode.ts`

(Supersedes Spec.md §A1's raw `VideoDecoder` sketch — mediabunny wraps it.)

```ts
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from "mediabunny";
import type { Project } from "@panoptik/schema";

let input: Input | null = null;
let sink: VideoSampleSink | null = null;
let cached: { sample: VideoSample; t: number } | null = null;

export async function loadClip(file: File): Promise<Project> {
  input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track found in file");
  if (!(await track.canDecode())) throw new Error("This browser cannot decode the video codec");
  sink = new VideoSampleSink(track);
  const duration = await track.computeDuration();
  return {
    id: crypto.randomUUID(),
    clip: { src: URL.createObjectURL(file), duration, width: track.displayWidth, height: track.displayHeight },
    zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [],
    captions: [], stagedCaptions: [],
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [], aspectPreset: "16:9",
  };
}

export async function prepareFrame(t: number): Promise<void> {
  if (!sink || cached?.t === t) return;
  cached?.sample.close();
  const sample = await sink.getSample(Math.max(0, t));
  if (sample) cached = { sample, t };
}

export function currentFrame(): VideoSample | null {
  return cached?.sample ?? null;
}
```

### Task 1.5 (FRONTEND): page shell + drop zone + canvas proof

**Files:** `apps/web/src/app/editor/page.tsx`, `components/Toolbar.tsx`

- [ ] `page.tsx`: dark full-height flex layout; center area = drop zone (`onDrop` → `engineProvider.loadClip(file)` → `setProject`) OR the `<PreviewCanvas />` stub once loaded; `<Timeline />`, `<Inspector />`, `<StagingPanel />`, `<ToolTrace />`, `<ConfirmDialog />`, `<Toolbar />` slots from Day-1 stubs.
- [ ] `lib/engineProvider.ts`: `export const engine = mockEngine` for now (B's mock lands today); flipping to real engine on Day 3 is a one-line change YOU make.
- [ ] Temporary direct draw in the shell: `prepareFrame(currentTime)` → `currentFrame()?.draw(ctx, ...)` to prove pixels without waiting for renderFrame.
- [ ] Generate known-good fixture clip → commit to `/fixtures/demo-clip.mp4` (Risk R1).
- [ ] **Gate: drop file → frame paints in your shell.** Commit: `feat(editor): shell, drop zone, decode proof`.

---

## Day 2 — Fri Aug 28: Render v1 + unified audio (backend) + Toolbar (frontend)

### Task 2.1: layout + renderFrame v1

**Files:** `packages/engine/src/layout.ts`, modify `render.ts`

- [ ] Letterbox math (unit-test it):

```ts
export type Rect = { x: number; y: number; w: number; h: number };
const ASPECT: Record<string, number> = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:3": 4 / 3 };
export function frameRect(canvasW: number, canvasH: number, clipW: number, clipH: number, preset: string): Rect {
  const target = ASPECT[preset] ?? canvasW / canvasH;
  const boxW = Math.min(canvasW, canvasH * target);
  const boxH = boxW / target;
  const s = Math.min(boxW / clipW, boxH / clipH);
  const w = clipW * s, h = clipH * s;
  return { x: (canvasW - w) / 2, y: (canvasH - h) / 2, w, h };
}
```

- [ ] `renderFrame(ctx, project, t)` implementing the 5 composition rules; zoom block:

```ts
const tr = getCameraTransform(project.zoomPoints, t);
const fx = rect.x + tr.x * rect.w;
const fy = rect.y + tr.y * rect.h;
ctx.save();
ctx.translate(fx, fy);
ctx.scale(tr.scale, tr.scale);
ctx.translate(-fx, -fy);
ctx.drawImage(bitmap, rect.x, rect.y, rect.w, rect.h);
ctx.restore();
```

- [ ] Verify against `mockProject()` at t=0/3.2/6.5 (identity → zoomed → out). Commit: `feat(engine): renderFrame composition pipeline`.

### Task 2.2: facecam PiP

- [ ] Private `Map<url, HTMLVideoElement>`; lazy `<video muted playsinline>`; seek `currentTime = t % duration` pre-draw; rounded-corner PiP at `facecam.x/y/size` in screen space (never zoomed).
- [ ] Commit: `feat(engine): facecam picture-in-picture`.

### Task 2.3: unified audio extraction (`getAudioBuffer` — your engine slice)

**Files:** modify `packages/engine/src/decode.ts` (+ re-export from `audio.ts` or keep inline — your file, your call)

Single-pass demuxing: the SAME `Input` opened by `loadClip` also yields the audio track — no duplicate container parsing, no inter-module races.

- [ ] In `loadClip`, after grabbing the video track: `const audioTrack = await input.getPrimaryAudioTrack()`; stash an `AudioSampleSink` if it exists and `canDecode()`.
- [ ] Implement:

```ts
export async function getAudioBuffer(_project: Project): Promise<AudioBuffer | null> {
  if (!audioSink) return null;
  const chunks: AudioBuffer[] = [];
  let total = 0;
  for await (const s of audioSink.samples()) { chunks.push(s.toAudioBuffer()); total += s.numberOfFrames; }
  if (!chunks.length) return null;
  // concat sequentially into ONE mono AudioBuffer at running offsets
}
```

- [ ] Ping DEV B the moment it's green (their Whisper pipeline consumes it Day 3).
- [ ] Commit: `feat(engine): unified full-clip audio extraction`.

### Task 2.4 (FRONTEND): Toolbar

**Files:** `components/Toolbar.tsx`

- [ ] Import button (file input), play/pause + time display + undo/redo buttons wired to `useProjectStore` (consuming B's store is allowed; editing it is not). The Record button slot stays empty until B's `RecordModal` lands Day 3.
- [ ] Verify: import via button works identically to drop zone. Commit: `feat(editor): toolbar wired to store`.

---

## Day 3 — Sat Aug 29: Export backend + ExportModal (frontend) → INTEGRATION 14:00

### Task 3.1: export encoder

**Files:** `packages/engine/src/encode.ts`

Real mediabunny writer API (supersedes Spec.md §A4):

```ts
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat } from "mediabunny";
import { getAudioBuffer } from "./audio"; // YOUR module (Task 2.3)

export async function exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
  const FPS = 30;
  const box = { "720p": [1280, 720], "1080p": [1920, 1080], "4k": [3840, 2160] }[opts.resolution]!;
  const canvas = new OffscreenCanvas(box[0], box[1]);
  const ctx = canvas.getContext("2d")!;
  const output = new Output({
    format: opts.format === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(canvas, { codec: opts.format === "webm" ? "vp9" : "avc", quality: new Quality("high") });
  output.addVideoTrack(video);
  const audioBuf = await getAudioBuffer(project);
  const audio = audioBuf ? new AudioBufferSource({ codec: opts.format === "webm" ? "opus" : "aac", quality: new Quality("high") }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();
  const total = Math.floor(project.clip.duration * FPS);
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await prepareFrame(t);
    renderFrame(ctx, project, t);              // SAME renderer as preview
    await video.add(t, 1 / FPS);
    window.dispatchEvent(new CustomEvent("export-progress", { detail: i / total }));
  }
  if (audio && audioBuf) await audio.add(audioBuf);
  await output.finalize();
  return new Blob([output.target.buffer!], { type: opts.format === "webm" ? "video/webm" : "video/mp4" });
}
```

Note: `OffscreenCanvas.getContext("2d")` works with `CanvasSource`; if typings complain, fall back to a hidden DOM canvas. Commit: `feat(engine): webcodecs export via mediabunny output`.

### Task 3.2 (FRONTEND): ExportModal with progress bar

**Files:** `components/ExportPanel.tsx` (modal variant; the declarative annotation pass happens Day 5)

- [ ] Format/resolution/burn-captions controls → run `engine.exportProject`; listen `"export-progress"` → animated bar; on done trigger download + success state.
- [ ] Verify: export `mockProject` 15s → MP4 plays in VLC/QuickTime with zoom + gradient + text + caption; compare frames vs preview screenshots. Commit: `feat(editor): export modal with progress`.

### Task 3.3 (14:00, JOINT): Integration swap

- [ ] You flip `lib/engineProvider.ts` to `@panoptik/engine`. Together run Spec.md Phase-1 happy path: import → click-zoom → background → text → captions → undo → **manual MP4 export**. Fix contract drift on the spot; changes need both sign-offs.

### Task 3.4 (FRONTEND): Inspector panel

**Files:** `components/Inspector.tsx`

- [ ] Zoom panel (visible when `selectedZoomId` is set — B's store exposes this field + `setSelectedZoom`; consume, don't edit): depth slider 1.2–5.0 step 0.1 via `updateZoomPoint`, duration 0.2–2.0s, easing `<select>` with keys of `EASINGS`, delete button.
- [ ] Background panel: solid swatches + color input; gradient = two color inputs + presets; calls `setBackground` directly (human edits instant-commit by design — agent edits go through staging).
- [ ] Text overlay panel: text input, timestamp defaulting to playhead, position select, list with delete.
- [ ] Acceptance: Spec.md rows "Inspector: change depth/duration/easing → preview updates" + backgrounds render in padding. Commit: `feat(editor): inspector panels`.

### Task 3.5 (FRONTEND, finish Day 4 AM): StagingPanel

**Files:** `components/StagingPanel.tsx`

- [ ] Shows `getStagedDiff()`: counts per kind, `added` list with per-item ✕ (`removeStagedZoom` / `removeStagedTextOverlay` / `clearStagedCaptions`), Commit + Discard buttons disabled when `totalCount === 0`, pending-background badge.
- [ ] Acceptance: stage items via console (`useProjectStore.getState().stageZoomProposals([...])`) → panel lists them → reject one → commit rest → ghosts turn solid on timeline. Commit: `feat(editor): staging diff panel`.

---

## Day 4 — Sun Aug 30: Hardening + DEPLOY

- [ ] Perf: 60fps preview at 1080p (add forward frame cache via `sink.samples(startT, startT + 2)` prefetch if seeks stall); export ≤ 2× realtime 1080p — record the measurement for README.
- [ ] Edge cases: 4K source, 9:16 vertical source, no-audio clip (export still succeeds), seek exactly at duration.
- [ ] Stretch (only if green): `background.kind === "blur"` — blurred upscaled frame under letterbox.
- [ ] **Write `README.md`** (you author the whole file; B supplies the "Testing with an agent" subsection): what it is, quickstart (`pnpm i && pnpm dev`), agent-testing guide, architecture diagram (link Spec.md), license explainer, known limitations.
- [ ] **Deploy:** Vercel project ← GitHub repo, framework "Other" (uses `vercel.json`). Verify HTTPS + editor loads on PROD.
- [ ] Tag `v0.1-phase1`. End of day: Poindeo-class editor, deployed, no WebMCP yet.

---

## Day 5 — Mon Aug 31: WebMCP engine tools + declarative form

### Task 5.1 (by 09:30 — B blocked on this): `lifecycle.ts`

```ts
import "@mcp-b/global"; // fallback; native document.modelContext wins where present

const controllers: AbortController[] = [];

export function registerToolWithLifecycle(cfg: ToolConfig): void {
  const controller = new AbortController();
  controllers.push(controller);
  document.modelContext.registerTool({
    ...cfg,
    signal: controller.signal,
    execute: async (input: any) => {
      const started = performance.now();
      let output: unknown;
      try {
        output = await cfg.execute(input);
        return output;
      } catch (err) {
        output = { error: String(err) };
        throw err;
      } finally {
        window.dispatchEvent(new CustomEvent("webmcp-tool-call", {
          detail: { timestamp: Date.now(), toolName: cfg.name, input, output, durationMs: Math.round(performance.now() - started) },
        }));
      }
    },
  });
}

export function unregisterAllTools(): void {
  controllers.forEach((c) => c.abort());
  controllers.length = 0;
}
```

Verify polyfill side-effects match `@mcp-b/global` docs; adapt + note in README if setup differs. Commit: `feat(webmcp): lifecycle + trace events`.

### Task 5.2: your four tools (`tools-a.ts`) — backend logic

All via `registerToolWithLifecycle`. Full example:

```ts
registerToolWithLifecycle({
  name: "export_clip",
  description: "Exports the current project as a video file, rendered locally via WebCodecs. No upload, no server. Returns a download URL when complete. Ask the user to confirm format and resolution before calling.",
  inputSchema: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["mp4", "webm"], description: "MP4 (H.264) most compatible; WebM (VP9) smaller." },
      resolution: { type: "string", enum: ["720p", "1080p"], description: "1080p standard; 720p faster." },
      burnCaptions: { type: "boolean", description: "true burns captions into the video." },
    },
    required: ["format", "resolution"],
  },
  execute: async ({ format, resolution, burnCaptions }) => {
    const project = useProjectStore.getState().project;
    if (!project) return { error: "No project loaded. Ask the user to import a clip first." };
    const confirmed = await showConfirmDialog({ message: `Export ${format.toUpperCase()} at ${resolution}? Rendering happens locally.` });
    if (!confirmed) return { exported: false, reason: "user_declined" };
    const blob = await engine.exportProject(project, { format, resolution, burnCaptions: !!burnCaptions });
    return { exported: true, downloadUrl: URL.createObjectURL(blob), fileSizeMB: +(blob.size / 1048576).toFixed(1) };
  },
});
```

- [ ] `get_project_state` (`readOnlyHint`): compact JSON — clip meta, committed zooms (t/scale/focal), overlay/caption counts, background, facecam presence, aspect, click log. No blob URLs.
- [ ] `list_scenes` (`readOnlyHint`): `[{ id: "scene-1", in: 0, out: duration }]`.
- [ ] `get_click_log` (`readOnlyHint`): `project.clickLog` + guidance "use these timestamps as zoom candidates."
- [ ] Until B's `showConfirmDialog` lands (09:30), `resolve(window.confirm(msg))` behind `USE_WINDOW_CONFIRM`; flip off same day.
- [ ] Commit: `feat(webmcp): engine read tools + gated export_clip`.

### Task 5.3 (FRONTEND): annotate ExportPanel → declarative form

```tsx
<form tool-name="export_settings"
      tool-description="Export settings form. The agent fills format and resolution. The human clicks the submit button to confirm and download. Does not auto-submit."
      onSubmit={handleSubmit}>
  <select name="format" tool-name="format" tool-description="Output format: mp4 for compatibility, webm for smaller size">
    <option value="mp4">MP4 (H.264)</option>
    <option value="webm">WebM (VP9)</option>
  </select>
  <select name="resolution" tool-name="resolution" tool-description="1080p standard, 720p faster">
    <option value="1080p">1080p</option>
    <option value="720p">720p</option>
  </select>
  <label>
    <input type="checkbox" name="burnCaptions" tool-name="burn_captions" tool-description="Burn captions into the video if checked" />
    Burn captions
  </label>
  <button type="submit">Export &amp; Download</button>
</form>
```

No `action`/`method` (static site); React submit handler; never auto-submit.
Afternoon JOINT agent test (Spec.md Phase-2 checklist) in ChatGPT in-app browser AND Chrome `chrome://flags/#enable-webmcp-testing`: agent discovers 9 tools, calls yours, MP4 downloads. Descriptions are prompt engineering — rewrite any the agent misuses. Commit: `feat(webmcp): declarative export settings form`.

---

## Day 6 — Tue Sep 1: Polish + final deploy

- [ ] Every tool returns `{ error }` objects with actionable messages; never throws past the trace wrapper.
- [ ] `readOnlyHint` on exactly the 3 reads; absent on staging/write tools (verify via `document.modelContext.getTools()` in console).
- [ ] Empty-project behavior graceful on all 5 of your surfaces.
- [ ] Re-deploy; test tools on PROD URL from a fresh ChatGPT session.
- [ ] On standby 15:00–17:00 during B's demo recording: if live export misbehaves, hand over a pre-rendered fallback MP4.
- [ ] **Devpost technical sections**: "Why WebMCP is the right tool" + "WebMCP implementation notes" (9 tools + declarative form, readOnlyHints, in-execute confirmation, AbortController lifecycle, ~89% token math) + architecture diagram + your measured export benchmark numbers. B handles story/UX copy and final assembly.
- [ ] Freeze: `git tag v0.9-submission`.

## Day 7 — Wed Sep 2: Dress rehearsal (JOINT)

- [ ] Full demo script in fresh browsers against PROD (one calls agent prompts, one drives editor).
- [ ] Re-run Spec.md Phase-1 + Phase-2 checklists on the deployed URL.
- [ ] Judges' grep check: `grep -rn "document.modelContext.registerTool" apps/` shows definitions.
- [ ] Fill submission form draft together (B owns final copy).

## Ship day — Thu Sep 3 (before 4:00 PM EDT / 1:30 AM IST)

Your slice: licenses present · `registerTool` greppable · prod deploy green · HTTPS verified · README engine/codec sections accurate · clean-clone smoke test (`rm -rf node_modules && pnpm i && pnpm dev`).

---

## Your testing checklist (Spec.md rows mapped to you)

- [ ] Drop video → renders *(A)*
- [ ] Focal dot drag renders live *(A draws / B wires)*
- [ ] Inspector: depth/duration/easing updates preview *(A)*
- [ ] StagingPanel: reject individual ghost, commit rest *(A)*
- [ ] Background solid/gradient in padding *(A)*
- [ ] Save/reload/load roundtrip *(B implements, both verify)*
- [ ] Export MP4 plays with zooms+captions+text+background *(A)*
- [ ] Agent discovers 9 tools *(A+B)*
- [ ] `get_project_state` / `list_scenes` / `get_click_log` correct JSON *(A)*
- [ ] `export_clip` → confirmation → MP4 downloads *(A)*
- [ ] Declarative form: agent fills, only human submits *(A)*
- [ ] Unmount → tools unregistered *(A)*

## Risks & fallbacks (yours)

| #   | Risk                                        | Trigger    | Fallback                                                                                               |
| -----| ---------------------------------------------| ------------| --------------------------------------------------------------------------------------------------------|
| R1  | Codec won't decode a clip                   | Day 1 PM   | Known-good fixture: `ffmpeg -i in.mp4 -c:v libx264 -profile:v baseline -pix_fmt yuv420p demo-clip.mp4` |
| R2  | mediabunny API drift vs doc                 | any        | Read `node_modules/mediabunny/dist/*.d.ts` — typings authoritative; adjust call sites only             |
| R3  | Export slow                                 | Day 4      | Demo with 15s clip; pre-render once, keep MP4 ready                                                    |
| R4  | Polyfill/native mismatch on ChatGPT browser | Day 5 AM   | Feature-detect `"modelContext" in document`; skip polyfill import when native                          |
| R5  | Facecam seek-per-frame janky in export      | Day 6 noon | Cut facecam from EXPORT only; disclose honestly on Devpost                                             |

## Submission duties (split with DEV B)

Yours: licenses · greppable `registerTool` · final prod deploy · HTTPS verification · **full README** · **Devpost technical sections** (fit-rationale + implementation explanation) with architecture diagram and benchmarks.
