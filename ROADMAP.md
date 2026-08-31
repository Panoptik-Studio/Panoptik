## Two-Phase Plan: Poindeo Competitor (Days 1–4) → WebMCP Layer (Days 5–7)

### Slice definition

|                              | **Person A — Media Pipeline**                                                                                                               | **Person B — Editor + State**                                                                                      |
| ------------------------------| ---------------------------------------------------------------------------------------------------------------------------------------------| --------------------------------------------------------------------------------------------------------------------|
| **Backend (engine)**         | Import, recording, camera transform, render, export, facecam                                                                                | Project state model, zoom interaction, backgrounds, captions, text overlays, undo/redo, OPFS persistence           |
| **Frontend (LLM-generated)** | File-drop, record button, preview canvas, facecam PiP, export button                                                                        | Timeline diamonds, inspector, background picker, text editor, caption editor, undo/redo buttons, staging panel     |
| **Mock to develop against**  | Hardcoded `mockProject` with all fields populated (zoom points, text, captions, background, facecam) — tests renderer/exporter in isolation | `mockEngine` with stubbed `renderFrame` / `exportProject` / `loadClip` — tests all editing UI + state in isolation |
| **Owns WebMCP tools**        | `get_project_state`, `list_scenes`, `get_click_log`, `export_clip`, declarative export form                                                 | `propose_zoom_points`, `add_text_overlay`, `set_background`, `generate_captions`, `commit_staged_changes`          |

---

## The contract (Day 1 morning, both, 2 hours — lock this and never change without both present)

```ts
// packages/project-schema/index.ts

export type ZoomPoint = {
  id: string;
  t: number;
  to: { scale: number; x: number; y: number };  // focal, normalized 0-1
  dur: number;
  ease: string;
  staged: boolean;
};

export type TextOverlay = {
  id: string;
  text: string;
  timestamp: number;
  position: "top" | "bottom" | "center";
  staged: boolean;
};

export type Caption = {
  text: string;
  start: number;
  end: number;
};

export type Background = {
  kind: "solid" | "gradient" | "blur";
  color?: string;
  stops?: string[];
};

export type Facecam = {
  src: string | null;  // blob URL or null
  x: number;  // 0-1, position
  y: number;
  size: number;  // 0-1, relative to canvas width
};

export type Project = {
  id: string;
  clip: { src: string; duration: number; width: number; height: number };
  zoomPoints: ZoomPoint[];
  stagedZoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
  background: Background;
  facecam: Facecam;
  clickLog: { t: number; x: number; y: number; type: string }[];
  aspectPreset: "16:9" | "9:16" | "1:1" | "4:3";
};

export type ExportOpts = {
  format: "mp4" | "webm" | "gif";
  resolution: "720p" | "1080p" | "4k";
  burnCaptions: boolean;
};

// packages/engine/index.ts — Person A implements, Person B calls

export interface MediaEngine {
  loadClip(file: File): Promise<Project>;
  loadRecording(screenBlob: Blob, facecamBlob: Blob, audioBlob: Blob): Promise<Project>;
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number): void;
  exportProject(project: Project, opts: ExportOpts): Promise<Blob>;
}
```

---

## Person A's mock (tests renderer + exporter without Person B's state)

```ts
const mockProject: Project = {
  id: "test",
  clip: { src: "sample.mp4", duration: 15, width: 1920, height: 1080 },
  zoomPoints: [
    { id: "z1", t: 3, to: { scale: 2.2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: false },
  ],
  stagedZoomPoints: [],
  textOverlays: [
    { id: "t1", text: "Sign in", timestamp: 3, position: "top", staged: false },
  ],
  stagedTextOverlays: [],
  captions: [{ text: "Welcome to the demo", start: 0, end: 2 }],
  stagedCaptions: [],
  background: { kind: "gradient", stops: ["#6366f1", "#a855f7"] },
  facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
  clickLog: [{ t: 3.1, x: 0.5, y: 0.5, type: "click" }],
  aspectPreset: "16:9",
};
```

## Person B's mock (tests all editing UI + state without Person A's pipeline)

```ts
const mockEngine: MediaEngine = {
  loadClip: async (file) => ({ ...mockProject, clip: { src: URL.createObjectURL(file), duration: 15, width: 1920, height: 1080 } }),
  loadRecording: async () => ({ ...mockProject }),
  renderFrame: (ctx, project, t) => {
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, 1920, 1080);
    // draw background
    if (project.background.kind === "gradient") {
      const g = ctx.createLinearGradient(0, 0, 1920, 1080);
      project.background.stops?.forEach((c, i) => g.addColorStop(i / (project.background.stops!.length - 1), c));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1920, 1080);
    }
    // draw zoom focal points as circles
    [...project.zoomPoints, ...project.stagedZoomPoints].forEach(zp => {
      if (t >= zp.t && t <= zp.t + zp.dur) {
        ctx.strokeStyle = zp.staged ? "#f59e0b" : "#10b981";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(zp.to.x * 1920, zp.to.y * 1080, 30 * zp.to.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // draw text overlays
    [...project.textOverlays, ...project.stagedTextOverlays].forEach(to => {
      if (t >= to.timestamp && t <= to.timestamp + 3) {
        ctx.fillStyle = to.staged ? "#f59e0b" : "#fff";
        ctx.font = "32px sans-serif";
        ctx.textAlign = "center";
        const y = to.position === "top" ? 60 : to.position === "bottom" ? 1020 : 540;
        ctx.fillText(to.text, 960, y);
      }
    });
    // draw captions
    project.captions.forEach(c => {
      if (t >= c.start && t <= c.end) {
        ctx.fillStyle = "#fff";
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.text, 960, 1020);
      }
    });
    ctx.fillStyle = "#eee";
    ctx.font = "20px monospace";
    ctx.fillText(`t=${t.toFixed(1)}s`, 20, 30);
  },
  exportProject: async () => new Blob(["mock"], { type: "video/mp4" }),
};
```

---

## Phase 1: Poindeo Competitor (Days 1–4)

### Day 1 — Contract + pipeline proof

| Time | Person A | Person B |
|---|---|---|
| Morning (together, 2h) | Lock the contract above. Scaffold monorepo. Create `packages/project-schema`. | Same. |
| Afternoon (split) | `loadClip`: mediabunny demux → `VideoDecoder.decode({frameIndex, completeFramesOnly:true})` → `createImageBitmap()` → Canvas2D `drawImage`. Prove: drop file → first frame renders. | Create `mockEngine`. LLM-generate: file-drop zone, `<canvas>` with rAF playback loop, play/pause, Zustand store with full `Project` shape. Prove: drop file → mock renders → click canvas → focal dot appears. |

**End of day:** A can import and render a real frame. B can interact with the mock canvas.

### Day 2 — Recording + zoom engine + editing UI (parallel)

| Person A | Person B |
|---|---|
| **Recording:** `getDisplayMedia({video:{frameRate:{ideal:60},cursor:"always"},audio:true})` + `getUserMedia({video:webcam, audio:mic})` → two `MediaRecorder`s (`video/webm;codecs=opus`, `audioBitsPerSecond:128000`) → OPFS blobs. Permission UI (LLM-generated). | **Zoom interaction:** click on preview (paused) → add zoom-in keyframe at playhead targeting clicked pixel. Second click near existing → zoom-out. Draggable focal dots. Timeline strip with draggable diamonds. Inspector (depth 1.2–5×, duration, easing picker). |
| **Facecam PiP:** render webcam stream as overlay in `renderFrame` — draw to canvas at `facecam.x/y/size`, rounded corners. | **Undo/redo:** command pattern — each add/drag/delete on zoom points, text, backgrounds pushes a reversible command. `Cmd+Z` / `Cmd+Shift+Z`. |
| **Camera transform:** keyframe interpolation, `easeInOutCubic`, `ctx.translate(fx,fy); ctx.scale(s,s); ctx.translate(-fx,-fy)`. `renderFrame` applies zoom for timestamp `t`. | **Backgrounds:** solid color picker, gradient picker (2-stop), blur padding. Aspect presets (16:9, 9:16, 1:1, 4:3). State in Zustand. |
| **Test in isolation:** hardcoded `mockProject` with 2 zoom points → preview shows easing → facecam overlay draws. | **Test in isolation (against mock):** add zoom → diamond on timeline → undo → diamond gone → redo → back. Set background → mock renders gradient. |

### Day 3 — Export + captions + text + integration (parallel + sync)

| Morning | Person A | Person B |
|---|---|---|
| | **Export pipeline:** `VideoEncoder` (H.264) + `AudioEncoder` (AAC, mixed via `OfflineAudioContext`) → mediabunny mux → Blob. Export loop calls `renderFrame` per frame (preview = export, one renderer). | **Captions:** lazy-load Whisper WASM in a Web Worker on demand. Transcribe audio track → `Caption[]` with word-level timing. Burn-in option in render. |
| | **renderFrame expanded:** draw background → clip frame with zoom transform → facecam PiP → text overlays → captions. All fields from `Project` type rendered. | **Text overlays:** text editor (content, timestamp, position), watermark. Staged vs committed state. |
| | **OPFS integration:** `saveProject` writes JSON + blob refs to `navigator.storage.getDirectory()`. `loadProject` reads back. | **OPFS UI:** save/load buttons, project list. |

| Afternoon — INTEGRATION (both, 2h) |
|---|
| Person B replaces `mockEngine` with real `engine` import. Run: import real clip → add zoom → preview shows real camera transform → set background → add text → generate captions → undo/redo → export real MP4 with all features. |

### Day 4 — Hardening + deploy (both)

| Person A | Person B |
|---|---|
| Fix export edge cases (long clips, audio sync, codec errors). Performance: ensure 60fps preview, export ≤2× realtime for 1080p. Facecam resize/drag in preview. | Fix undo/redo edge cases (multi-step, cross-feature). Caption timing accuracy. Background rendering at export resolution. |
| Deploy to Vercel (static export). Verify HTTPS. | Test deployed URL. Write README with setup + testing instructions. |

**End of Day 4:** Working Poindeo competitor deployed. Record → import → zoom → captions → background → text → undo/redo → export. No WebMCP yet.

---

## Phase 2: WebMCP Layer (Days 5–7)

### Day 5 — Tool registration (split, parallel)

Both register in `apps/web/src/webmcp/tools.ts` — different `registerTool` calls, no merge conflict.

**Person A — engine tools (4 imperative + 1 declarative):**

```js
// READ — readOnlyHint: true
document.modelContext.registerTool({
  name: "get_project_state",
  description: "Returns the full project: clip metadata, zoom points, text overlays, captions, background, facecam, aspect preset.",
  inputSchema: { type:"object", properties:{} },
  annotations: { readOnlyHint: true },
  execute: async () => store.getProject()
});

document.modelContext.registerTool({
  name: "list_scenes",
  description: "Returns all scenes with in/out points and durations.",
  inputSchema: { type:"object", properties:{} },
  annotations: { readOnlyHint: true },
  execute: async () => store.getScenes()
});

document.modelContext.registerTool({
  name: "get_click_log",
  description: "Returns mouse-click timestamps from the recording. Empty if the clip was imported without a click log.",
  inputSchema: { type:"object", properties:{} },
  annotations: { readOnlyHint: true },
  execute: async () => store.getProject().clickLog
});

// WRITE — gated by in-execute() confirmation
document.modelContext.registerTool({
  name: "export_clip",
  description: "Exports the project as a video file. Renders locally via WebCodecs — no upload. Returns a download URL when complete.",
  inputSchema: { type:"object", properties:{ format:{type:"string", enum:["mp4","webm"]}, resolution:{type:"string", enum:["720p","1080p"]}, burnCaptions:{type:"boolean"} }, required:["format","resolution"] },
  execute: async ({ format, resolution, burnCaptions }) => {
    const confirmed = await showConfirm(`Export ${format} at ${resolution}?`);
    if (!confirmed) return { exported: false };
    const blob = await engine.exportProject(store.getProject(), { format, resolution, burnCaptions });
    return { exported: true, downloadUrl: URL.createObjectURL(blob) };
  }
});
```

```html
<!-- DECLARATIVE -->
<form tool-name="export_settings" tool-description="Export settings. Agent fills format and resolution, human clicks to confirm." action="/api/export" method="POST">
  <select name="format" tool-name="format" tool-description="Output format: mp4 or webm">
    <option value="mp4">MP4</option>
    <option value="webm">WebM</option>
  </select>
  <button type="submit">Export & Download</button>
</form>
```

**Person B — editing/staging tools (5 tools):**

```js
// STAGING — visible change, marks state as pending

document.modelContext.registerTool({
  name: "propose_zoom_points",
  description: "Proposes zoom-in keyframes at specific timestamps. The agent should watch the preview to identify moments of interest (UI clicks, text reveals, scene changes). Stages proposals as ghost diamonds — does NOT commit.",
  inputSchema: { type:"object", properties:{ timestamps:{type:"array", items:{type:"number"}, description:"Seconds in the timeline to propose zoom-ins"} }, required:["timestamps"] },
  execute: async ({ timestamps }) => {
    const proposals = timestamps.map(t => ({ id: nanoid(), t, to:{scale:2.2, x:0.5, y:0.5}, dur:0.7, ease:"easeInOutCubic", staged:true }));
    store.stageZoomProposals(proposals);
    return { stagedCount: proposals.length, proposals };
  }
});

document.modelContext.registerTool({
  name: "add_text_overlay",
  description: "Stages a text overlay at a specific timestamp and screen position. Does not commit — appears as pending in the inspector.",
  inputSchema: { type:"object", properties:{ text:{type:"string"}, timestamp:{type:"number"}, position:{type:"string", enum:["top","bottom","center"]} }, required:["text","timestamp"] },
  execute: async ({ text, timestamp, position }) => {
    store.stageTextOverlay({ id: nanoid(), text, timestamp, position, staged:true });
    return { staged: true };
  }
});

document.modelContext.registerTool({
  name: "set_background",
  description: "Stages a background change. Accepts kind='gradient' with two color stops, or kind='solid' with one color. Does not commit.",
  inputSchema: { type:"object", properties:{ kind:{type:"string", enum:["solid","gradient"]}, color:{type:"string"}, stops:{type:"array", items:{type:"string"}} }, required:["kind"] },
  execute: async ({ kind, color, stops }) => {
    store.stageBackground({ kind, color, stops });
    return { staged: true };
  }
});

document.modelContext.registerTool({
  name: "generate_captions",
  description: "Runs local Whisper transcription on the audio track. Stages word-level captions with timestamps. May take 10-30s depending on clip length. Does not commit.",
  inputSchema: { type:"object", properties:{} },
  execute: async () => {
    const captions = await whisperWorker.transcribe(store.getProject().clip.src);
    store.stageCaptions(captions);
    return { wordCount: captions.length, preview: captions.slice(0,5) };
  }
});

// WRITE — gated by in-execute() confirmation

document.modelContext.registerTool({
  name: "commit_staged_changes",
  description: "Commits ALL staged items (zoom points, text overlays, backgrounds, captions) to the project. REQUIRES human confirmation — shows the full diff and asks Yes/No before writing.",
  inputSchema: { type:"object", properties:{} },
  execute: async () => {
    const diff = store.getStagedDiff();
    const confirmed = await showConfirmDialog({ diff, message: "Commit these changes?" });
    if (!confirmed) return { committed: false, reason: "user_declined" };
    store.commitAll();
    return { committed: true, itemsCommitted: diff.totalCount };
  }
});
```

| Afternoon — joint agent test (both) |
|---|
| Open in ChatGPT in-app browser. Agent calls `propose_zoom_points` → ghost diamonds appear → agent calls `generate_captions` → captions stage → agent calls `set_background` → background stages → agent calls `commit_staged_changes` → confirmation dialog → human approves → all staged items commit → agent calls `export_clip` → MP4 downloads. |

### Day 6 — Polish + demo video (split)

| Person A | Person B |
|---|---|
| `AbortController` lifecycle (register on mount, abort on unmount). Fix tool schema issues (invalid params, clean error messages). Edge cases: empty project, no zoom points, export failure. Verify `readOnlyHint: true` on all 3 read tools. Final deploy to Vercel. | Tool-trace panel (LLM-generated): visible log of agent calls + return values. Loading states. Error states. Record 3-min demo video. Write Devpost text description (4 sections). Write README with WebMCP testing guide. |

**Demo video script:**

| Time | Content |
|---|---|
| 0:00–0:15 | "Making demo videos = manually placing zoom points. Tedious." |
| 0:15–0:30 | Import a screen recording into Open Demo Studio. |
| 0:30–1:00 | In ChatGPT in-app browser: "Watch this and propose zoom points at interesting moments." Agent calls `propose_zoom_points`. Ghost diamonds appear. |
| 1:00–1:20 | "Also add captions and set a gradient background." Agent calls `generate_captions` + `set_background`. More staged items. |
| 1:20–1:50 | Human adjusts one zoom depth. Agent calls `commit_staged_changes`. Confirmation dialog shows diff. Human clicks Yes. |
| 1:50–2:15 | "Export as 1080p MP4." Agent calls `export_clip`. Renders locally. Downloads. |
| 2:15–2:35 | Side-by-side: raw recording vs polished demo. |
| 2:35–2:50 | Tool-trace: "4 tool calls, ~3KB tokens. Without WebMCP: ~200KB screenshots + DOM scraping." |
| 2:50–3:00 | "This is WebMCP: agent sees your canvas, calls structured tools, you stay in control." |

### Day 7 — Buffer + submit (both)

Morning: re-test deployed URL with fresh ChatGPT session. Re-record demo if any segment is unclear. Fix last bugs. Afternoon: submit on Devpost by 12 PM PT.

---

## Future Planned Capabilities (Post v1.2)

### 1. Synthetic Animated Vector Cursor & Click Ripple Overlay
- **Problem**: When recording via `getDisplayMedia`, tab captures, window captures, and Linux Wayland compositors often suppress or drop the hardware mouse cursor from raw video frames.
- **Solution**:
  - Panoptik records continuous cursor trajectories `{ t, x, y, type: 'move' | 'click' }` in `project.clickLog`.
  - Add a configurable vector cursor overlay layer in `packages/engine/src/render.ts`:
    1. **Vector Cursor Pointer**: High-DPI macOS/Windows vector pointer arrow with smooth spring/cubic interpolation between trajectory points.
    2. **Click Ripples & Highlights**: Expanding glowing ripple circles rendered on `type: 'click'` events.
    3. **Custom Cursor Styling**: Configurable cursor scale ($1\times - 2.5\times$), color tint, and click glow color.
    4. **Deterministic Export Rendering**: Burned cleanly into exported MP4/WebM videos regardless of OS or browser capture behavior.

---

## What's still cut (post-hackathon)

| Feature | Why cut |
|---|---|
| Chrome extension (v0.4) | Extension review takes days; not needed for the loop |
| Multi-scene / multi-clip | Single clip is enough for the demo |
| Watermark | Skip; not relevant to agent collaboration |
| GIF export | MP4 only; one format is enough |
| PDF import | pdf.js lazy-load adds complexity for no demo value |
| Cloud render | Not needed; local export is the point |

---

## Risk contingencies

| Risk | Trigger | Fallback |
|---|---|---|
| WebCodecs won't decode test clip | Day 1 afternoon | Pre-generate a known-good H.264 MP4 with ffmpeg; use as demo clip |
| `document.modelContext` undefined | Day 5 morning | Install `@mcp-b/global` polyfill; falls back to `navigator.modelContext` |
| Agent doesn't discover tools | Day 5 afternoon | Tool descriptions too vague — rewrite with concrete "when to use this" language |
| Whisper transcription slow on demo | Day 6 | Pre-generate captions for the demo clip; cache in OPFS; tool returns cached result |
| Integration breaks on Day 3 | Day 3 afternoon | Fix the contract mismatch (usually a missing field). If unfixable in 2h, Person B keeps mockEngine and they integrate on Day 4 morning instead |
| Export slow on demo clip | Day 4 | Use a 15-second clip; pre-render once, cache the MP4 |

---

## Final checklist (Day 7 morning)

- [ ] Live URL works in ChatGPT in-app browser
- [ ] 9 imperative tools registered with `document.modelContext.registerTool`
- [ ] 1 declarative form with `tool-name` / `tool-description` (hyphenated)
- [ ] `readOnlyHint: true` on all 3 read tools
- [ ] In-`execute()` confirmation on all 3 write tools
- [ ] `AbortController` lifecycle on tool registration
- [ ] Recording with facecam PiP works
- [ ] Captions generate via Whisper WASM
- [ ] Backgrounds (solid + gradient) work
- [ ] Undo/redo works across all features
- [ ] Export produces real MP4 with zooms + captions + text + background
- [ ] Public GitHub repo with MIT (engine) + AGPL (app) licenses
- [ ] README with run instructions + WebMCP testing guide
- [ ] <3 min YouTube demo, public
- [ ] Devpost text description covers all 4 required sections
- [ ] Deployed on Vercel (HTTPS / SecureContext)