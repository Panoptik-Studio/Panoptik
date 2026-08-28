# Panoptik

Panoptik is an open-source, client-side demo video editor and screen recording studio. It runs entirely in the browser using WebCodecs, HTML5 Canvas, and mediabunny, enabling high-performance video editing, keyframe zooming, multi-track audio control, and AI co-editing via WebMCP without uploading media to external servers.

---

## Overview

Panoptik combines screen recording and demo video editing into a single browser-native tool:

- **Client-Side Processing**: All video decoding, rendering, audio mixing, and export happen directly inside your browser. No server rendering, no external uploads, and no API keys required.
- **Dynamic Zoom Keyframes**: Add smooth, eased camera zooms focused on specific screen coordinates with configurable transition speed and hold duration.
- **Multi-Track Audio Engine**: Fully separated screen audio and camera mic tracks with independent volume controls, per-segment muting, and pitch-preserving time-stretching.
- **Facecam Picture-in-Picture**: Customizable camera overlays with selectable shapes (circle, rounded square, square), 9-point positioning presets, and animated transition styles.
- **Reshoot Takes & Persistence**: Reshoot facecam segments independently with persistence across reloads via the Origin Private File System (OPFS).
- **Local AI Captions**: Client-side speech-to-text transcription powered by local Whisper models running in Web Workers.
- **Backgrounds and Canvas Styling**: Customizable padding, aspect ratios, background images, gradients, and solid themes.
- **WebMCP Co-Editing**: Standardized tool interface exposing project state, keyframe creation, captioning, and export controls to AI agents.
- **High-DPI Vector Timeline**: Multi-track timeline featuring waveform visualizations, thumbnail filmstrips, volume controllers, and crisp Retina scaling.
- **Hardware-Accelerated Export**: Real-time and faster-than-realtime video encoding into MP4 (H.264 / AAC) and WebM (VP8/VP9 / Opus) at 720p, 1080p, and 4K resolutions.

---

## Repository Structure

The project is structured as a pnpm monorepo:

```
Panoptik/
├── apps/
│   └── web/                     # Next.js 15 web application and editor interface
│       ├── src/
│       │   ├── app/             # Application routes (/editor)
│       │   ├── components/      # UI components (Timeline, PreviewCanvas, Toolbar, Modals)
│       │   ├── stores/          # Zustand project store with undo/redo history
│       │   ├── lib/             # Thumbnail extraction, caption chunkers, persistence
│       │   └── webmcp/          # WebMCP tool declarations and lifecycle handlers
│       └── public/              # Static assets and Whisper worker files
├── packages/
│   ├── engine/                  # Core video and audio processing engine
│   │   ├── src/
│   │   │   ├── decode.ts        # Video decoding pipeline and frame extraction
│   │   │   ├── render.ts        # Unified Canvas2D frame renderer
│   │   │   ├── encode.ts        # WebCodecs muxing and multi-track audio export
│   │   │   ├── audio.ts         # Audio extraction, routing, and Web Audio mixing
│   │   │   ├── timeStretch.ts   # Pitch-preserving WSOLA audio stretching algorithm
│   │   │   ├── record.ts        # Dual-stream screen and webcam recording
│   │   │   ├── opfs.ts          # Origin Private File System storage layer
│   │   │   ├── layout.ts        # Viewport framing and zoom math calculations
│   │   │   └── sanitize.ts      # Project migration and validation helpers
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
- Instant, non-destructive editing with automatic application to the timeline and history.

### 3. Audio Architecture & Pitch-Preserving Time-Stretch
- True track separation between display/system audio and webcam microphone audio.
- Independent volume sliders, mute toggles, and global track adjustments directly in the timeline.
- WSOLA (Waveform Similarity Overlap-Add) time-stretching preserves natural voice pitch when clip speed is changed.

### 4. Backgrounds & Custom Framing
- Stage padding and aspect ratio presets (16:9, 9:16, 1:1, 4:3, 21:9).
- Background image upload with OPFS local caching.
- Built-in curated gradients and solid colors.

### 5. WebMCP Integration
- Implements WebMCP tools for AI-assisted editing workflows.
- Exposes tools such as `get_project_state`, `propose_zooms`, `add_text_overlay`, `set_background`, and `generate_captions`.
- Real-time tool execution tracing in the editor inspector.

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
# Build all packages and static export
pnpm build
```

The production bundle will be output to `apps/web/out`.

---

## Quality Assurance & Testing

The repository maintains an automated test suite across the engine, project schema, audio processing, layout math, and web stores.

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
- **Origin Private File System**: Used for persistent local caching of project recordings and background assets.

---

## License

- Web application (`apps/web`): AGPL-3.0 License.
- Media engine (`packages/engine`, `packages/project-schema`, `packages/utils`): MIT License.
