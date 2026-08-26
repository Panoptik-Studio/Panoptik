# Panoptik — Execution Roadmap: DEV B (Editing Intelligence + Editor UI)

> **How to use this doc:** Work top-to-bottom, tick checkboxes (`- [ ]`) as you go. Every task lists exact files, verification commands, and a commit step. Your counterpart works from `ROADMAP-A.md`. File ownership is strict (matrix below) — you NEVER edit A-owned files, A never edits yours. If you want an agent to execute a task, hand it the task block verbatim (REQUIRED SUB-SKILL for agents: superpowers:subagent-driven-development or superpowers:executing-plans).

**Goal:** Own the ingestion-to-intelligence pipeline — dual-stream screen/webcam capture, Zustand staged-diff store, OPFS persistence, Whisper transcription — AND the editor surfaces (canvas interaction, timeline, recording UI, captions, dialogs, trace), plus the 5 editing WebMCP tools, demo video production, and the Devpost product narrative.

**Architecture:** All edits flow through one Zustand store. Agent proposals land in `staged*` arrays (ghost items) — never committed state. The only write path is `commitAll()`, gated by a human-confirmation dialog surfaced inside a WebMCP tool's `execute()`. Your engine slices are `record.ts` (capture → blobs) and `opfs.ts` (persistence); audio demux is A's unified pipeline and reaches you as a ready `AudioBuffer` via `getAudioBuffer` — you only resample to 16kHz mono for Whisper.

**Tech Stack:** Next.js 15 static export, TypeScript, Zustand 5, Tailwind 4, `getDisplayMedia`/`getUserMedia`/`MediaRecorder`, `@xenova/transformers` (Whisper in a Web Worker), Web Workers, OPFS, Vitest.

---

## Global constraints (apply to every task)

- **Deadline:** Thu Sep 3, 2026, 4:00 PM EDT (= 1:30 AM GMT+5:30 Fri Sep 4). Plan to submit Wed Sep 3 by noon EDT.
- **No server. No uploads. No API keys.** Captions transcribe locally. Audio never leaves the device.
- Always register tools through A's `registerToolWithLifecycle` — never raw `document.modelContext.registerTool` (you'd lose AbortController cleanup + trace events).
- Do NOT use `requestUserInteraction()` (doesn't exist). Human confirmation = your `showConfirmDialog()` custom-event + portal pattern.
- Package scope: `@panoptik/*`.
- Conventional commits, branch per task, PR to `main`, A reviews same day.
- UI components: LLM-generated styling + YOUR logic. "Build" = feed acceptance criteria + store API to an LLM, then wire the logic yourself.

---

## File ownership matrix (LOCKED — the anti-conflict guarantee)

| DEV A owns (never touch) | YOU own (edit only you) |
|---|---|
| `packages/engine/src/{decode,render,encode,audio,layout,test-fixtures}.ts`; `index.ts` except B-region | `packages/engine/src/record.ts` + its re-export line inside the marked `// #region B-modules` block of `index.ts` |
| `app/editor/page.tsx`; `components/{Toolbar,ExportPanel,Inspector,StagingPanel}.tsx`; `lib/engineProvider.ts` | `stores/**`; `lib/{mockEngine,zoomGeometry,audio16k}.ts`; `workers/**` |
| `webmcp/{lifecycle,tools-a,index}.ts`; `README.md`; Devpost technical sections | `webmcp/{confirm,tools-b}.ts` |
| Vercel config, deploy | `components/{PreviewCanvas,Timeline,RecordModal,CaptionsPanel,ConfirmDialog,ToolTrace}.tsx` |

Capture/ingest boundary (why this is conflict-free): your `record.ts` only CAPTURES (`getDisplayMedia`/`getUserMedia`/`MediaRecorder` → blobs). Blobs become a project via `engine.loadRecording(...)` whose DEMUX half lives in A's `decode.ts` — you never touch raw container parsing, they never touch your streams.

Shared conventions:
- **Stub-first:** Day 1 EOD you create every component above as `export function X() { return null; }` so A's page compiles; you fill them Days 2–5 without touching the page.
- You MAY *consume* A's modules (`engineProvider`, `frameRect` from `@panoptik/engine`) — never edit them.

---

## Calendar

| Day | Date | You: backend / logic | You: frontend / product |
|---|---|---|---|
| Day 1 | Thu Aug 27 | Scaffold + contract + store TDD + mockEngine | Component stubs for A's shell |
| Day 2 | Fri Aug 28 | Zoom geometry helpers + OPFS module + dual-stream capture | PreviewCanvas, Timeline |
| Day 3 | Sat Aug 29 | Whisper worker (consumes A's `getAudioBuffer`) + moment marks | CaptionsPanel + RecordModal UI + OPFS browser; **14:00 integration** |
| Day 4 | Sun Aug 30 | Undo/redo stress + caption timing fixes | Empty states + polish; agent-guide subsection for README; deployed-URL QA |
| Day 5 | Mon Aug 31 | confirm system + 5 WebMCP tools | ConfirmDialog + ToolTrace panel |
| Day 6 | Tue Sep 1 | Tool-description tuning after agent test | **Demo video + voiceover**; Whisper pre-warm; Devpost product narrative |
| Day 7 | Wed Sep 2 | Buffer + dress rehearsal (joint) | |
| SHIP | Thu Sep 3 | Submit before 4:00 PM EDT | |

**Fixed checkpoints you are accountable for:**

| When | You deliver |
|---|---|
| Day 1 EOD | Store tests green; all component stubs exist (A's page compiles) |
| Day 2 EOD | Full editing loop vs mockEngine; OPFS roundtrip green; capture start/stop produces blobs |
| Day 3 EOD | Captions staged end-to-end (A's audio path or your fallback shim); RecordModal loads a real recording |
| Day 4, 17:00 | README draft up; PROD URL smoke-tested |
| Day 5, 09:30 | `confirm.ts` + ConfirmDialog pushed — A depends on it |
| Day 6, 12:00 | Feature freeze; demo recording starts |
| Day 6 EOD | Video public + voiceover done; Devpost product narrative drafted; model pre-warmed |

---

## The locked contract (agreed jointly Day 1 — never change without both devs present)

Full type block lives in `ROADMAP-A.md` §"The locked contract" → lands in `packages/project-schema/src/index.ts`. What matters most to you:

- `staged*` arrays are FIRST-CLASS in `Project` — ghosts are data, not UI state.
- Engine surface you consume: `prepareFrame(t)`, `renderFrame(ctx, project, t)` (sync), `loadClip(file)`; camera uses ONLY committed `zoomPoints`; staged text/captions render amber (#f59e0b).
- Your engine modules: `record.ts` (capture → blobs) and `opfs.ts` (`saveProject/loadProject/listProjects`) — re-exported through the engine's B-region.
- Audio: A delivers `getAudioBuffer(project)` (unified with their demux — no duplicate parsing) targeting Day 2 EOD. Your `lib/audio16k.ts` does the 16kHz mono resample for Whisper. Fallback until it's green: `fetch(project.clip.src)` → `arrayBuffer()` → `new AudioContext().decodeAudioData(...)` (works webm/opus + mp4/aac in Chrome).

**What you produce that A consumes (read-only):**

```ts
useProjectStore.getState().project   // Project | null
```

**Shared WebMCP modules (exact signatures both sides rely on):**

```ts
// webmcp/lifecycle.ts — A OWNS (lands Day 5 09:30); you consume:
registerToolWithLifecycle({ name, description, inputSchema, annotations?, execute });
// auto-dispatches window CustomEvent "webmcp-tool-call"
// detail: { timestamp, toolName, input, output, durationMs } after every execute

// webmcp/confirm.ts — YOU OWN (deliver Day 5 by 09:30)
export function showConfirmDialog(opts: {
  message: string;
  diff?: { added: string[]; removed: string[]; totalCount: number };
}): Promise<boolean>;   // true/false on human click; false on backdrop/Escape
```

**Store deltas beyond Spec.md §B1 (your internal design):**
- `removeStagedZoom(id)`, `removeStagedTextOverlay(id)`, `clearStagedCaptions()` — per-item rejection in the StagingPanel (A's file; consumes your actions).
- `selectedZoomId: string | null` + `setSelectedZoom(id | null)` — Timeline sets it, DEV A's Inspector consumes it.
- `markMoment(t)` — appends `{ t, x: 0.5, y: 0.5, type: "manual" }` to `project.clickLog` (<kbd>M</kbd> during playback; feeds A's `get_click_log` tool).
- Staged background applies immediately to `project.background` + sets UI-only `pendingBackgroundBadge: true`. `commitAll()` clears badge + pushes history; `clearStaged()` reverts background to `history[historyIndex].background`.

---

## Your test fixture: mockEngine

You develop against this until integration (Day 3 14:00) — A's real pipeline is invisible until then.

```ts
// apps/web/src/lib/mockEngine.ts
import type { Project } from "@panoptik/schema";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";

export const mockEngine = {
  loadClip: async (file: File): Promise<Project> => ({
    ...mockProject(),
    clip: { src: URL.createObjectURL(file), duration: 15, width: 1920, height: 1080 },
  }),
  prepareFrame: async () => {},
  renderFrame: (ctx: CanvasRenderingContext2D, project: Project, t: number) => {
    // base + background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (project.background.kind === "gradient") {
      const g = ctx.createLinearGradient(0, 0, ctx.canvas.width, ctx.canvas.height);
      g.addColorStop(0, project.background.stops[0]);
      g.addColorStop(1, project.background.stops[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else if (project.background.kind === "solid") {
      ctx.fillStyle = project.background.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    // focal markers: green committed, amber ghost
    [...project.zoomPoints, ...project.stagedZoomPoints].forEach((zp) => {
      if (t >= zp.t && t <= zp.t + zp.dur) {
        ctx.strokeStyle = zp.staged ? "#f59e0b" : "#10b981";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(zp.to.x * ctx.canvas.width, zp.to.y * ctx.canvas.height, 24 * zp.to.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // text overlays + captions
    [...project.textOverlays, ...project.stagedTextOverlays].forEach((to) => {
      if (t >= to.timestamp && t <= to.timestamp + 3) {
        ctx.fillStyle = to.staged ? "#f59e0b" : "#ffffff";
        ctx.font = "32px sans-serif";
        ctx.textAlign = "center";
        const y = to.position === "top" ? 60 : to.position === "bottom" ? ctx.canvas.height - 60 : ctx.canvas.height / 2;
        ctx.fillText(to.text, ctx.canvas.width / 2, y);
      }
    });
    [...project.captions, ...project.stagedCaptions].forEach((c) => {
      if (t >= c.start && t <= c.end) {
        ctx.fillStyle = "#ffffff"; ctx.font = "28px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(c.text, ctx.canvas.width / 2, ctx.canvas.height - 40);
      }
    });
    ctx.fillStyle = "#e5e7eb"; ctx.font = "20px monospace";
    ctx.fillText(`t=${t.toFixed(1)}s`, 20, 30);
  },
  getAudioBuffer: async () => null,
  exportProject: async () => new Blob(["mock"], { type: "video/mp4" }),
};
```

---

## Day 1 — Thu Aug 27: Scaffold (joint) + store TDD + stubs

### Task 0.1 (JOINT): Monorepo scaffold + contract lock

Same session as DEV A — commands in `ROADMAP-A.md` Task 0.1. Your job: review contract types line-by-line; voice objections NOW; merge together.

### Task 1.2: Zustand store with staging + history (TDD)

**Files:** `stores/projectStore.ts`, `stores/projectStore.test.ts`

Base implementation = Spec.md §B1 (~lines 497–787) verbatim + your store deltas (per-item staged removals, `markMoment`, background badge). Test-first:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "./projectStore";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";

const fresh = () => useProjectStore.getState().setProject(structuredClone(mockProject()));
const zp = (id: string, t: number) =>
  ({ id, t, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.5, ease: "linear", staged: true });

describe("projectStore", () => {
  beforeEach(fresh);

  it("addZoomPoint commits immediately and pushes history", () => {
    const before = useProjectStore.getState().historyIndex;
    useProjectStore.getState().addZoomPoint({ t: 9, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic" });
    const s = useProjectStore.getState();
    expect(s.project!.zoomPoints.some((z) => z.t === 9)).toBe(true);
    expect(s.historyIndex).toBe(before + 1);
  });

  it("staging adds ghosts without touching committed state or history", () => {
    const before = useProjectStore.getState().project!.zoomPoints.length;
    useProjectStore.getState().stageZoomProposals([zp("ghost-1", 12)]);
    const s = useProjectStore.getState();
    expect(s.project!.stagedZoomPoints).toHaveLength(1);
    expect(s.project!.zoomPoints).toHaveLength(before);
    expect(s.historyIndex).toBe(0);
  });

  it("getStagedDiff counts across kinds", () => {
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 1)]);
    s0.stageCaptions([{ text: "hi", start: 0, end: 1 }]);
    expect(s0.getStagedDiff().totalCount).toBe(2);
  });

  it("commitAll merges staged into committed and clears staged", () => {
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 2)]);
    s0.commitAll();
    const s1 = useProjectStore.getState();
    expect(s1.project!.stagedZoomPoints).toHaveLength(0);
    expect(s1.project!.zoomPoints.find((z) => z.id === "g")?.staged).toBe(false);
  });

  it("undo reverts a commit, redo reapplies; boundaries never throw", () => {
    const countBefore = useProjectStore.getState().project!.zoomPoints.length;
    const s0 = useProjectStore.getState();
    s0.stageZoomProposals([zp("g", 4)]);
    s0.commitAll();
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project!.zoomPoints).toHaveLength(countBefore);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().project!.zoomPoints).toHaveLength(countBefore + 1);
    const s = useProjectStore.getState();
    s.undo(); s.undo(); s.redo(); s.redo();
    expect(s.historyIndex).toBeLessThanOrEqual(s.history.length - 1);
  });

  it("clearStaged discards ghosts and reverts pending background", () => {
    const origBg = structuredClone(useProjectStore.getState().project!.background);
    const s = useProjectStore.getState();
    s.stageBackground({ kind: "solid", color: "#ff0000" });
    s.clearStaged();
    expect(useProjectStore.getState().project!.background).toEqual(origBg);
  });

  it("removeStagedZoom drops one ghost only", () => {
    const s = useProjectStore.getState();
    s.stageZoomProposals([zp("a", 1), zp("b", 2)]);
    s.removeStagedZoom("a");
    expect(useProjectStore.getState().project!.stagedZoomPoints.map((z) => z.id)).toEqual(["b"]);
  });
});
```

- [ ] `pnpm vitest run apps/web` → FAIL → implement per Spec.md B1 + deltas → PASS.
- [ ] Commit: `feat(store): staged-diff state model + undo/redo`.

### Task 1.3: mockEngine + component stubs

**Files:** `lib/mockEngine.ts` (code above); stubs for every component in your ownership column (`export function X() { return null; }`).

- [ ] A's page compiles against your stubs — confirm together at EOD.
- [ ] Commit: `feat(editor): mock engine + component stubs`.

---

## Day 2 — Fri Aug 28: Editing loop UI + OPFS backend

### Task 2.1: zoom geometry helpers (TDD, pure logic)

**Files:** `lib/zoomGeometry.ts`, `lib/zoomGeometry.test.ts`

```ts
export function hitTestFocal(px: number, py: number, zp: { to: { x: number; y: number } }, frameW: number): boolean {
  return Math.hypot(px - zp.to.x, py - zp.to.y) * frameW < 24; // 24px grab radius
}
export function normalizeClick(clientX: number, clientY: number, rect: DOMRect, frame: { x: number; y: number; w: number; h: number }) {
  const x = (clientX - rect.left - frame.x) / frame.w;
  const y = (clientY - rect.top - frame.y) / frame.h;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}
```

Tests: clamps outside 0–1; hit-radius boundary; coords relative to letterboxed FRAME not canvas. Commit: `feat(editor): zoom geometry helpers`.

### Task 2.2: PreviewCanvas interaction

**Files:** `components/PreviewCanvas.tsx`

Logic = Spec.md §B3 verbatim (click-to-zoom-in at paused playhead targeting clicked pixel; second click near existing focal → zoom-out keyframe to identity `{scale:1,x:0.5,y:0.5}`; ignore clicks while playing), plus:

- [ ] Map click coords through A's `frameRect` (import from `@panoptik/engine`) — normalized coords are relative to the FRAME.
- [ ] Draggable focal dots: pointerdown near focal → drag → live `updateZoomPoint(id, { to })`; pointerup pushes ONE history entry.
- [ ] Acceptance: paused click adds diamond; drag moves smoothly; zoom-out restores 1×. Commit: `feat(editor): zoom interaction + focal dragging`.

### Task 2.3: Timeline

**Files:** `components/Timeline.tsx`

Timeline: width ∝ duration; adaptive ruler (1s ticks ≤30s else 5s); playhead follows `currentTime` + click-to-seek anywhere; diamonds solid emerald (committed) vs dashed amber (ghosts); horizontal drag updates `t`; click selects → sets store's `selectedZoomId` (Inspector panel is DEV A's — it consumes this field); hover ✕ deletes; caption strip bars start→end.

Acceptance: Spec.md row "Timeline: drag diamond → moves timestamp". Commit: `feat(editor): timeline`.

### Task 2.4: keyboard undo/redo

- [ ] Global keydown: Cmd/Ctrl+Z → `undo`; Cmd/Ctrl+Shift+Z → `redo`; Toolbar buttons (A's file) reflect boundary-disabled state — coordinate via the store's `historyIndex`/`history.length`, no cross-editing.
- [ ] Acceptance: add-zoom→set-bg→add-text→3×undo→pristine→3×redo→restored, across all feature kinds. Commit: `feat(editor): keyboard undo`.

### Task 2.5: dual-stream capture backend (`record.ts` — your engine-package slice)

**Files:** `packages/engine/src/record.ts` (+ re-export line in index.ts B-region)

CAPTURE ONLY — you produce blobs, A's `loadRecording` does the demux (that's their side of the interface).

- [ ] `startRecording()`: `getDisplayMedia({ video: { frameRate: { ideal: 60 }, cursor: "always" }, audio: false })` + `getUserMedia({ video: { width: 640, height: 360 }, audio: true })` (mic rides the facecam stream — single audio source, no mixing). Two `MediaRecorder`s (`video/webm;codecs=opus` screen @128kbps audio n/a; `video/webm` facecam).
- [ ] `stop()` → `{ screenBlob, facecamBlob }`; stops all tracks.
- [ ] Permission-denied / no-webcam → screen-only graceful path.
- [ ] Verify: record 10s → stop → hand blobs to `engine.loadRecording(screenBlob, facecamBlob, null)` in console → project loads with PiP (A's half). If A's demux lags, verify blob durations via `mediaRecorder.onstop` + `URL.createObjectURL` playback.
- [ ] Commit: `feat(engine): dual-stream capture`.

### Task 2.6: OPFS module in the engine package (TDD — your backend slice)

**Files:** `packages/engine/src/opfs.ts` (+ serialize-helper tests), re-export line inside `index.ts` B-region.

Implement `saveProject(project)` / `loadProject(id): Promise<Project | null>` / `listProjects()` per Spec.md §A5: `<id>/project.json` + `clip.webm` + optional `facecam.webm` under OPFS root. Guard non-secure contexts (return null / hide UI). Unit-test the JSON serialize/deserialize helpers; verify roundtrip manually in browser (save → reload → load → identical state).
Commit: `feat(engine): opfs project persistence`.

---

## Day 3 — Sat Aug 29: Whisper + capture UI + captions → INTEGRATION 14:00

### Task 3.1: audio input wiring (consume A's `getAudioBuffer`, fallback shim ready)

A's unified `getAudioBuffer` lands Day 2 EOD. Flow: `engine.getAudioBuffer(project)` → your `extractMono16k` (below) → worker. Until green, use the shim: `fetch(project.clip.src)` → `arrayBuffer()` → `new AudioContext().decodeAudioData(...)`. Verify against a clip with known speech; `null` for silent clips must not hang the UI.

Commit: `feat(captions): audio input path + fallback`.

### Task 3.2: Whisper worker (correct wiring — Spec.md §B2 passes a blob URL, which does NOT work; Whisper needs Float32 PCM @16kHz)

**Files:** `workers/whisperWorker.ts`, `lib/audio16k.ts`

```ts
// lib/audio16k.ts — main thread
export async function extractMono16k(buffer: AudioBuffer): Promise<Float32Array> {
  const offline = new OfflineAudioContext(1, Math.ceil(buffer.duration * 16000), 16000);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start();
  return (await offline.startRendering()).getChannelData(0).slice();
}

// workers/whisperWorker.ts
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@xenova/transformers";
env.allowLocalModels = false;
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;

self.onmessage = async (e: MessageEvent<{ type: string; audio?: Float32Array }>) => {
  if (e.data.type !== "transcribe" || !e.data.audio) return;
  try {
    transcriber ??= await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
      progress_callback: (p: any) => p.status === "progress" && postMessage({ type: "progress", progress: p.progress }),
    });
    postMessage({ type: "progress", progress: -1 }); // model loaded → transcribing
    const out = await transcriber(e.data.audio, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5 });
    postMessage({
      type: "result",
      captions: out.chunks.map((c: any) => ({
        text: String(c.text).trim(),
        start: c.timestamp[0],
        end: c.timestamp[1] ?? c.timestamp[0] + 0.5,
      })),
    });
  } catch (err) {
    postMessage({ type: "error", error: String(err) });
  }
};
```

Flow: `engine.getAudioBuffer(project)` → `extractMono16k` → worker (module type) → progress events → `stageCaptions(result)` → terminate. First run downloads ~40MB model — pre-warm BEFORE recording the demo (Day 6). Commit: `feat(captions): local whisper transcription worker`.

### Task 3.3: CaptionsPanel + RecordModal UI + moment marks + OPFS browser

**Files:** `components/CaptionsPanel.tsx`, `components/RecordModal.tsx`

- [ ] CaptionsPanel: Generate button → progress bar (model download % then spinner) → staged captions listed; store field carries worker progress so AGENT-triggered runs show status here too.
- [ ] RecordModal (frontend half of your capture slice): source-picker explainer, webcam preview tile, Start/Stop wired to YOUR `record.ts`; on stop → `engine.loadRecording(screenBlob, facecamBlob, null)` → `setProject`. Toolbar's Record button opens this modal — A owns that file, so expose a tiny window event (`window.dispatchEvent(new CustomEvent("open-record-modal"))`) your modal listens for; no cross-file edits.
- [ ] <kbd>M</kbd> during playback → `markMoment(currentTime)` + tiny toast (populates `clickLog` for A's `get_click_log` tool; disclose honestly on Devpost: "manual moment marks; automatic capture is a post-hackathon extension").
- [ ] OPFS project browser drawer: Save / Load buttons + list dropdown wired to YOUR `opfs.ts`.
- [ ] Commit: `feat(editor): captions panel, recording ui, moment marks, project browser`.

### Task 3.4 (14:00, JOINT): Integration swap

A flips `lib/engineProvider.ts` to the real engine. Together run Spec.md Phase-1 happy path: import → click-zoom → background → text → captions (your audio path!) → undo → manual MP4 export. Fix contract drift on the spot; changes need both sign-offs.

---

## Day 4 — Sun Aug 30: Hardening + docs + deploy QA

- [ ] Undo/redo across ALL feature kinds incl. caption commits; 20-op stress test with interleaved undos/redos.
- [ ] Caption timing sanity: no negative durations; merge overlapping words into ≤42-char display chunks if needed.
- [ ] Empty states: no project (panels inert + helpful hint), zero captions, zero zooms, nothing staged.
- [ ] Test A's Vercel deploy: import, edit, export on the PROD URL; file issues as tasks — don't fix A's code yourself.
- [ ] Supply A with the **"Testing with an agent" subsection** for their README (ChatGPT in-app browser steps + Chrome `chrome://flags/#enable-webmcp-testing` steps) — A authors the file, you own this section's content.
- [ ] Commit: `docs: readme with agent testing guide`.

---

## Day 5 — Mon Aug 31: WebMCP editing tools

### Task 5.1 (by 09:30 — A blocked on this): confirm system

**Files:** `webmcp/confirm.ts`, `components/ConfirmDialog.tsx`

Implement exactly the shared signature (top of this doc). Base dialog on Spec.md §"Confirmation dialog component" with upgrades: Escape and backdrop click resolve `false`; focus trapped; also used by plain UI buttons (single source of truth for dangerous-action UX).

Mechanism: `showConfirmDialog` dispatches `window` CustomEvent `"webmcp-confirm"` with `{ message, diff, resolve }`; mounted-once `<ConfirmDialog />` listens and renders via portal. Ping A the moment it's pushed. Commit: `feat(webmcp): confirmation dialog + helper`.

### Task 5.2: your five tools (`tools-b.ts`) — backend logic

All via A's `registerToolWithLifecycle`. Full example:

```ts
import { nanoid } from "nanoid";

registerToolWithLifecycle({
  name: "propose_zoom_points",
  description: "Proposes zoom-in keyframes at specific timestamps. Watch the preview to identify moments of interest: UI clicks, text reveals, scene changes, important visuals. Use get_click_log for candidate timestamps. Proposals appear as ghost diamonds on the timeline for the human to review — they are NOT applied until commit_staged_changes.",
  inputSchema: {
    type: "object",
    properties: {
      timestamps: { type: "array", items: { type: "number" }, description: "Timestamps in seconds to place zoom-ins." },
      scale: { type: "number", minimum: 1.2, maximum: 5, description: "Zoom depth. Default 2.2." },
    },
    required: ["timestamps"],
  },
  execute: async ({ timestamps, scale }) => {
    const store = useProjectStore.getState();
    if (!store.project) return { error: "No project loaded. Ask the user to import a clip first." };
    const clamped = timestamps.filter((t: number) => t >= 0 && t <= store.project!.clip.duration);
    const proposals = clamped.map((t: number) => ({
      id: nanoid(), t,
      to: { scale: scale ?? 2.2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: true,
    }));
    store.stageZoomProposals(proposals);
    return {
      stagedCount: proposals.length,
      outOfRangeSkipped: timestamps.length - clamped.length,
      message: `${proposals.length} zoom proposal(s) staged as ghosts. The human reviews them on the timeline; apply with commit_staged_changes.`,
    };
  },
});
```

Register the remaining four per Spec.md §Phase 2 (`add_text_overlay`, `set_background`, `generate_captions`, `commit_staged_changes`). Non-negotiables:

- Every staging tool's return message ends with guidance toward `commit_staged_changes`.
- `commit_staged_changes`: nothing staged → `{ committed: false, reason: "nothing_staged" }`; else `showConfirmDialog({ message, diff })` → decline returns `{ reason: "user_declined" }` → approve runs `commitAll()` + reports `itemsCommitted`.
- `generate_captions` forwards worker progress to a store field so your CaptionsPanel shows live status even when triggered by the agent.

Afternoon JOINT agent test (Spec.md Phase-2 checklist) in ChatGPT in-app browser AND Chrome flag build: propose → stage → human adjusts one depth → commit via dialog → export. Descriptions ARE prompts — rewrite any the agent misuses. Commit: `feat(webmcp): editing + staging + commit tools`.

### Task 5.3 (FRONTEND): ToolTrace panel

**Files:** `components/ToolTrace.tsx`

Base: Spec.md §"Tool-trace panel". It just listens for `"webmcp-tool-call"` CustomEvents that A's lifecycle wrapper already emits — no hooking needed. Keep last 10 entries, newest first; show `toolName`, duration, truncated pretty JSON of `output`; empty state explains how to connect an agent. Judge-facing gold — make it beautiful. Commit: `feat(webmcp): agent tool trace panel`.

---

## Day 6 — Tue Sep 1: Demo video + Devpost copy

### Task 6.1: record the demo (freeze at noon; pre-warm Whisper; rehearse twice)

Script (from description.md — follow timings):

| Time | Content |
|---|---|
| 0:00–0:15 | Problem: manually placing every zoom/caption; most ship raw recordings |
| 0:15–0:30 | Import screen recording; renders on canvas |
| 0:30–1:00 | ChatGPT in-app browser: "watch this and propose zoom points at interesting moments" → `get_click_log` → `propose_zoom_points` → ghost diamonds appear |
| 1:00–1:20 | "Add captions and a gradient background" → `generate_captions` (local Whisper) + `set_background` stage |
| 1:20–1:50 | Human drags one zoom depth; `commit_staged_changes` → diff dialog → Confirm → ghosts go solid |
| 1:50–2:15 | "Export 1080p MP4" → `export_clip` → dialog → local render → downloads |
| 2:15–2:35 | Side-by-side raw vs polished |
| 2:35–2:50 | ToolTrace: "~6 tool calls, ~3KB tokens vs ~200KB screenshots + DOM scraping" |
| 2:50–3:00 | Tagline: agent sees your canvas, calls structured tools, you stay in control |

- [ ] Record 1080p (OBS or OS recorder) with ChatGPT app visible; clear audio; upload PUBLIC YouTube < 3 min.
- [ ] Fallbacks ready: pre-generated captions cached in OPFS, pre-exported MP4 from A, second take of the agent segment.

### Task 6.2: Devpost product narrative (A writes technical sections; you own these)

Your sections: ② how it improves UX (before/after table) ③ what people+agents do that was previously impossible. Also: demo-day logistics — Whisper model pre-warm, fallback caption cache, second take of the agent segment. A owns sections ① fit-rationale and ④ implementation explanation plus benchmarks. You do FINAL assembly of `description.md`, fill live/demo URLs, add credentials note ("none — no auth"), and hand the whole thing to A for technical fact-check before submit.

## Day 7 — Wed Sep 2: Dress rehearsal (JOINT) + buffer

- [ ] Fresh browser, fresh ChatGPT session against PROD URL: full script, timed.
- [ ] Re-run Spec.md Phase-1 + Phase-2 checklists; fix or cut.
- [ ] Draft submission form end-to-end (you drive); repo visibility public double-checked.

## Ship day — Thu Sep 3 (before 4:00 PM EDT / 1:30 AM IST)

Your slice: YouTube public < 3 min · Devpost 4 sections complete · README verified on clean clone · live URL re-tested · SUBMIT ≥ 3h before deadline.

---

## Your testing checklist (Spec.md rows mapped to you)

- [ ] Click preview (paused) → zoom-in keyframe; second click near → zoom-out *(B)*
- [ ] Timeline drag diamond → timestamp moves *(B)*
- [ ] Recording: screen+facecam+mic → stop → loads as project; PiP renders *(B capture / A demux)*
- [ ] Text overlay appears at timestamp *(A draws / B wires)*
- [ ] Captions: Generate → Whisper → staged; timing accurate *(B)*
- [ ] Undo/redo single + cross-feature *(B)*
- [ ] Ghost diamonds visually distinct from committed *(B)*
- [ ] Save/reload/load roundtrip *(B)*
- [ ] `propose_zoom_points` → ghosts; `add_text_overlay` / `set_background` / `generate_captions` stage *(B)*
- [ ] `commit_staged_changes` → dialog → Yes commits / No declines *(B)*
- [ ] ToolTrace logs every call with outputs *(B)*

## Risks & fallbacks (yours)

| # | Risk | Trigger | Fallback |
|---|---|---|---|
| R1 | Whisper slow/large download | Day 6 AM | Pre-warm + cache; switch to `Xenova/whisper-tiny.en`; worst case pre-generated captions returned instantly by `generate_captions` (disclose on Devpost) |
| R2 | Agent ignores staging, spams commit | Day 5 PM | Strengthen descriptions ("staged only; the human must approve"); ToolTrace makes behavior visible |
| R3 | Integration breaks Day 3 | Day 3 PM | Keep `engineProvider` toggle; ship Phase-2 against mockEngine; integrate Day 4 morning |
| R4 | ChatGPT browser can't reach localhost | Day 5 | Use the Vercel prod/preview URL for all agent testing (HTTPS required anyway) |
| R5 | Demo video overruns 3 min | Day 6 | Cut side-by-side segment first, tool-trace second |
| R6 | A's `getAudioBuffer` slips past Day 3 noon | Day 3 AM | Ship the decodeAudioData fallback shim (already coded in Task 3.1); swap later |

## Submission duties (split with DEV A)

Yours: public <3min YouTube demo + voiceover · Devpost **product narrative** sections (UX improvement + what people/agents do together) + final assembly of `description.md` · deployed-URL QA · submission form filled early · Whisper pre-warm. (A owns README and technical sections.)



