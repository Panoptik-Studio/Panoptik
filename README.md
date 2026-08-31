# Panoptik

Panoptik is an open-source, client-side demo video editor and screen recording studio. It runs entirely in the browser using WebCodecs, HTML5 Canvas, and mediabunny, enabling high-performance video editing, keyframe zooming, multi-track audio control, smooth split transitions, and AI co-editing via WebMCP without uploading media to external servers.

---

## Highlights

- **100% Client-Side Processing**: All video decoding, rendering, audio mixing, and encoding happen directly inside your browser. No server rendering, no external media uploads, and no API keys required.
- **WebMCP AI Co-Editing**: Standardized tool interface exposing project state, keyframe creation, captioning, timeline trimming, and export controls to AI agents (such as in the ChatGPT browser or Chrome with `#enable-webmcp-testing`).
- **Dynamic Zoom Keyframes**: Point-and-click focal zoom configuration with smooth easing curves, adjustable hold durations, and keyboard deletion (`Del` / `Backspace`).
- **Symmetrical Distributed Transitions**: Seamless transitions between clips (Fade, Dip to Black, Slide Left/Right, Zoom In, Wipe) that occupy both adjacent clips equally across the cut boundary.
- **Facecam Picture-in-Picture with Styling**: Customizable camera PiP with selectable shapes (Circle, Square), border width sliders, custom border colors, drop shadow / glow controls, and smooth cross-clip morphing.
- **Multi-Track Audio Engine with Auto-Ducking**: Separate screen audio, microphone, voiceover, and music tracks with independent volume sliders, WSOLA pitch-preserving time-stretching, and dialogue auto-ducking.
- **Origin Private File System (OPFS) Persistence**: Projects, takes, background images, and audio tracks persist locally across page refreshes.
- **Hardware-Accelerated Export**: Real-time and faster-than-realtime video encoding into MP4 (H.264 / AAC) and WebM (VP9 / Opus) at 720p, 1080p, and 4K with configurable frame rates (24, 30, 60 fps).

---

## WebMCP (Web Model Context Protocol) Integration

Panoptik implements a complete suite of in-browser WebMCP tools that enable AI models to inspect and edit video projects collaboratively.

### Tool Catalog

| Tool                     | Type                   | Description                                                                                                                         |
| --------------------------| ------------------------| -------------------------------------------------------------------------------------------------------------------------------------|
| `get_project_state`      | Read-Only              | Returns complete project summary: duration, dimensions, segments, zoom points, text overlays, audio tracks, facecam, and click log. |
| `list_scenes`            | Read-Only              | Returns timeline scenes with cumulative start/end timestamps, durations, and transitions.                                           |
| `get_click_log`          | Read-Only              | Returns user mouse-click interaction timestamps with recommendations for zoom keyframe placement.                                   |
| `propose_zoom_points`    | Staging                | Stages zoom-in keyframes as ghost diamonds on the timeline for human review.                                                        |
| `add_text_overlay`       | Staging                | Stages text annotations/captions at specified timestamps and positions (`top`, `bottom`, `center`).                                 |
| `set_background`         | Staging                | Stages solid colors or 2-stop linear gradient stage backgrounds.                                                                    |
| `generate_captions`      | Staging                | Stages auto-caption annotations across the clip.                                                                                    |
| `split_segment`          | Action (Confirm-Gated) | Prompts human confirmation and splits clip at timeline timestamp `t`.                                                               |
| `set_speed`              | Action                 | Changes playback speed multiplier (0.5x, 1x, 1.5x, 2x) with WSOLA pitch correction.                                                 |
| `set_aspect`             | Action                 | Changes stage aspect ratio (`16:9`, `9:16`, `1:1`, `4:3`, `source`).                                                                |
| `add_music`              | Action                 | Places audio tracks onto the timeline at `startT`.                                                                                  |
| `commit_staged_changes`  | Action (Confirm-Gated) | Shows staged diff dialog; on confirmation, commits all staged proposals permanently.                                                |
| `discard_staged_changes` | Action                 | Clears all pending staged proposals without committing them.                                                                        |
| `export_clip`            | Action (Confirm-Gated) | Prompts confirmation and encodes video locally via WebCodecs returning a download URL.                                              |

### How to Test WebMCP
1. **Chrome WebMCP Testing**: Open Chrome and enable `chrome://flags/#enable-webmcp-testing`.
2. **ChatGPT In-App Browser**: Open Panoptik inside the ChatGPT web browser to let the model invoke tools.
3. **AI Video Director Guide**: Read the comprehensive [LLM AI Video Director Guide](docs/LLM_WEBMCP_DIRECTOR_GUIDE.md) for step-by-step reasoning protocols and examples.
4. **Browser Console**: Call tools directly from the DevTools console:
   ```javascript
   await window.__panoptik_call_tool("get_project_state");
   await window.__panoptik_call_tool("propose_zoom_points", { timestamps: [2.5, 6.0], scale: 2.2 });
   ```
4. **Live Tool Trace**: View all agent calls, inputs, durations, and outputs in the **Agent Tool Trace** panel in the inspector.

---

## Repository Structure

The project is structured as a pnpm monorepo:

```
Panoptik/
├── apps/
│   └── web/                     # Next.js 15 web application and editor interface
│       ├── src/
│       │   ├── app/             # Application routes (/projects, /editor)
│       │   ├── components/      # UI components (Timeline, PreviewCanvas, StageControls, CameraControls, etc.)
│       │   ├── stores/          # Zustand project store with undo/redo history
│       │   ├── lib/             # Persistence, thumbnail extraction, export drivers
│       │   └── webmcp/          # WebMCP tool declarations, lifecycle handlers, and validation tests
│       └── public/              # Static assets
├── packages/
│   ├── engine/                  # Core video and audio processing engine
│   │   ├── src/
│   │   │   ├── decode.ts        # Video decoding pipeline and frame extraction
│   │   │   ├── render.ts        # Canvas2D frame renderer with distributed transitions and facecam styling
│   │   │   ├── encode.ts        # WebCodecs encoding and multi-track audio export
│   │   │   ├── audio.ts         # Audio extraction, routing, and Web Audio mixing
│   │   │   ├── audioTracks.ts   # Multi-track layering, volume envelopes, and ducking
│   │   │   ├── timeStretch.ts   # Pitch-preserving WSOLA audio stretching algorithm
│   │   │   ├── record.ts        # Dual-stream screen and webcam recording
│   │   │   ├── opfs.ts          # Origin Private File System storage layer
│   │   │   └── layout.ts        # Viewport framing and aspect ratio math
│   ├── project-schema/          # TypeScript schemas and migration logic
│   └── utils/                   # Shared mathematics, easings, and utility functions
```

---

## Core Capabilities

### 1. Recording & Reshoots
- Record screen and camera simultaneously into dedicated media tracks.
- Select audio input sources with options for screen audio, microphone, or both.
- Reshoot specific facecam segments while preserving original screen footage and sync.

### 2. Zoom & Camera Motion
- Point-and-click focal point zoom configuration on the preview canvas.
- Configurable zoom scales (1.0x to 5.0x), transition durations, hold windows, and easing curves.
- Instant, non-destructive editing with keyboard deletion (`Del` / `Backspace`).

### 3. Distributed Clip Transitions
- Smooth symmetrical transitions across cuts (Fade, Dip to Black, Slide Left/Right, Zoom In, Wipe).
- 50/50 time distribution across outgoing and incoming clips.
- Facecam PiP smoothly glides, morphs, and resizes across segment splits.

### 4. Facecam Picture-in-Picture Styling
- Shapes: Circle and Square with customizable corner radius.
- Adjustable border width (0 to 12px) with preset colors and custom hex color picker.
- Drop shadow and glow effects with configurable blur radius (0 to 48px) and shadow color.

### 5. Multi-Track Audio & Pitch-Preserving Speed
- Independent volume control for screen audio, microphone, voiceover, and background music.
- Auto-ducking algorithm lowers music volume under dialogue automatically.
- WSOLA (Waveform Similarity Overlap-Add) preserves natural voice pitch when clip speed is altered.

---

## Quickstart

### Prerequisites
- Node.js 20+ (recommended: Node 20.19.6 or Node 24)
- pnpm 9+ or 10+
- Chromium-based browser (Chrome, Edge, Brave 110+) supporting WebCodecs and OPFS.

### Installation

```bash
# Clone the repository
git clone https://github.com/Panoptik-Studio/Panoptik.git
cd Panoptik

# Install dependencies
pnpm install
```

### Development Server

```bash
# Start the local development server
pnpm dev
```

Open [http://localhost:3000/editor](http://localhost:3000/editor) in your browser.

### Building for Production

```bash
# Build all packages and generate static output
pnpm build
```

The production bundle will be output to `apps/web/out`.

---

## Quality Assurance & Testing

The repository maintains an automated test suite across the engine, project schema, audio processing, layout math, WebMCP tools, and web stores.

```bash
# Run all unit and integration test suites
pnpm test

# Run TypeScript typechecks across all monorepo packages
pnpm typecheck
```

---

## Browser Requirements & Security

- **Secure Context**: WebCodecs, MediaRecorder, and OPFS require a Secure Context (`https://` or `http://localhost`).
- **WebCodecs Support**: Supported natively in Chromium 110+, Safari 16.4+, and Firefox 130+ (with media flags enabled).
- **Origin Private File System (OPFS)**: Used for persistent local caching of project recordings, background assets, and audio tracks.

---

## License

- Web application (`apps/web`): AGPL-3.0 License.
- Media engine (`packages/engine`, `packages/project-schema`, `packages/utils`): MIT License.
