# Panoptik × WebMCP

> The open-source, browser-native demo video studio where you and your AI agent co-edit on the same canvas. Drop in a recording, the agent watches the preview, proposes zoom points and captions at the interesting moments, you review a diff and commit, then export a polished MP4 — all client-side, no uploads, no server.

**Hackathon:** The WebMCP Challenge (OpenAI, Devpost) — September 2026
**Live demo:** _[your Vercel URL here]_
**Demo video:** _[your YouTube URL here]_
**License:** MIT (engine) + AGPL-3.0 (app)

---

## Why this project

Making a polished demo video today means manually placing every zoom keyframe, typing every caption, picking every background. A 2-minute product demo might need 15 zoom points, 40 caption lines, and 3 background changes — all placed by hand in a timeline UI. It's tedious, error-prone, and the reason most people ship raw recordings instead of polished demos.

**Panoptik fixes this by making the editor agent-native.** When you open the editor in ChatGPT's in-app browser (or Chrome with the WebMCP flag), your agent can watch the same preview you're watching, identify the interesting moments (UI clicks, text reveals, scene changes), and propose zoom points, captions, and backgrounds as a staged diff. You review the diff, approve it, and export. The agent does the tedious 80%; you do the creative 20%.

---

## Why WebMCP is the right tool for this (not backend MCP, not DOM scraping)

This is the core question the hackathon asks, and the answer is specific to this project:

**The agent needs to see the rendered preview.** A demo video's interesting moments — "the user clicked the login button at 0:08" or "the dashboard appeared at 0:15" — are visible only in the rendered canvas, not in the DOM or any serialized state. The agent (running inside ChatGPT's in-app browser or Chrome) can see the canvas natively via its own vision. But seeing is not enough — the agent needs to **act** on what it sees.

**Without WebMCP**, the agent would have to screenshot the editor UI, parse the DOM to find the timeline, calculate pixel coordinates for timestamp 8.0, and simulate mouse clicks to drag timeline diamonds. This is brittle, token-expensive (~150KB per action in screenshots + DOM dumps), and unreliable — the agent might click the wrong element or drag to the wrong timestamp.

**With WebMCP**, the editor exposes its editing capabilities as structured tools. The agent calls `propose_zoom_points({timestamps:[8.0, 15.0]})` and gets back structured JSON. One tool call replaces dozens of simulated UI interactions, at ~2KB instead of ~150KB. The agent's vision handles the "what's interesting"; WebMCP handles the "make it happen."

**A backend MCP server cannot do this** because the project state (zoom keyframes, camera transforms, Canvas2D render state, OPFS-stored media) is all client-side. The backend has no access to the rendered preview, no access to the live canvas, and no access to the browser session. Only a browser-resident agent calling client-side WebMCP tools can bridge "I see the interesting moment" to "the project now has a zoom point there."

---

## What people and agents do together (that was previously impossible)

| Before WebMCP | With WebMCP |
|---|---|
| Human manually places every zoom point by clicking on the preview at the right timestamp | Agent watches the preview, identifies interesting moments, proposes zoom points automatically |
| Human types every caption line by hand | Agent triggers local Whisper transcription, stages word-level captions with timestamps |
| Human picks a background from a color picker | Agent suggests a background based on the video's content ("use a warm gradient for the onboarding demo") |
| Human exports and hopes it looks right | Agent can call `get_project_state` to verify the project before export |
| ~5 minutes of manual editing per minute of video | ~30 seconds of review-and-approve per minute of video |

The key insight: **the agent proposes, the human disposes.** Every agent action is staged as a diff (ghost diamonds on the timeline, pending items in the inspector). The human reviews the diff and clicks "Commit" — or adjusts individual items first. The agent never writes directly to the project. This is the human-in-the-loop safety pattern that WebMCP's structured-call model makes possible.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser Tab (Next.js)                  │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Preview     │  │  Timeline +  │  │  Tool Trace    │  │
│  │  Canvas      │  │  Inspector   │  │  (agent calls) │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────────┘  │
│         │                 │                                │
│         ▼                 ▼                                │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Zustand Store (Project State)            │ │
│  │  zoomPoints[] · stagedZoomPoints[] · captions[]       │ │
│  │  textOverlays[] · background · facecam · clickLog     │ │
│  └──────────────────┬───────────────────────────────────┘ │
│                     │                                     │
│     ┌───────────────┼───────────────┐                     │
│     ▼               ▼               ▼                     │
│  ┌──────┐    ┌────────────┐  ┌───────────┐               │
│  │Engine│    │Whisper WASM│  │  WebMCP   │               │
│  │(TS)  │    │  (Worker)  │  │  Tools    │               │
│  └──┬───┘    └────────────┘  └─────┬─────┘               │
│     │                               │                     │
│     ▼                               ▼                     │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              Native Browser APIs                     │ │
│  │  WebCodecs · Canvas2D · mediabunny · OPFS            │ │
│  │  getDisplayMedia · getUserMedia · OfflineAudioContext│ │
│  └──────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐ │
│  │              document.modelContext                     │ │
│  │  registerTool() · getTools() · executeTool()          │ │
│  │  ↓ discovered by ↓                                     │ │
│  │  ChatGPT in-app browser · Chrome agent (flag)         │ │
│  └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Design principles

1. **The browser is the media engine.** All decode, render, and encode happens via WebCodecs + Canvas2D — no ffmpeg.wasm, no server-side transcoding. This matches the Poindeo-validated architecture: zero WASM for media processing (Whisper WASM for captions is the sole exception, lazy-loaded only on demand).

2. **Preview equals export.** The `renderFrame()` function is the single source of truth. Preview calls it at display refresh rate; export calls it per-frame in the encode loop. If it looks right in preview, the export is right. This eliminates the "export looks different" bug class.

3. **Agent proposes, human disposes.** Every agent tool either reads state (read-only, `readOnlyHint: true`) or stages a change (pending diff). The only write tool (`commit_staged_changes`) surfaces a confirmation dialog with the full diff. The agent never writes directly.

4. **Two-API coverage.** The project uses both the imperative API (`document.modelContext.registerTool`) for complex tools and the declarative API (`tool-name` / `tool-description` HTML attributes) for the export settings form. This demonstrates full spec coverage.

5. **Zero uploads.** Privacy is architecture, not a promise. The codebase has no upload endpoint. All media stays in the browser. AGPL source lets anyone verify this claim by reading every line.

---

## WebMCP tool catalog

The project exposes 9 imperative tools and 1 declarative form. Each tool follows one of three patterns identified by Alex Nahas (creator of MCP-B and WebMCP spec contributor):

### Read-only tools (flat list, always available, `readOnlyHint: true`)

| Tool | Description | Why the agent needs it |
|---|---|---|
| `get_project_state` | Returns the full project: clip metadata, committed zoom points, text overlays, captions, background, facecam, click log | The agent needs to know what's already in the project before proposing changes — without scraping the DOM |
| `list_scenes` | Returns scenes with in/out points | Lets the agent understand the video structure |
| `get_click_log` | Returns mouse-click timestamps from the recording | The agent uses this to find moments where the user interacted with the UI — prime zoom-point candidates |

### Staging tools (propose changes, mark as pending, do NOT commit)

| Tool | Description | What it stages |
|---|---|---|
| `propose_zoom_points` | Takes an array of timestamps, creates zoom-in keyframes at each, stages them as ghost diamonds on the timeline | Ghost zoom points (dashed outline, not yet committed) |
| `add_text_overlay` | Takes text, timestamp, and position, stages a text overlay | Pending text overlay in the inspector |
| `set_background` | Takes kind (solid/gradient) and color/stops, stages a background change | Pending background swap |
| `generate_captions` | Runs local Whisper WASM transcription, stages word-level captions with timestamps | Pending caption track |

### Write tool (gated by human confirmation inside `execute()`)

| Tool | Description | Safety mechanism |
|---|---|---|
| `commit_staged_changes` | Commits ALL staged items to the project | Shows a confirmation dialog with the full diff (green additions). The human clicks Yes/No. The agent cannot bypass this. |
| `export_clip` | Exports the project as MP4/WebM via WebCodecs | Shows a confirmation dialog with format/resolution before rendering |

### Declarative form (HTML attributes, agent fills, human submits)

| Form | Attributes | Purpose |
|---|---|---|
| Export settings | `tool-name="export_settings"` `tool-description="..."` on `<form>`; `tool-name` on `<select>` and `<input>` elements | The agent can fill the format/resolution/captions fields, but the human must click "Export & Download" — the form does not auto-submit |

---

## How the agent collaboration works (end to end)

1. **Human imports a clip** — drags a screen recording into the editor. The engine decodes it via mediabunny + WebCodecs and creates a `Project` with empty zoom points, no captions, default background.

2. **Agent discovers the tools** — when the page loads, `document.modelContext.registerTool()` is called 9 times. The agent (ChatGPT in-app browser or Chrome with flag) discovers these tools and their descriptions.

3. **Agent reads the project state** — the agent calls `get_project_state` to understand what's already there (nothing, usually) and `get_click_log` to find UI interaction timestamps from the recording.

4. **Agent watches the preview** — the agent uses its own vision (it's in the browser, it can see the canvas) to watch the video play and identify moments of interest: "the user clicked the login button at 0:08, the dashboard loaded at 0:15, the form appeared at 0:22."

5. **Agent proposes changes** — the agent calls `propose_zoom_points({timestamps:[8, 15, 22]})`. Three ghost diamonds appear on the timeline. The agent calls `generate_captions()` — Whisper WASM runs in a worker, stages word-level captions. The agent calls `set_background({kind:"gradient", stops:["#6366f1","#a855f7"]})`.

6. **Human reviews the diff** — the staging panel shows all pending changes: "3 zoom points, 47 captions, 1 background." The human can click any ghost diamond to adjust its depth or focal point, or reject individual items.

7. **Human commits** — the agent calls `commit_staged_changes()`. A confirmation dialog appears showing the full diff. The human clicks "Confirm." All staged items become permanent. Ghost diamonds become solid. Captions appear on the timeline.

8. **Human exports** — the agent calls `export_clip({format:"mp4", resolution:"1080p"})`. A confirmation dialog appears. The human clicks "Confirm." The engine renders each frame through the same `renderFrame()` function the preview used, encodes via WebCodecs, muxes via mediabunny, and returns a Blob. The browser downloads the MP4.

9. **The tool-trace panel** — throughout this process, a visible panel on the right side of the editor logs every tool call: tool name, input params, return value, duration. This makes the WebMCP leverage visible to judges and to users who want to understand what the agent did.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Framework | Next.js 15 (static export) | Zero server needed; deploys as static files to Vercel/Cloudflare |
| State | Zustand | Lightweight, no provider tree, works perfectly with Canvas2D render loops |
| Media decode | mediabunny + WebCodecs `VideoDecoder` | Native codec access, ~20× faster than ffmpeg.wasm, zero WASM |
| Media encode | WebCodecs `VideoEncoder` + `AudioEncoder` + mediabunny mux | Same native pipeline, reversed |
| Rendering | Canvas2D + `ctx.translate/scale` | GPU-composited, 60fps, the camera transform math lives here |
| Recording | `getDisplayMedia` + `getUserMedia` + `MediaRecorder` | Zero-install screen + webcam + mic capture |
| Captions | Whisper WASM (`@xenova/transformers`) in a Web Worker | Local, private, lazy-loaded only on demand |
| Persistence | OPFS (`navigator.storage.getDirectory()`) | Large quota, off-main-thread writes, portable project bundles |
| WebMCP | `document.modelContext.registerTool` + declarative HTML attributes | The W3C Web Machine Learning Community Group draft standard |
| Polyfill | `@mcp-b/global` (fallback) | For browsers without native WebMCP support |
| Deployment | Vercel (static export, HTTPS/SecureContext) | Required for WebMCP; satisfies the Vercel sponsor prize |

**No ffmpeg.wasm. No server. No uploads. No database. No API keys.**

---

## How to run locally

### Prerequisites

- Node.js 20+
- pnpm 9+
- Chrome Canary/Dev 146+ with `chrome://flags/#enable-webmcp-testing` enabled
- Or ChatGPT's in-app browser (supports WebMCP natively)

### Setup

```bash
git clone https://github.com/Panoptik-Studio/Panoptik.git
cd Panoptik
pnpm install
pnpm dev
```

Open `http://localhost:3000/editor`.

### Testing with an agent

**Option A — ChatGPT in-app browser (recommended):**
1. Open ChatGPT in the mobile or desktop app
2. Ask ChatGPT to open a URL: "Open http://localhost:3000/editor in the browser"
3. ChatGPT's in-app browser supports WebMCP natively — the agent will discover the 9 tools
4. Ask the agent: "Watch this video and propose zoom points at the interesting moments"

**Option B — Chrome with flag:**
1. Open Chrome Canary/Dev
2. Navigate to `chrome://flags/#enable-webmcp-testing`
3. Enable the flag, relaunch
4. Open `http://localhost:3000/editor`
5. Use Chrome's built-in agent or an extension that supports WebMCP

### Testing without an agent

The editor works fully without an agent. You can:
- Drop a video file → it renders on canvas
- Click on the preview (paused) → add a zoom-in keyframe
- Click again near an existing focal → zoom out
- Drag focal dots → adjust position
- Use the inspector → change depth, duration, easing
- Set backgrounds, add text overlays, generate captions
- Undo/redo with Cmd+Z / Cmd+Shift+Z
- Export to MP4

---

## Project structure

```
Panoptik/
├─ apps/
│  └─ web/                         # Next.js static export
│     ├─ src/
│     │  ├─ app/editor/            # Editor route
│     │  ├─ components/            # React UI (preview, timeline, inspector, panels)
│     │  ├─ stores/                # Zustand (project state + undo/redo history)
│     │  ├─ webmcp/                # Tool registration (9 imperative + 1 declarative)
│     │  └─ workers/               # Whisper transcription worker
│     └─ next.config.ts            # output: 'export'
├─ packages/
│  ├─ engine/                      # Media pipeline (MIT, npm-publishable)
│  │  └─ src/
│  │     ├─ decode.ts              # mediabunny demux → VideoDecoder
│  │     ├─ render.ts              # Canvas2D renderFrame + camera transform
│  │     ├─ encode.ts              # VideoEncoder + AudioEncoder + mediabunny mux
│  │     ├─ record.ts             # getDisplayMedia + getUserMedia → MediaRecorder
│  │     └─ opfs.ts                # Project save/load via OPFS
│  └─ project-schema/              # Shared Zod types (the locked contract)
└─ README.md                       # This file
```

### Development model: two independent slices

The project was built by two developers working in parallel on independent vertical slices:

**Person A — Media Pipeline:** owns the engine package (decode, render, encode, record, OPFS) and the WebMCP tools that wrap engine functions (`get_project_state`, `list_scenes`, `get_click_log`, `export_clip`, declarative export form). Developed and tested against a hardcoded mock project with all fields populated.

**Person B — Editor + State:** owns the Zustand store, zoom interaction logic, captions (Whisper), backgrounds, text overlays, undo/redo, and the WebMCP tools that wrap editing functions (`propose_zoom_points`, `add_text_overlay`, `set_background`, `generate_captions`, `commit_staged_changes`). Developed and tested against a mock engine that renders placeholder frames.

Both slices were developed against a locked type contract (`packages/project-schema`) and integrated on Day 3. The slices never shared code paths — only the type contract.

---

## Security and privacy

### WebMCP security posture

This project follows the WebMCP spec's security guidance:

- **Read-only tools are marked** with `annotations: { readOnlyHint: true }` — the agent and the browser know these don't mutate state
- **Write tools require human confirmation** — `commit_staged_changes` and `export_clip` both surface a confirmation dialog inside `execute()` before writing. The agent cannot bypass this
- **No `toolautosubmit`** — the declarative export form requires a human click on the submit button. The agent can fill the fields but cannot submit
- **Tool descriptions use positive language** — they describe what the tool *can* do, not what it *can't* (per Chrome WebMCP best practices)
- **AbortController lifecycle** — tools are registered on mount and aborted on unmount to prevent leaked registrations

### Privacy posture

- **No upload endpoint exists in the codebase** — this is verifiable by reading the source
- **All media processing is client-side** — WebCodecs, Canvas2D, OPFS
- **Whisper captions run locally** — the audio never leaves the browser
- **No telemetry by default** — zero network requests in the editor
- **AGPL-3.0 license** — any fork must stay open-source

---

## Demo video script (3 minutes)

| Time | Content |
|---|---|
| 0:00–0:15 | The problem: "Making demo videos means manually placing every zoom point. A 2-minute demo needs 15+ zooms, 40+ captions. Most people ship raw recordings instead." |
| 0:15–0:30 | Import a screen recording into Panoptik. The clip renders on the canvas. |
| 0:30–1:00 | In ChatGPT's in-app browser, ask: "Watch this preview and propose zoom points at the interesting moments." The agent calls `get_click_log`, then `propose_zoom_points`. Ghost diamonds appear on the timeline. |
| 1:00–1:20 | Ask: "Also add captions and set a gradient background." The agent calls `generate_captions` (Whisper runs locally) and `set_background`. More items stage. |
| 1:20–1:50 | The human adjusts one zoom depth from 2× to 2.5× by dragging. The agent calls `commit_staged_changes`. A confirmation dialog shows the full diff. The human clicks "Confirm." All staged items commit. Ghost diamonds become solid. |
| 1:50–2:15 | Ask: "Export as 1080p MP4." The agent calls `export_clip`. Confirmation dialog. Human confirms. MP4 renders locally and downloads. |
| 2:15–2:35 | Side-by-side: raw recording vs polished demo with zooms, captions, text, and gradient background. |
| 2:35–2:50 | Tool-trace panel: "4 tool calls, ~3KB tokens. Without WebMCP: ~200KB in screenshots + DOM scraping per action. The agent saw the canvas, called structured tools, and the human stayed in control of every commit." |
| 2:50–3:00 | "This is WebMCP: the agent sees your canvas, calls structured tools to edit your project, and you stay in control." |

---

## WebMCP implementation notes

### API surface used

- **Imperative API:** `document.modelContext.registerTool({ name, description, inputSchema, annotations, execute, signal })` — 9 tools registered
- **Declarative API:** `tool-name` and `tool-description` HTML attributes on `<form>` and its child elements — 1 export settings form
- **Tool discovery:** `document.modelContext.getTools()` — used by the agent to discover available tools
- **Annotations:** `readOnlyHint: true` on all 3 read-only tools; omitted on staging and write tools
- **Lifecycle:** `AbortController` + `signal` on each `registerTool` call; aborted on component unmount

### What we deliberately did NOT use

- `requestUserInteraction()` — this method does not exist in the WebMCP spec. Human confirmation is implemented inside the tool's `execute()` function via a custom event that triggers a React portal dialog
- `toolautosubmit` attribute — unverified in the spec; omitted. The declarative form requires a human click on the submit button
- `navigator.modelContext` — this is the polyfill's API surface (`@mcp-b/global`), not the standard. The standard is `document.modelContext`. We use the standard as primary, polyfill as fallback

### Token efficiency

Based on the quickstart benchmark and community measurements, WebMCP tool calls use ~89% fewer tokens than screenshot + DOM scraping approaches for equivalent agent tasks. In this project, the agent's typical workflow (read state + propose 3 zoom points + generate captions + set background + commit + export) is ~6 tool calls returning structured JSON (~3KB total). The equivalent screenshot-based approach would require ~6 screenshots + DOM parses (~200KB+ total).

---

## Roadmap (post-hackathon)

| Phase | Features |
|---|---|
| v0.2 | Multi-scene support, text overlay styling, keyboard shortcut editor |
| v0.3 | In-tab recording improvements, takes library, webcam positioning UI |
| v0.4 | Chrome MV3 extension with mouse-event capture for auto-zoom suggestions |
| v0.5 | SRT/VTT caption sidecar export, PDF-to-video, privacy blur regions |
| Later | Mini-tools suite (compress, crop, split, merge), optional hosted convenience tier, i18n, template gallery |

The engine package (`@panoptik/engine`, MIT) is designed to be npm-publishable — other projects can embed the zoom-rendering pipeline in their apps. This is the contributor magnet and the moat against maintainer burnout.

---

## Team

Built by two developers in 7 days for The WebMCP Challenge.

- **[Developer 1]** — Media Pipeline: WebCodecs decode/encode, Canvas2D rendering, camera transform math, recording, OPFS persistence, WebMCP read/export tools
- **[Developer 2]** — Editor + State: Zustand store, zoom interaction, captions (Whisper), backgrounds, text overlays, undo/redo, WebMCP staging/commit tools, deployment, demo video

---

## License

- `packages/engine/` — MIT License (embeddable in any project, including commercial)
- `apps/web/` — AGPL-3.0 License (any fork that adds cloud features must open-source them)

This dual-license model is the legal moat: AGPL on the app prevents closed-source SaaS forks; MIT on the engine maximizes adoption and corporate contributions.

---

## Acknowledgments

- The [WebMCP specification](https://webmachinelearning.github.io/webmcp/) authors at the W3C Web Machine Learning Community Group
- [Chrome WebMCP documentation](https://developer.chrome.com/docs/ai/webmcp) and best-practices guidance
- [Alex Nahas](https://www.arcade.dev/blog/web-mcp-alex-nahas-interview) for MCP-B, the predecessor to WebMCP, and the three-tool-pattern framework (read / navigation / write-with-elicitation) that this project implements
- The [OpenAI WebMCP Challenge](https://webmcp.devpost.com/) for the forcing function to ship this in 7 days