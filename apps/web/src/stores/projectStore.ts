/**
 * OWNER: DEV B — full staged-diff state model per ROADMAP-B.md Task 1.2.
 * Staged* arrays are first-class in Project — ghosts are data, not UI state.
 * The only write path is commitAll(), gated by human confirmation.
 */
"use client";

import { create } from "zustand";
import type {
  Project,
  ZoomPoint,
  TextOverlay,
  Caption,
  Background,
  ClickEvent,
  AspectPreset,
  Facecam,
} from "@panoptik/schema";

type HistoryEntry = {
  zoomPoints: ZoomPoint[];
  textOverlays: TextOverlay[];
  captions: Caption[];
  background: Background;
};

/** Within this of the duration counts as "at the end" — the playhead lands on
 *  exactly duration, but float drift and frame steps can leave it just short. */
const END_EPSILON = 0.05;

/**
 * Playback parks the playhead at the end of the clip. Pressing play there would
 * otherwise finish instantly, so start over instead.
 */
function rewindIfEnded(s: { project: Project | null; currentTime: number }) {
  const duration = s.project?.clip.duration ?? 0;
  return duration > 0 && s.currentTime >= duration - END_EPSILON ? { currentTime: 0 } : {};
}

function snapshot(project: Project): HistoryEntry {
  return {
    zoomPoints: project.zoomPoints.map((z) => ({ ...z })),
    textOverlays: project.textOverlays.map((t) => ({ ...t })),
    captions: project.captions.map((c) => ({ ...c })),
    background: structuredClone(project.background),
  };
}

function restoreFromSnapshot(
  project: Project,
  snap: HistoryEntry,
): Project {
  return {
    ...project,
    zoomPoints: snap.zoomPoints,
    textOverlays: snap.textOverlays,
    captions: snap.captions,
    background: snap.background,
  };
}

interface ProjectStore {
  project: Project | null;
  history: HistoryEntry[];
  historyIndex: number;
  isPlaying: boolean;
  currentTime: number;
  selectedZoomId: string | null;
  pendingBackgroundBadge: boolean;
  whisperProgress: number | null; // null = idle, -1 = transcribing, 0-100 = model loading
  /** 0..1 while an export runs, null when idle. Non-null locks the editor. */
  exportProgress: number | null;
  /** Where the on-device save/restore has got to. */
  persistStatus: "idle" | "saving" | "saved" | "restoring";
  stagePadding: number; // p-4 = 16, p-2 = 8, p-8 = 32 etc — white space around black video container
  playbackRate: number; // 0.25–3, affects preview & export, cam+screen synced

  // Project lifecycle
  setProject: (project: Project) => void;
  /** Drop the loaded video and every edit made on it. */
  clearProject: () => void;
  setPersistStatus: (s: "idle" | "saving" | "saved" | "restoring") => void;

  // Playback
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  seek: (t: number) => void;
  setCurrentTime: (t: number) => void;

  // Zoom — committed
  addZoomPoint: (zp: Omit<ZoomPoint, "id" | "staged">) => void;
  removeZoomPoint: (id: string) => void;
  updateZoomPoint: (id: string, updates: Partial<ZoomPoint>) => void;
  setSelectedZoom: (id: string | null) => void;
  commitDrag: () => void;

  // Zoom — staging
  stageZoomProposals: (proposals: ZoomPoint[]) => void;
  removeStagedZoom: (id: string) => void;

  // Text — committed
  addTextOverlay: (overlay: Omit<TextOverlay, "id" | "staged">) => void;
  removeTextOverlay: (id: string) => void;
  updateTextOverlay: (
    id: string,
    updates: Partial<TextOverlay>,
  ) => void;

  // Text — staging
  stageTextOverlay: (overlay: TextOverlay) => void;
  removeStagedTextOverlay: (id: string) => void;

  // Captions — committed
  setCaptions: (captions: Caption[]) => void;

  // Captions — staging
  stageCaptions: (captions: Caption[]) => void;
  clearStagedCaptions: () => void;

  // Background
  setBackground: (bg: Background) => void;
  stageBackground: (bg: Background) => void;

  // Staging diff
  getStagedDiff: () => {
    added: string[];
    removed: string[];
    totalCount: number;
  };
  commitAll: () => void;
  clearStaged: () => void;

  // Undo / redo
  undo: () => void;
  redo: () => void;

  // Moment marks (M key during playback → click log)
  markMoment: (t: number) => void;

  // Whisper progress (for agent-triggered runs)
  setWhisperProgress: (p: number | null) => void;

  // Export lock — an export re-renders every frame off the shared decoder, so
  // seeking or editing mid-run would corrupt the output.
  beginExport: () => void;
  setExportProgress: (p: number) => void;
  endExport: () => void;

  // Stage UI
  setStagePadding: (n: number) => void;
  setAspectPreset: (preset: AspectPreset) => void;

  // Facecam PiP placement (position / size / shape in the composed frame)
  setFacecam: (updates: Partial<Facecam>) => void;

  // Playback speed — global, affects cam+screen together, preview & export
  setPlaybackRate: (n: number) => void;
}

function clampRate(n: number): number {
  return Math.min(3, Math.max(0.25, Math.round(n * 20) / 20));
}
function getLS(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
    if (typeof window !== "undefined" && (window as unknown as { localStorage?: Storage }).localStorage) return (window as unknown as { localStorage: Storage }).localStorage;
    const g = globalThis as unknown as { localStorage?: Storage };
    if (g.localStorage) return g.localStorage;
  } catch { /* no storage */ }
  return null;
}
function initialRate(): number {
  try {
    const ls = getLS();
    const v = Number(ls?.getItem("panoptik:playbackRate"));
    if (Number.isFinite(v) && v >= 0.25 && v <= 3) return clampRate(v);
  } catch { /* no localStorage */ }
  return 1;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  history: [],
  historyIndex: -1,
  isPlaying: false,
  currentTime: 0,
  selectedZoomId: null,
  pendingBackgroundBadge: false,
  whisperProgress: null,
  exportProgress: null,
  persistStatus: "idle",
  stagePadding: 0,
  playbackRate: initialRate(),

  // ── Project lifecycle ──

  setProject: (project) => {
    const snap = snapshot(project);
    set({
      project,
      history: [snap],
      historyIndex: 0,
      currentTime: 0,
      isPlaying: false,
      selectedZoomId: null,
      pendingBackgroundBadge: false,
      playbackRate: 1,
    });
    try { getLS()?.setItem("panoptik:playbackRate", "1"); } catch { /* ignore */ }
  },

  setPersistStatus: (persistStatus) => set({ persistStatus }),

  clearProject: () =>
    set({
      project: null,
      history: [],
      historyIndex: -1,
      currentTime: 0,
      isPlaying: false,
      selectedZoomId: null,
      pendingBackgroundBadge: false,
      exportProgress: null,
      playbackRate: 1,
    }),

  // ── Playback ──

  // Transport is inert while exporting. The overlay blocks the pointer, but
  // shortcuts and programmatic callers reach these directly, and moving the
  // playhead mid-export would hand the encoder the wrong frames.
  play: () => set((s) => (s.exportProgress !== null ? {} : { isPlaying: true, ...rewindIfEnded(s) })),
  pause: () => set({ isPlaying: false }),
  togglePlay: () =>
    set((s) =>
      s.exportProgress !== null
        ? {}
        : s.isPlaying
          ? { isPlaying: false }
          : { isPlaying: true, ...rewindIfEnded(s) },
    ),
  seek: (t) => set((s) => (s.exportProgress !== null ? {} : { currentTime: t, isPlaying: false })),
  setCurrentTime: (t) => set({ currentTime: t }),

  // ── Zoom — committed ──

  addZoomPoint: (zp) => {
    const state = get();
    if (!state.project) return;
    const newZP: ZoomPoint = {
      ...zp,
      id: crypto.randomUUID(),
      staged: false,
    };
    const project = {
      ...state.project,
      zoomPoints: [...state.project.zoomPoints, newZP],
    };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({
      project,
      history,
      historyIndex: history.length - 1,
      // Select it so the inspector opens on what was just created.
      selectedZoomId: newZP.id,
    });
  },

  removeZoomPoint: (id) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      zoomPoints: state.project.zoomPoints.filter((z) => z.id !== id),
    };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({
      project,
      history,
      historyIndex: history.length - 1,
      selectedZoomId:
        state.selectedZoomId === id ? null : state.selectedZoomId,
    });
  },

  updateZoomPoint: (id, updates) => {
    const state = get();
    if (!state.project) return;
    const inCommitted = state.project.zoomPoints.some((z) => z.id === id);
    const project = {
      ...state.project,
      zoomPoints: inCommitted
        ? state.project.zoomPoints.map((z) =>
            z.id === id ? { ...z, ...updates } : z,
          )
        : state.project.zoomPoints,
      stagedZoomPoints: !inCommitted
        ? state.project.stagedZoomPoints.map((z) =>
            z.id === id ? { ...z, ...updates } : z,
          )
        : state.project.stagedZoomPoints,
    };
    set({ project });
  },

  commitDrag: () => {
    const state = get();
    if (!state.project) return;
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snapshot(state.project),
    ];
    set({
      history,
      historyIndex: history.length - 1,
    });
  },

  setSelectedZoom: (id) => set({ selectedZoomId: id }),

  // ── Zoom — staging ──

  stageZoomProposals: (proposals) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedZoomPoints: [
          ...state.project.stagedZoomPoints,
          ...proposals,
        ],
      },
    });
  },

  removeStagedZoom: (id) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedZoomPoints:
          state.project.stagedZoomPoints.filter((z) => z.id !== id),
      },
    });
  },

  // ── Text — committed ──

  addTextOverlay: (overlay) => {
    const state = get();
    if (!state.project) return;
    const newOverlay: TextOverlay = {
      ...overlay,
      id: crypto.randomUUID(),
      staged: false,
    };
    const project = {
      ...state.project,
      textOverlays: [...state.project.textOverlays, newOverlay],
    };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({ project, history, historyIndex: history.length - 1 });
  },

  removeTextOverlay: (id) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      textOverlays: state.project.textOverlays.filter(
        (t) => t.id !== id,
      ),
    };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({ project, history, historyIndex: history.length - 1 });
  },

  updateTextOverlay: (id, updates) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      textOverlays: state.project.textOverlays.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    };
    set({ project });
  },

  // ── Text — staging ──

  stageTextOverlay: (overlay) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedTextOverlays: [
          ...state.project.stagedTextOverlays,
          overlay,
        ],
      },
    });
  },

  removeStagedTextOverlay: (id) => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedTextOverlays:
          state.project.stagedTextOverlays.filter(
            (t) => t.id !== id,
          ),
      },
    });
  },

  // ── Captions — committed ──

  setCaptions: (captions) => {
    const state = get();
    if (!state.project) return;
    const project = { ...state.project, captions };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({ project, history, historyIndex: history.length - 1 });
  },

  // ── Captions — staging ──

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

  clearStagedCaptions: () => {
    const state = get();
    if (!state.project) return;
    set({
      project: {
        ...state.project,
        stagedCaptions: [],
      },
    });
  },

  // ── Background ──

  setBackground: (bg) => {
    const state = get();
    if (!state.project) return;
    const project = { ...state.project, background: bg };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({
      project,
      history,
      historyIndex: history.length - 1,
      pendingBackgroundBadge: false,
    });
  },

  stageBackground: (bg) => {
    const state = get();
    if (!state.project) return;
    // Staged background applies immediately to visual + sets badge
    set({
      project: {
        ...state.project,
        background: bg,
      },
      pendingBackgroundBadge: true,
    });
  },

  // ── Staging diff ──

  getStagedDiff: () => {
    const state = get();
    if (!state.project)
      return { added: [], removed: [], totalCount: 0 };
    const p = state.project;
    return {
      added: [
        ...p.stagedZoomPoints.map(
          (zp) => `Zoom at ${zp.t.toFixed(1)}s`,
        ),
        ...p.stagedTextOverlays.map(
          (t) => `"${t.text}" at ${t.timestamp.toFixed(1)}s`,
        ),
        ...(p.stagedCaptions.length
          ? [`${p.stagedCaptions.length} captions`]
          : []),
        ...(state.pendingBackgroundBadge
          ? ["Background change"]
          : []),
      ],
      removed: [],
      totalCount:
        p.stagedZoomPoints.length +
        p.stagedTextOverlays.length +
        p.stagedCaptions.length +
        (state.pendingBackgroundBadge ? 1 : 0),
    };
  },

  commitAll: () => {
    const state = get();
    if (!state.project) return;
    const p = state.project;
    const project = {
      ...p,
      zoomPoints: [
        ...p.zoomPoints,
        ...p.stagedZoomPoints.map((z) => ({
          ...z,
          staged: false,
        })),
      ],
      stagedZoomPoints: [],
      textOverlays: [
        ...p.textOverlays,
        ...p.stagedTextOverlays.map((t) => ({
          ...t,
          staged: false,
        })),
      ],
      stagedTextOverlays: [],
      captions: [...p.captions, ...p.stagedCaptions],
      stagedCaptions: [],
    };
    const snap = snapshot(project);
    const history = [
      ...state.history.slice(0, state.historyIndex + 1),
      snap,
    ];
    set({
      project,
      history,
      historyIndex: history.length - 1,
      pendingBackgroundBadge: false,
    });
  },

  clearStaged: () => {
    const state = get();
    if (!state.project) return;
    // Revert background to last committed if pending
    let revertedBg = state.project.background;
    if (
      state.pendingBackgroundBadge &&
      state.historyIndex >= 0 &&
      state.history[state.historyIndex]
    ) {
      revertedBg = state.history[state.historyIndex]!.background;
    }
    set({
      project: {
        ...state.project,
        stagedZoomPoints: [],
        stagedTextOverlays: [],
        stagedCaptions: [],
        background: revertedBg,
      },
      pendingBackgroundBadge: false,
    });
  },

  // ── Undo / redo ──

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0 || !state.project) return;
    const newIndex = state.historyIndex - 1;
    const snap = state.history[newIndex]!;
    set({
      project: restoreFromSnapshot(state.project, snap),
      historyIndex: newIndex,
    });
  },

  redo: () => {
    const state = get();
    if (
      state.historyIndex >= state.history.length - 1 ||
      !state.project
    )
      return;
    const newIndex = state.historyIndex + 1;
    const snap = state.history[newIndex]!;
    set({
      project: restoreFromSnapshot(state.project, snap),
      historyIndex: newIndex,
    });
  },

  // ── Moment marks ──

  markMoment: (t) => {
    const state = get();
    if (!state.project) return;
    const event: ClickEvent = {
      t,
      x: 0.5,
      y: 0.5,
      type: "manual",
    };
    const project = {
      ...state.project,
      clickLog: [...state.project.clickLog, event],
    };
    set({ project });
  },

  setWhisperProgress: (p) => set({ whisperProgress: p }),

  // Playback is stopped up front: the export drives the decoder itself, and a
  // running preview would fight it for frames.
  beginExport: () => set({ exportProgress: 0, isPlaying: false }),
  setExportProgress: (p) => set({ exportProgress: Math.max(0, Math.min(1, p)) }),
  endExport: () => set({ exportProgress: null }),

  setStagePadding: (n) => set({ stagePadding: Math.max(0, Math.min(48, n)) }),

  setAspectPreset: (preset) => {
    const s = get();
    if (!s.project) return;
    set({ project: { ...s.project, aspectPreset: preset } });
  },

  setFacecam: (updates) => {
    const s = get();
    if (!s.project) return;
    set({ project: { ...s.project, facecam: { ...s.project.facecam, ...updates } } });
  },

  setPlaybackRate: (n) => {
    const s = get();
    if (s.exportProgress !== null) return;
    const v = clampRate(n);
    try { getLS()?.setItem("panoptik:playbackRate", String(v)); } catch { /* ignore */ }
    // Clamp currentTime to new effective duration so playhead doesn't sit beyond end
    const dur = s.project?.clip.duration ?? 0;
    const eff = dur > 0 ? dur / v : 0;
    const ct = s.currentTime > eff ? eff : s.currentTime;
    set({ playbackRate: v, currentTime: ct });
  },
}));
