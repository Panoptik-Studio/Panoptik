# Project Spec: Open Demo Studio × WebMCP

## What to build

A browser-native, zero-install demo video studio where a human and an AI agent co-edit a screen recording on the same canvas. The human imports a clip, the agent watches the preview and proposes zoom points / captions / backgrounds / text overlays at moments of interest, stages them as a diff, the human reviews and commits, then exports a polished MP4 — all client-side, no uploads.

**Two-layer architecture:**
1. **Days 1–4:** Poindeo competitor (the core editor with recording, zoom, captions, backgrounds, text, undo/redo, export)
2. **Days 5–7:** WebMCP layer (agent calls structured tools to propose/stage/commit edits)

The hackathon submission is the full integrated product.

---

## Tech stack

- Next.js 15 (static export) + TypeScript
- Zustand for state management
- Tailwind CSS for styling
- WebCodecs (`VideoDecoder`, `VideoEncoder`, `AudioEncoder`) for media processing
- `mediabunny` for MP4/WebM demux/mux
- `gifenc` for GIF export (post-hackathon)
- OPFS (`navigator.storage.getDirectory()`) for project persistence
- `getDisplayMedia` + `getUserMedia` for recording
- Whisper WASM (lazy-loaded in a Web Worker) for captions
- `document.modelContext.registerTool` for WebMCP (with `@mcp-b/global` polyfill fallback)
- Vercel for deployment

**No ffmpeg.wasm. No server. No uploads. All media processing is client-side.**

---

## Monorepo structure

```
open-demo-studio/
├─ apps/
│  ├─ web/                    # Next.js static export (editor + landing)
│  │  ├─ src/
│  │  │  ├─ app/              # Routes: /, /editor
│  │  │  ├─ components/        # React UI (LLM-generated)
│  │  │  ├─ stores/           # Zustand stores
│  │  │  ├─ webmcp/            # Tool registration (tools.ts)
│  │  │  └─ workers/           # Whisper worker, export worker
│  │  └─ next.config.ts       # output: 'export'
│  └─ extension/              # MV3 recorder (post-hackathon)
├─ packages/
│  ├─ engine/                 # Media pipeline (MIT, npm-publishable)
│  │  ├─ src/
│  │  │  ├─ decode.ts         # mediabunny demux → VideoDecoder
│  │  │  ├─ render.ts         # Canvas2D renderFrame with camera transform
│  │  │  ├─ encode.ts         # VideoEncoder + AudioEncoder + mediabunny mux
│  │  │  ├─ record.ts         # getDisplayMedia + getUserMedia → MediaRecorder
│  │  │  ├─ opfs.ts           # Project save/load
│  │  │  └─ index.ts          # Exports MediaEngine interface
│  ├─ project-schema/         # Zod schemas + types (shared contract)
│  │  └─ src/index.ts
│  └─ utils/                  # Easing functions, colors, logging
├─ docs/
├─ LICENSE                    # MIT (engine) + AGPL-3.0 (app)
└─ README.md
```

---

## Shared types (packages/project-schema/src/index.ts)

```typescript
export type ZoomPoint = {
  id: string;
  t: number;                    // timestamp in seconds
  to: { scale: number; x: number; y: number };  // focal point, normalized 0-1
  dur: number;                  // easing duration in seconds
  ease: string;                 // "easeInOutCubic"
  staged: boolean;              // true = ghost (pending), false = committed
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
  start: number;  // seconds
  end: number;    // seconds
};

export type Background = {
  kind: "solid" | "gradient" | "blur";
  color?: string;        // for "solid"
  stops?: string[];      // for "gradient" (2 colors)
};

export type Facecam = {
  src: string | null;    // blob URL of webcam recording, or null
  x: number;             // 0-1 position (top-left corner)
  y: number;             // 0-1 position
  size: number;          // 0-1 relative to canvas width
};

export type ClickEvent = {
  t: number;     // timestamp
  x: number;     // 0-1 normalized
  y: number;     // 0-1 normalized
  type: string;  // "click" | "scroll" | "move"
};

export type Project = {
  id: string;
  clip: {
    src: string;        // blob URL or OPFS path
    duration: number;
    width: number;
    height: number;
  };
  zoomPoints: ZoomPoint[];           // committed
  stagedZoomPoints: ZoomPoint[];     // ghost (pending agent proposals)
  textOverlays: TextOverlay[];
  stagedTextOverlays: TextOverlay[];
  captions: Caption[];
  stagedCaptions: Caption[];
  background: Background;
  facecam: Facecam;
  clickLog: ClickEvent[];
  aspectPreset: "16:9" | "9:16" | "1:1" | "4:3";
};

export type ExportOpts = {
  format: "mp4" | "webm" | "gif";
  resolution: "720p" | "1080p" | "4k";
  burnCaptions: boolean;
};

export interface MediaEngine {
  loadClip(file: File): Promise<Project>;
  loadRecording(screenBlob: Blob, facecamBlob: Blob, audioBlob: Blob): Promise<Project>;
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number): void;
  exportProject(project: Project, opts: ExportOpts): Promise<Blob>;
}
```

---

## Slice A: Media Pipeline (Person A owns)

### A1: Import pipeline (packages/engine/src/decode.ts)

```typescript
import { demux } from "mediabunny";

export async function loadClip(file: File): Promise<Project> {
  const buffer = await file.arrayBuffer();
  const { tracks, samples } = await demux(new Uint8Array(buffer));

  const videoTrack = tracks.find(t => t.type === "video");
  if (!videoTrack) throw new Error("No video track found");

  const decoder = new VideoDecoder({
    output: (frame) => { /* store frame in frame buffer */ },
    error: (e) => console.error("Decoder error:", e),
  });

  decoder.configure({
    codec: videoTrack.codec,
    codedWidth: videoTrack codedWidth,
    codedHeight: videoTrack.codedHeight,
  });

  // Decode frames on demand using frameIndex for seeking
  // Use completeFramesOnly: true to prevent partial-frame flicker at seek boundaries

  return {
    id: crypto.randomUUID(),
    clip: {
      src: URL.createObjectURL(file),
      duration: videoTrack.duration,
      width: videoTrack.codedWidth,
      height: videoTrack.codedHeight,
    },
    zoomPoints: [],
    stagedZoomPoints: [],
    textOverlays: [],
    stagedTextOverlays: [],
    captions: [],
    stagedCaptions: [],
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    clickLog: [],
    aspectPreset: "16:9",
  };
}

export async function getFrameAt(
  project: Project,
  timestamp: number
): Promise<ImageBitmap | null> {
  // Seek to the frame nearest to timestamp
  // Decode that specific frame using frameIndex + completeFramesOnly: true
  // Return ImageBitmap for drawing to Canvas2D
}
```

### A2: Recording (packages/engine/src/record.ts)

```typescript
export async function startRecording(): Promise<RecordingHandles> {
  // Screen capture
  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 }, cursor: "always" },
    audio: true,  // system audio (Windows/ChromeOS only)
  });

  // Webcam + mic
  const facecamStream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 360 },
    audio: true,
  });

  // Record screen
  const screenRecorder = new MediaRecorder(screenStream, {
    mimeType: "video/webm;codecs=opus",
    audioBitsPerSecond: 128000,
  });
  const screenChunks: Blob[] = [];
  screenRecorder.ondataavailable = (e) => { if (e.data.size) screenChunks.push(e.data); };

  // Record facecam (video only — audio is in screen stream or separate)
  const facecamRecorder = new MediaRecorder(facecamStream, {
    mimeType: "video/webm",
  });
  const facecamChunks: Blob[] = [];
  facecamRecorder.ondataavailable = (e) => { if (e.data.size) facecamChunks.push(e.data); };

  screenRecorder.start();
  facecamRecorder.start();

  return {
    screenStream,
    facecamStream,
    stop: async () => {
      screenRecorder.stop();
      facecamRecorder.stop();
      screenStream.getTracks().forEach(t => t.stop());
      facecamStream.getTracks().forEach(t => t.stop());
      return {
        screenBlob: new Blob(screenChunks, { type: "video/webm" }),
        facecamBlob: new Blob(facecamChunks, { type: "video/webm" }),
      };
    },
  };
}

export async function loadRecording(
  screenBlob: Blob,
  facecamBlob: Blob,
  audioBlob: Blob
): Promise<Project> {
  // Demux screen recording, decode first frame for thumbnail
  // Return Project with clip.src = URL.createObjectURL(screenBlob)
  // facecam.src = URL.createObjectURL(facecamBlob)
}
```

### A3: Camera transform + renderFrame (packages/engine/src/render.ts)

```typescript
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number
): void {
  const { clip, background, facecam, zoomPoints, textOverlays, captions } = project;

  // 1. Calculate camera transform at time t
  const transform = getCameraTransform(zoomPoints, t);

  // 2. Draw background
  drawBackground(ctx, background, clip.width, clip.height);

  // 3. Draw clip frame with camera transform applied
  ctx.save();
  const fx = transform.x * clip.width;
  const fy = transform.y * clip.height;
  ctx.translate(fx, fy);
  ctx.scale(transform.scale, transform.scale);
  ctx.translate(-fx, -fy);
  // drawImage(decodedFrame, 0, 0) — Person A's decode pipeline provides the frame
  ctx.restore();

  // 4. Draw facecam PiP (NOT transformed by zoom — stays in screen space)
  if (facecam.src) {
    drawFacecam(ctx, facecam, clip.width, clip.height);
  }

  // 5. Draw text overlays (NOT transformed)
  [...textOverlays, ...project.stagedTextOverlays].forEach(overlay => {
    if (t >= overlay.timestamp && t <= overlay.timestamp + 3) {
      drawTextOverlay(ctx, overlay);
    }
  });

  // 6. Draw captions (NOT transformed)
  [...captions, ...project.stagedCaptions].forEach(caption => {
    if (t >= caption.start && t <= caption.end) {
      drawCaption(ctx, caption, clip.width, clip.height);
    }
  });
}

function getCameraTransform(
  zoomPoints: ZoomPoint[],
  t: number
): { scale: number; x: number; y: number } {
  // Default: no zoom, centered
  if (zoomPoints.length === 0) return { scale: 1, x: 0.5, y: 0.5 };

  // Find surrounding keyframes
  const sorted = [...zoomPoints].sort((a, b) => a.t - b.t);
  const active = sorted.filter(zp => zp.t <= t);

  if (active.length === 0) {
    // Before first keyframe — scale 1
    return { scale: 1, x: 0.5, y: 0.5 };
  }

  const current = active[active.length - 1];
  const next = sorted.find(zp => zp.t > current.t);

  if (!next) {
    // After last keyframe — hold at current target
    return current.to;
  }

  // Interpolate between current and next
  const progress = Math.min(1, (t - current.t) / current.dur);
  const eased = easeInOutCubic(progress);
  return {
    scale: lerp(current.to.scale, next.to?.scale ?? 1, eased),
    x: lerp(current.to.x, next.to?.x ?? 0.5, eased),
    y: lerp(current.to.y, next.to?.y ?? 0.5, eased),
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
```

### A4: Export pipeline (packages/engine/src/encode.ts)

```typescript
import { mux } from "mediabunny";

export async function exportProject(
  project: Project,
  opts: ExportOpts
): Promise<Blob> {
  const { clip } = project;
  const fps = 30;
  const totalFrames = Math.floor(clip.duration * fps);

  // Configure encoder
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { /* feed to muxer */ },
    error: (e) => console.error("Encoder error:", e),
  });

  encoder.configure({
    codec: "avc1.42E01E",  // H.264 baseline
    width: clip.width,
    height: clip.height,
    bitrate: 5_000_000,
    framerate: fps,
  });

  // Render + encode each frame
  const canvas = new OffscreenCanvas(clip.width, clip.height);
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    // Seek to frame
    const frame = await getFrameAt(project, t);
    if (frame) {
      ctx.drawImage(frame, 0, 0);
      // Apply camera transform + overlays using renderFrame
      renderFrame(ctx, project, t);
      const videoFrame = new VideoFrame(canvas, { timestamp: i * 1_000_000 / fps });
      encoder.encode(videoFrame, { keyFrame: i % 30 === 0 });
      videoFrame.close();
    }
  }

  await encoder.flush();

  // Audio: mix via OfflineAudioContext if audio track exists
  // Mux video + audio via mediabunny
  // Return Blob
}
```

### A5: OPFS persistence (packages/engine/src/opfs.ts)

```typescript
export async function saveProject(project: Project): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const projectDir = await root.getDirectoryHandle(project.id, { create: true });

  // Save project JSON
  const jsonFile = await projectDir.getFileHandle("project.json", { create: true });
  const jsonWritable = await jsonFile.createWritable();
  await jsonWritable.write(JSON.stringify(project));
  await jsonWritable.close();

  // Save clip blob if not already in OPFS
  if (project.clip.src.startsWith("blob:")) {
    const response = await fetch(project.clip.src);
    const blob = await response.blob();
    const clipFile = await projectDir.getFileHandle("clip.webm", { create: true });
    const clipWritable = await clipFile.createWritable();
    await clipWritable.write(blob);
    await clipWritable.close();
  }

  // Save facecam blob if present
  if (project.facecam.src?.startsWith("blob:")) {
    const response = await fetch(project.facecam.src);
    const blob = await response.blob();
    const facecamFile = await projectDir.getFileHandle("facecam.webm", { create: true });
    const facecamWritable = await facecamFile.createWritable();
    await facecamWritable.write(blob);
    await facecamWritable.close();
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const root = await navigator.storage.getDirectory();
  try {
    const projectDir = await root.getDirectoryHandle(id);
    const jsonFile = await projectDir.getFileHandle("project.json");
    const file = await jsonFile.getFile();
    const text = await file.text();
    const project = JSON.parse(text) as Project;

    // Restore blob URLs from OPFS
    const clipFile = await projectDir.getFileHandle("clip.webm");
    const clipBlob = await clipFile.getFile();
    project.clip.src = URL.createObjectURL(clipBlob);

    try {
      const facecamFile = await projectDir.getFileHandle("facecam.webm");
      const facecamBlob = await facecamFile.getFile();
      project.facecam.src = URL.createObjectURL(facecamBlob);
    } catch { /* no facecam */ }

    return project;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<{ id: string; name: string }[]> {
  const root = await navigator.storage.getDirectory();
  const projects: { id: string; name: string }[] = [];
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "directory") {
      try {
        const jsonFile = await (handle as FileSystemDirectoryHandle).getFileHandle("project.json");
        const file = await jsonFile.getFile();
        const project = JSON.parse(await file.text());
        projects.push({ id: name, name: `Clip ${project.clip.duration.toFixed(0)}s` });
      } catch { /* skip corrupt */ }
    }
  }
  return projects;
}
```

---

## Slice B: Editor + State (Person B owns)

### B1: Zustand store (apps/web/src/stores/projectStore.ts)

```typescript
import { create } from "zustand";
import type { Project, ZoomPoint, TextOverlay, Caption, Background } from "@open-demo-studio/project-schema";

type HistoryEntry = {
  zoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  captions: Caption[];
  background: Background;
};

interface ProjectStore {
  project: Project | null;
  history: HistoryEntry[];
  historyIndex: number;
  isPlaying: boolean;
  currentTime: number;

  // Project lifecycle
  setProject: (project: Project) => void;

  // Zoom
  addZoomPoint: (zp: Omit<ZoomPoint, "id" | "staged">) => void;
  removeZoomPoint: (id: string) => void;
  updateZoomPoint: (id: string, updates: Partial<ZoomPoint>) => void;
  stageZoomProposals: (proposals: ZoomPoint[]) => void;

  // Text
  addTextOverlay: (overlay: Omit<TextOverlay, "id" | "staged">) => void;
  removeTextOverlay: (id: string) => void;
  stageTextOverlay: (overlay: TextOverlay) => void;

  // Captions
  setCaptions: (captions: Caption[]) => void;
  stageCaptions: (captions: Caption[]) => void;

  // Background
  setBackground: (bg: Background) => void;
  stageBackground: (bg: Background) => void;

  // Staging
  getStagedDiff: () => { added: string[]; removed: string[]; totalCount: number };
  commitAll: () => void;
  clearStaged: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;

  // Playback
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setCurrentTime: (t: number) => void;
}

function snapshot(state: ProjectStore): HistoryEntry {
  if (!state.project) return { zoomPoints: [], textOverlays: [], captions: [], background: { kind: "solid", color: "#000" } };
  return {
    zoomPoints: [...state.project.zoomPoints],
    textOverlays: [...state.project.textOverlays],
    captions: [...state.project.captions],
    background: { ...state.project.background },
  };
}

function restore(project: Project, snapshot: HistoryEntry): Project {
  return {
    ...project,
    zoomPoints: snapshot.zoomPoints,
    textOverlays: snapshot.textOverlays,
    captions: snapshot.captions,
    background: snapshot.background,
  };
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  history: [],
  historyIndex: -1,
  isPlaying: false,
  currentTime: 0,

  setProject: (project) => {
    const snap = {
      zoomPoints: [...project.zoomPoints],
      textOverlays: [...project.textOverlays],
      captions: [...project.captions],
      background: { ...project.background },
    };
    set({ project, history: [snap], historyIndex: 0, currentTime: 0 });
  },

  addZoomPoint: (zp) => {
    const state = get();
    if (!state.project) return;
    const newZP: ZoomPoint = { ...zp, id: crypto.randomUUID(), staged: false };
    const project = {
      ...state.project,
      zoomPoints: [...state.project.zoomPoints, newZP],
    };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  removeZoomPoint: (id) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      zoomPoints: state.project.zoomPoints.filter(zp => zp.id !== id),
    };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  updateZoomPoint: (id, updates) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      zoomPoints: state.project.zoomPoints.map(zp =>
        zp.id === id ? { ...zp, ...updates } : zp
      ),
    };
    set({ project });
  },

  stageZoomProposals: (proposals) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedZoomPoints: [...state.project.stagedZoomPoints, ...proposals],
      },
    });
  },

  addTextOverlay: (overlay) => {
    const state = get();
    if (!state.project) return;
    const newOverlay: TextOverlay = { ...overlay, id: crypto.randomUUID(), staged: false };
    const project = {
      ...state.project,
      textOverlays: [...state.project.textOverlays, newOverlay],
    };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  removeTextOverlay: (id) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      textOverlays: state.project.textOverlays.filter(t => t.id !== id),
    };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  stageTextOverlay: (overlay) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedTextOverlays: [...state.project.stagedTextOverlays, overlay],
      },
    });
  },

  setCaptions: (captions) => {
    const state = get();
    if (!state.project) return;
    const project = { ...state.project, captions };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  stageCaptions: (captions) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedCaptions: captions,
      },
    });
  },

  setBackground: (bg) => {
    const state = get();
    if (!state.project) return;
    const project = { ...state.project, background: bg };
    const snap = snapshot(get());
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  stageBackground: (bg) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        background: bg,  // staged background replaces live — simple for hackathon
      },
    });
  },

  getStagedDiff: () => {
    const state = get();
    if (!state.project) return { added: [], removed: [], totalCount: 0 };
    const p = state.project;
    return {
      added: [
        ...p.stagedZoomPoints.map(zp => `Zoom at ${zp.t.toFixed(1)}s`),
        ...p.stagedTextOverlays.map(t => `"${t.text}" at ${t.timestamp.toFixed(1)}s`),
        ...(p.stagedCaptions.length ? [`${p.stagedCaptions.length} captions`] : []),
      ],
      removed: [],
      totalCount: p.stagedZoomPoints.length + p.stagedTextOverlays.length + p.stagedCaptions.length,
    };
  },

  commitAll: () => {
    const state = get();
    if (!state.project) return;
    const p = state.project;
    const project = {
      ...p,
      zoomPoints: [...p.zoomPoints, ...p.stagedZoomPoints.map(zp => ({ ...zp, staged: false }))],
      stagedZoomPoints: [],
      textOverlays: [...p.textOverlays, ...p.stagedTextOverlays.map(t => ({ ...t, staged: false }))],
      stagedTextOverlays: [],
      captions: [...p.captions, ...p.stagedCaptions],
      stagedCaptions: [],
    };
    const snap = {
      zoomPoints: [...project.zoomPoints],
      textOverlays: [...project.textOverlays],
      captions: [...project.captions],
      background: { ...project.background },
    };
    const history = [...get().history.slice(0, get().historyIndex + 1), snap];
    set({ project, history, historyIndex: history.length - 1 });
  },

  clearStaged: () => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedZoomPoints: [],
        stagedTextOverlays: [],
        stagedCaptions: [],
      },
    });
  },

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0 || !state.project) return;
    const newIndex = state.historyIndex - 1;
    const snap = state.history[newIndex];
    set({
      project: restore(state.project, snap),
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const state = get();
    if (state.historyIndex >= state.history.length - 1 || !state.project) return;
    const newIndex = state.historyIndex + 1;
    const snap = state.history[newIndex];
    set({
      project: restore(state.project, snap),
      historyIndex: newIndex,
    });
  },

  play: () => set({ isPlaying: true }),
  pause: () => set({ isPlaying: false }),
  seek: (t) => set({ currentTime: t, isPlaying: false }),
  setCurrentTime: (t) => set({ currentTime: t }),
}));
```

### B2: Whisper captions worker (apps/web/src/workers/whisperWorker.ts)

```typescript
// Lazy-loaded only when "Generate captions" is clicked
let whisper: any = null;

async function loadWhisper() {
  if (whisper) return whisper;
  const module = await import("@xenova/transformers");
  const { pipeline } = module;
  whisper = await pipeline("automatic-speech-recognition", "Xenova/whisper-base", {
    progress_callback: (p: any) => {
      if (p.status === "progress") {
        postMessage({ type: "progress", progress: p.progress });
      }
    },
  });
  return whisper;
}

self.onmessage = async (e: MessageEvent<{ type: string; audioUrl: string }>) => {
  if (e.data.type === "transcribe") {
    const whisper = await loadWhisper();
    const result = await whisper(e.data.audioUrl, {
      return_timestamps: "word",
      chunk_length_s: 30,
    });

    const captions = result.chunks.map((chunk: any) => ({
      text: chunk.text.trim(),
      start: chunk.timestamp[0],
      end: chunk.timestamp[1],
    }));

    postMessage({ type: "result", captions });
  }
};
```

### B3: Zoom interaction logic (apps/web/src/components/PreviewCanvas.tsx — LLM-generated, logic by Person B)

```typescript
// Key interaction logic — Person B writes this, LLM generates the styling

function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
  if (isPlaying) return; // don't add points during playback

  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;   // normalize 0-1
  const y = (e.clientY - rect.top) / rect.height;

  // Check if clicking near existing zoom-out point
  const nearby = project.zoomPoints.find(zp =>
    Math.abs(zp.t - currentTime) < 0.5 &&
    Math.abs(zp.to.x - x) < 0.1 &&
    Math.abs(zp.to.y - y) < 0.1
  );

  if (nearby) {
    // Zoom out back to 1x
    addZoomPoint({
      t: currentTime,
      to: { scale: 1, x: 0.5, y: 0.5 },
      dur: 0.6,
      ease: "easeInOutCubic",
    });
  } else {
    // Zoom in to clicked point
    addZoomPoint({
      t: currentTime,
      to: { scale: 2.2, x, y },
      dur: 0.7,
      ease: "easeInOutCubic",
    });
  }
}
```

---

## Phase 2: WebMCP tools (apps/web/src/webmcp/tools.ts)

Both people register their tools here. Different `registerTool` calls — no merge conflict.

```typescript
// apps/web/src/webmcp/tools.ts

import { useProjectStore } from "../stores/projectStore";
import { engine } from "@open-demo-studio/engine";
import { whisperWorker } from "../workers/whisperWorker";

// Helper: in-execute() confirmation dialog
async function showConfirmDialog(opts: { diff?: any; message: string }): Promise<boolean> {
  // Renders a modal via React portal, returns a promise that resolves on click
  return new Promise((resolve) => {
    const event = new CustomEvent("webmcp-confirm", {
      detail: { ...opts, onConfirm: (result: boolean) => resolve(result) },
    });
    window.dispatchEvent(event);
  });
}

export function registerAllTools() {
  // ═══════════════════════════════════════════════
  // Person A's tools — wrapping engine functions
  // ═══════════════════════════════════════════════

  // READ-ONLY
  document.modelContext.registerTool({
    name: "get_project_state",
    description: "Returns the full project state: clip metadata, committed zoom points, text overlays, captions, background, facecam, aspect preset, and click log. Use this to understand what's already in the project before proposing changes.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded. Import a clip first." };
      return {
        clipDuration: project.clip.duration,
        clipDimensions: `${project.clip.width}x${project.clip.height}`,
        zoomPointCount: project.zoomPoints.length,
        zoomPoints: project.zoomPoints.map(zp => ({ t: zp.t, scale: zp.to.scale, focal: `(${zp.to.x.toFixed(2)}, ${zp.to.y.toFixed(2)})` })),
        textOverlays: project.textOverlays,
        captionCount: project.captions.length,
        background: project.background,
        facecamPresent: !!project.facecam.src,
        aspectPreset: project.aspectPreset,
        clickLog: project.clickLog,
      };
    },
  });

  document.modelContext.registerTool({
    name: "list_scenes",
    description: "Returns all scenes with in/out points. A scene is a continuous segment of the clip. Most projects have one scene; multi-scene is post-hackathon.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded" };
      return {
        scenes: [{ id: "scene-1", in: 0, out: project.clip.duration, duration: project.clip.duration }],
      };
    },
  });

  document.modelContext.registerTool({
    name: "get_click_log",
    description: "Returns mouse-click timestamps from the recording session. Use this to identify moments where the user interacted with the UI — good candidates for zoom points. Empty if the clip was imported without a click log.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded" };
      return { clicks: project.clickLog };
    },
  });

  // WRITE — gated by confirmation
  document.modelContext.registerTool({
    name: "export_clip",
    description: "Exports the project as a video file. Renders locally via WebCodecs — no upload, no server. Returns a download URL when complete. Always ask the user to confirm the format and resolution before exporting.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["mp4", "webm"], description: "Output format. MP4 (H.264) is most compatible. WebM (VP9) is smaller." },
        resolution: { type: "string", enum: ["720p", "1080p"], description: "Output resolution. 1080p is standard. 720p is faster." },
        burnCaptions: { type: "boolean", description: "If true, captions are burned into the video. If false, an SRT sidecar is included." },
      },
      required: ["format", "resolution"],
    },
    execute: async ({ format, resolution, burnCaptions }) => {
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded" };

      const confirmed = await showConfirmDialog({
        message: `Export ${format.toUpperCase()} at ${resolution}${burnCaptions ? " with burned captions" : ""}? This will take a few seconds.`,
      });
      if (!confirmed) return { exported: false, reason: "user_declined" };

      try {
        const blob = await engine.exportProject(project, { format, resolution, burnCaptions });
        const url = URL.createObjectURL(blob);
        return { exported: true, downloadUrl: url, fileSizeMB: (blob.size / 1048576).toFixed(1) };
      } catch (err) {
        return { exported: false, error: String(err) };
      }
    },
  });

  // ═══════════════════════════════════════════════
  // Person B's tools — wrapping editor state
  // ═══════════════════════════════════════════════

  // STAGING — visible change, marks state as pending
  document.modelContext.registerTool({
    name: "propose_zoom_points",
    description: "Proposes zoom-in keyframes at specific timestamps. The agent should watch the preview to identify moments of interest: UI clicks, text reveals, scene changes, or important visual content. Stages proposals as ghost diamonds on the timeline — does NOT commit. The human reviews and commits separately. Default zoom depth is 2.2x, duration 0.7s, easeInOutCubic.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number", description: "Timestamp in seconds" },
          description: "Array of timestamps (in seconds) where zoom-in keyframes should be placed. Use get_click_log to find good candidates, or watch the preview to identify moments of interest.",
        },
        scale: { type: "number", description: "Zoom depth. Default 2.2. Range 1.2-5.0.", minimum: 1.2, maximum: 5.0 },
      },
      required: ["timestamps"],
    },
    execute: async ({ timestamps, scale }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded" };

      const proposals = timestamps.map(t => ({
        id: crypto.randomUUID(),
        t,
        to: { scale: scale ?? 2.2, x: 0.5, y: 0.5 },
        dur: 0.7,
        ease: "easeInOutCubic",
        staged: true,
      }));

      store.stageZoomProposals(proposals);
      return {
        stagedCount: proposals.length,
        proposals: proposals.map(p => ({ t: p.t, scale: p.to.scale })),
        message: `${proposals.length} zoom points staged. Call commit_staged_changes to apply them, or let the user review on the timeline.`,
      };
    },
  });

  document.modelContext.registerTool({
    name: "add_text_overlay",
    description: "Stages a text overlay at a specific timestamp and screen position. Does not commit — appears as pending in the inspector. Useful for labeling UI elements, adding annotations, or watermarking.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text content to display" },
        timestamp: { type: "number", description: "When the text should appear, in seconds" },
        position: { type: "string", enum: ["top", "bottom", "center"], description: "Vertical position on screen" },
      },
      required: ["text", "timestamp"],
    },
    execute: async ({ text, timestamp, position }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded" };

      store.stageTextOverlay({
        id: crypto.randomUUID(),
        text,
        timestamp,
        position: position ?? "bottom",
        staged: true,
      });
      return { staged: true, message: `Text overlay "${text}" staged at ${timestamp}s. Call commit_staged_changes to apply.` };
    },
  });

  document.modelContext.registerTool({
    name: "set_background",
    description: "Stages a background change. Accepts a solid color or a 2-stop gradient. The background fills the padding area around the video when the aspect ratio doesn't match the canvas. Does not commit.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["solid", "gradient"], description: "Solid = one color. Gradient = two-color linear gradient." },
        color: { type: "string", description: "Hex color for solid background, e.g. '#1a1a2e'" },
        stops: { type: "array", items: { type: "string" }, description: "Two hex colors for gradient, e.g. ['#6366f1', '#a855f7']" },
      },
      required: ["kind"],
    },
    execute: async ({ kind, color, stops }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded" };

      const bg = kind === "solid" ? { kind, color } : { kind, stops };
      store.stageBackground(bg as Background);
      return { staged: true, message: `${kind} background staged. Call commit_staged_changes to apply.` };
    },
  });

  document.modelContext.registerTool({
    name: "generate_captions",
    description: "Runs local Whisper transcription on the audio track. Generates word-level captions with timestamps. Stages them — does not commit. May take 10-30 seconds depending on clip length. The transcription runs entirely in the browser via WebAssembly — no audio leaves the device.",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string", description: "Language code (e.g. 'en', 'es'). Default auto-detect." },
      },
    },
    execute: async ({ language }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded" };

      // Post message to whisper worker
      const captions = await new Promise<Caption[]>((resolve, reject) => {
        const worker = new Worker(new URL("../workers/whisperWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e) => {
          if (e.data.type === "result") {
            resolve(e.data.captions);
            worker.terminate();
          }
          if (e.data.type === "error") {
            reject(new Error(e.data.error));
            worker.terminate();
          }
        };
        worker.postMessage({ type: "transcribe", audioUrl: store.project!.clip.src, language });
      });

      store.stageCaptions(captions);
      return {
        stagedCount: captions.length,
        preview: captions.slice(0, 5).map(c => `${c.start.toFixed(1)}s: "${c.text}"`),
        message: `${captions.length} captions staged. Call commit_staged_changes to burn them in.`,
      };
    },
  });

  // WRITE — gated by confirmation
  document.modelContext.registerTool({
    name: "commit_staged_changes",
    description: "Commits ALL staged items (zoom points, text overlays, backgrounds, captions) to the project. REQUIRES human confirmation — shows the full staged diff and asks Yes/No before writing. This is the only way staged changes become permanent.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded" };

      const diff = store.getStagedDiff();
      if (diff.totalCount === 0) return { committed: false, reason: "nothing_staged" };

      const confirmed = await showConfirmDialog({
        diff,
        message: `Commit ${diff.totalCount} staged change(s)?\n\n${diff.added.join("\n")}`,
      });
      if (!confirmed) return { committed: false, reason: "user_declined" };

      store.commitAll();
      return {
        committed: true,
        itemsCommitted: diff.totalCount,
        message: "All staged changes committed. The project is updated.",
      };
    },
  });
}
```

### Declarative form (in the editor component)

```html
<!-- Export settings form — agent fills, human clicks to confirm -->
<form tool-name="export_settings" tool-description="Export settings form. The agent fills the format and resolution. The human clicks the submit button to confirm and download. Does not auto-submit." action="/api/export-handler" method="POST">
  <select name="format" tool-name="format" tool-description="Output video format: mp4 for compatibility, webm for smaller size">
    <option value="mp4">MP4 (H.264)</option>
    <option value="webm">WebM (VP9)</option>
  </select>
  <select name="resolution" tool-name="resolution" tool-description="Output resolution: 1080p for standard, 720p for faster export">
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

---

## Tool-trace panel (apps/web/src/components/ToolTrace.tsx — LLM-generated)

```typescript
// Visible log of agent tool calls — judges need to SEE the WebMCP leverage
// This component listens for tool execution events and displays them

import { useEffect, useState } from "react";

type TraceEntry = {
  timestamp: number;
  toolName: string;
  input: any;
  output: any;
  durationMs: number;
};

export function ToolTrace() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);

  useEffect(() => {
    // Hook into document.modelContext to log calls
    // Or listen for a custom event dispatched by each tool's execute()
    const handler = (e: CustomEvent<TraceEntry>) => {
      setEntries(prev => [...prev.slice(-9), e.detail]); // keep last 10
    };
    window.addEventListener("webmcp-tool-call", handler as EventListener);
    return () => window.removeEventListener("webmcp-tool-call", handler as EventListener);
  }, []);

  return (
    <div className="border-l border-gray-700 p-4 h-full overflow-y-auto bg-gray-900">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Agent Tool Trace</h3>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-500">No agent calls yet. Open in ChatGPT browser and ask the agent to edit your project.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <div key={i} className="bg-gray-800 rounded p-2 text-xs">
              <div className="flex justify-between mb-1">
                <span className="font-mono text-green-400">{entry.toolName}</span>
                <span className="text-gray-500">{entry.durationMs}ms</span>
              </div>
              <pre className="text-gray-400 text-[10px] overflow-x-auto">
                {JSON.stringify(entry.output, null, 2).slice(0, 200)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## Confirmation dialog component (apps/web/src/components/ConfirmDialog.tsx)

```typescript
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmRequest = {
  message: string;
  diff?: { added: string[]; removed: string[]; totalCount: number };
  onConfirm: (result: boolean) => void;
};

export function ConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    const handler = (e: CustomEvent<ConfirmRequest>) => {
      setRequest(e.detail);
    };
    window.addEventListener("webmcp-confirm", handler as EventListener);
    return () => window.removeEventListener("webmcp-confirm", handler as EventListener);
  }, []);

  if (!request) return null;

  return createPortal(
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold text-white mb-3">Confirm Action</h3>
        <p className="text-gray-300 mb-4">{request.message}</p>

        {request.diff && request.diff.totalCount > 0 && (
          <div className="bg-gray-800 rounded p-3 mb-4 max-h-48 overflow-y-auto">
            <p className="text-xs text-gray-500 mb-2">Staged changes ({request.diff.totalCount}):</p>
            <ul className="space-y-1">
              {request.diff.added.map((item, i) => (
                <li key={i} className="text-xs text-green-400 font-mono">+ {item}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => { request.onConfirm(false); setRequest(null); }}
            className="px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 rounded"
          >
            Cancel
          </button>
          <button
            onClick={() => { request.onConfirm(true); setRequest(null); }}
            className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
```

---

## App initialization (apps/web/src/app/editor/page.tsx)

```typescript
"use client";

import { useEffect, useRef } from "react";
import { useProjectStore } from "../../stores/projectStore";
import { engine } from "@open-demo-studio/engine";
import { registerAllTools } from "../../webmcp/tools";
import { PreviewCanvas } from "../../components/PreviewCanvas";
import { Timeline } from "../../components/Timeline";
import { Inspector } from "../../components/Inspector";
import { Toolbar } from "../../components/Toolbar";
import { ToolTrace } from "../../components/ToolTrace";
import { ConfirmDialog } from "../../components/ConfirmDialog";

export default function EditorPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { project, setProject, isPlaying, currentTime, setCurrentTime } = useProjectStore();
  const rafRef = useRef<number>(0);

  // Register WebMCP tools on mount
  useEffect(() => {
    registerAllTools();
    return () => {
      // AbortController cleanup would go here
      // const controller = new AbortController();
      // controller.abort();
    };
  }, []);

  // Render loop
  useEffect(() => {
    if (!project || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d")!;

    let lastTime = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      if (isPlaying) {
        const newTime = currentTime + dt;
        if (newTime >= project.clip.duration) {
          useProjectStore.getState().pause();
        } else {
          setCurrentTime(newTime);
        }
      }

      engine.renderFrame(ctx, project, currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [project, isPlaying, currentTime, setCurrentTime]);

  // File drop handler
  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      const project = await engine.loadClip(file);
      setProject(project);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      <Toolbar />
      <div className="flex-1 flex">
        <div className="flex-1 flex flex-col">
          <div
            className="flex-1 flex items-center justify-center"
            onDrop={handleFileDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            {project ? (
              <canvas
                ref={canvasRef}
                width={project.clip.width}
                height={project.clip.height}
                className="max-w-full max-h-full"
              />
            ) : (
              <div className="text-gray-500">Drop a video file here</div>
            )}
          </div>
          <Timeline />
        </div>
        <div className="w-80 border-l border-gray-800">
          <Inspector />
        </div>
        <div className="w-72 border-l border-gray-800">
          <ToolTrace />
        </div>
      </div>
      <ConfirmDialog />
    </div>
  );
}
```

---

## Tool registration lifecycle (AbortController)

```typescript
// apps/web/src/webmcp/lifecycle.ts

const toolControllers: AbortController[] = [];

export function registerToolWithLifecycle(
  config: Parameters<Document["modelContext"]["registerTool"]>[0]
) {
  const controller = new AbortController();
  toolControllers.push(controller);

  document.modelContext.registerTool({
    ...config,
    signal: controller.signal,
  });

  return controller;
}

export function unregisterAllTools() {
  toolControllers.forEach(c => c.abort());
  toolControllers.length = 0;
}

// Usage in tools.ts:
// Replace document.modelContext.registerTool({...}) with registerToolWithLifecycle({...})
```

---

## Deployment

```yaml
# vercel.json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "apps/web/out",
  "framework": "nextjs"
}
```

```dockerfile
# Cloudflare Pages alternative (optional dual-deploy)
# Build command: pnpm build
# Output directory: apps/web/out
```

---

## Testing checklist

### Phase 1 (Day 4 — Poindeo competitor done)
- [ ] Drop a video file → it renders on canvas
- [ ] Click on preview (paused) → zoom-in keyframe added
- [ ] Second click near existing → zoom-out
- [ ] Drag focal dot → x/y updates live
- [ ] Inspector: change depth/duration/easing → preview updates
- [ ] Timeline: drag diamond → moves timestamp
- [ ] Background: set solid color → padding area changes
- [ ] Background: set gradient → gradient renders
- [ ] Text overlay: add text at timestamp → renders on preview
- [ ] Captions: click "Generate" → Whisper runs → captions appear
- [ ] Undo (Cmd+Z) → last action reverted
- [ ] Redo (Cmd+Shift+Z) → action re-applied
- [ ] Save project → reload page → load project → state restored
- [ ] Export MP4 → downloads → plays with zooms + captions + text + background
- [ ] Recording: start → screen + facecam + mic → stop → loads as project
- [ ] Facecam PiP renders on canvas

### Phase 2 (Day 5 — WebMCP added)
- [ ] Open in Chrome with `chrome://flags/#enable-webmcp-testing`
- [ ] Open in ChatGPT in-app browser
- [ ] Agent discovers 9 tools via `getTools()`
- [ ] Agent calls `get_project_state` → returns project JSON
- [ ] Agent calls `propose_zoom_points({timestamps:[3, 8, 12]})` → ghost diamonds appear
- [ ] Agent calls `add_text_overlay({text:"Sign in", timestamp:3})` → staged
- [ ] Agent calls `set_background({kind:"gradient", stops:["#6366f1","#a855f7"]})` → staged
- [ ] Agent calls `generate_captions()` → Whisper runs → captions staged
- [ ] Agent calls `commit_staged_changes()` → confirmation dialog → human clicks Yes → all staged items commit
- [ ] Agent calls `export_clip({format:"mp4", resolution:"1080p"})` → confirmation → MP4 downloads
- [ ] Tool-trace panel shows all calls with return values
- [ ] AbortController: navigate away from editor → tools unregister (no leaked registrations)

### Submission (Day 7)
- [ ] Live URL works in ChatGPT in-app browser (not just localhost)
- [ ] Public GitHub repo with MIT (engine) + AGPL-3.0 (app) license files
- [ ] `document.modelContext.registerTool` calls visible in repo
- [ ] <3 min YouTube demo video, public
- [ ] Devpost text description covers: why WebMCP fits, how it improves UX, what's possible together that wasn't before, implementation explanation
- [ ] Deployed on Vercel (HTTPS required for SecureContext)

---

## Dependencies

```json
{
  "dependencies": {
    "next": "15.x",
    "react": "19.x",
    "react-dom": "19.x",
    "zustand": "5.x",
    "mediabunny": "latest",
    "gifenc": "latest",
    "@xenova/transformers": "latest",
    "zod": "3.x",
    "nanoid": "5.x",
    "tailwindcss": "4.x"
  },
  "devDependencies": {
    "typescript": "5.x",
    "@types/react": "19.x",
    "size-limit": "latest",
    "vitest": "latest"
  }
}
```

## API corrections (from fact-check)

- Use `document.modelContext.registerTool(...)` — NOT `navigator.modelContext`
- Declarative attributes are hyphenated: `tool-name`, `tool-description` — NOT `toolname`/`tooldescription`
- Do NOT use `requestUserInteraction()` — it doesn't exist. Implement confirmation inside `execute()` via a custom event + React portal dialog
- Set `annotations: { readOnlyHint: true }` on all read-only tools
- Do NOT use `toolautosubmit` attribute — unverified; omit it
- Test in both ChatGPT in-app browser (native WebMCP support) and Chrome with `chrome://flags/#enable-webmcp-testing`
- HTTPS is required (SecureContext) — deploy on Vercel or Cloudflare Pages

---

This spec is the complete, copy-pasteable blueprint. Hand it to a coding agent (Claude, Cursor, Copilot) or a human developer. The two people work on their slices in parallel against the locked types, integrate on Day 3 afternoon, add WebMCP on Day 5, and ship by Day 7.