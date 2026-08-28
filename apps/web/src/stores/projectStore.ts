/**
 * OWNER: DEV B — full staged-diff state model per ROADMAP-B.md Task 1.2.
 * Staged* arrays are first-class in Project — ghosts are data, not UI state.
 * The only write path is commitAll(), gated by human confirmation.
 */
"use client";

import { create } from "zustand";
import { projectDuration, resolveSegment, segmentDuration } from "@panoptik/engine";
import {
  migrateProject,
  type Project,
  type Segment,
  type ZoomPoint,
  type TextOverlay,
  type Caption,
  type Background,
  type ClickEvent,
  type AspectPreset,
  type Facecam,
} from "@panoptik/schema";

/** Within this of the duration counts as "at the end" — the playhead lands on
 *  exactly duration, but float drift and frame steps can leave it just short. */
const END_EPSILON = 0.05;

/**
 * Speed clamp shared with the engine's sanitize.speed(): bounded to [0.25, 3]
 * and quantized to the 0.05 step the UI/engine grid uses, so any programmatic
 * write lands on a value the renderer actually supports.
 */
function clampSpeed(v: number): number {
  const raw = Math.min(3, Math.max(0.25, v));
  return Math.round(raw * 20) / 20;
}

/**
 * Playback parks the playhead at the end of the clip. Pressing play there would
 * otherwise finish instantly, so start over instead.
 */
function rewindIfEnded(s: { project: Project | null; currentTime: number }) {
  const duration = s.project ? projectDuration(s.project) : 0;
  return duration > 0 && s.currentTime >= duration - END_EPSILON ? { currentTime: 0 } : {};
}

/**
 * Push a full-project history snapshot before committing a state change.
 * History holds whole `Project` copies, so undo/redo restore every field.
 */
function pushHistoryAndSet(
  project: Project,
  state: ProjectStore,
  set: (partial: Partial<ProjectStore>) => void,
  extra: Partial<ProjectStore> = {},
): void {
  const snap = structuredClone(project);
  const history = [
    ...state.history.slice(0, state.historyIndex + 1),
    snap,
  ];
  set({ project, history, historyIndex: history.length - 1, ...extra });
}

/** The currently-selected segment, or null when nothing is selected. */
function selectedSegment(state: {
  project: Project | null;
  selectedSegmentId: string | null;
}): Segment | null {
  return (
    state.project?.segments.find((s) => s.id === state.selectedSegmentId) ??
    null
  );
}

/** Produce a new project with the selected segment replaced by `fn(seg)`. */
function mapSelectedSegment(
  state: { project: Project | null; selectedSegmentId: string | null; currentTime?: number },
  fn: (seg: Segment) => Segment,
): Project | null {
  if (!state.project || state.project.segments.length === 0) return null;
  let targetId = state.selectedSegmentId;
  if (!targetId || !state.project.segments.some((s) => s.id === targetId)) {
    const active = state.currentTime !== undefined ? resolveSegment(state.project, state.currentTime) : null;
    targetId = active?.segment.id ?? state.project.segments[0]?.id ?? null;
  }
  if (!targetId) return null;
  let found = false;
  const segments = state.project.segments.map((seg) => {
    if (seg.id === targetId) {
      found = true;
      return fn(seg);
    }
    return seg;
  });
  return found ? { ...state.project, segments } : null;
}

interface ProjectStore {
  project: Project | null;
  history: Project[]; // whole-project snapshots; undo/redo swap the full project
  historyIndex: number;
  isPlaying: boolean;
  currentTime: number; // ON-TIMELINE time
  selectedSegmentId: string | null;
  selectedSegmentIds: string[];
  selectedZoomId: string | null;
  pendingBackgroundBadge: boolean;
  whisperProgress: number | null; // null = idle, -1 = transcribing, 0-100 = model loading
  /** 0..1 while an export runs, null when idle. Non-null locks the editor. */
  exportProgress: number | null;
  /** Where the on-device save/restore has got to. */
  persistStatus: "idle" | "saving" | "saved" | "restoring";

  // Project lifecycle
  setProject: (project: Project, history?: Project[], historyIndex?: number) => void;
  /** Drop the loaded video and every edit made on it. */
  clearProject: () => void;
  setPersistStatus: (s: "idle" | "saving" | "saved" | "restoring") => void;
  selectSegment: (id: string, multi?: boolean) => void;
  selectAllSegments: () => void;
  /** Non-destructively divide the segment under timelineT into two. */
  splitAt: (timelineT: number) => void;
  /** Remove a segment from the timeline (when >1 segment exists). */
  deleteSegment: (id: string) => void;
  updateSegment: (id: string, updates: Partial<Segment>) => void;
  updateSelectedSegments: (updates: Partial<Segment>) => void;

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
  replaceFacecamMedia: (facecamSrc: string | null, audioSrc?: string | null, startT?: number) => void;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  history: [],
  historyIndex: -1,
  isPlaying: false,
  currentTime: 0,
  selectedSegmentId: null,
  selectedSegmentIds: [],
  selectedZoomId: null,
  pendingBackgroundBadge: false,
  whisperProgress: null,
  exportProgress: null,
  persistStatus: "idle",

  // ── Project lifecycle ──

  setProject: (project, savedHistory, savedHistoryIndex) => {
    const p = migrateProject(project);
    const validMediaSrc = p.media.src;
    const validAudioSrc = p.audioSrc;
    const validFacecamSrc = p.segments[0]?.facecam?.src ?? null;

    let hist: Project[];
    if (savedHistory && savedHistory.length > 0) {
      hist = savedHistory.map((snap) => {
        const migrated = migrateProject(snap);
        return {
          ...migrated,
          media: {
            ...migrated.media,
            src: validMediaSrc,
          },
          audioSrc: validAudioSrc,
          segments: migrated.segments.map((seg) => ({
            ...seg,
            facecam: {
              ...seg.facecam,
              src: seg.facecam?.src ? validFacecamSrc : null,
            },
          })),
        };
      });
    } else {
      hist = [structuredClone(p)];
    }

    const hIdx =
      typeof savedHistoryIndex === "number" &&
      savedHistoryIndex >= 0 &&
      savedHistoryIndex < hist.length
        ? savedHistoryIndex
        : hist.length - 1;
    const firstSegId = p.segments[0]?.id ?? null;
    set({
      project: p,
      history: hist,
      historyIndex: hIdx,
      currentTime: 0,
      isPlaying: false,
      selectedZoomId: null,
      pendingBackgroundBadge: false,
      selectedSegmentId: firstSegId,
      selectedSegmentIds: firstSegId ? [firstSegId] : [],
    });
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
      selectedSegmentId: null,
      selectedSegmentIds: [],
      pendingBackgroundBadge: false,
      exportProgress: null,
    }),

  selectSegment: (id, multi = false) => {
    const s = get();
    if (!multi) {
      set({ selectedSegmentId: id, selectedSegmentIds: [id] });
      return;
    }
    const current = s.selectedSegmentIds;
    let next: string[];
    if (current.includes(id)) {
      next = current.length > 1 ? current.filter((x) => x !== id) : current;
    } else {
      next = [...current, id];
    }
    set({
      selectedSegmentIds: next,
      selectedSegmentId: next.includes(s.selectedSegmentId ?? "")
        ? s.selectedSegmentId
        : (next[0] ?? null),
    });
  },

  selectAllSegments: () => {
    const s = get();
    if (!s.project) return;
    const allIds = s.project.segments.map((seg) => seg.id);
    set({
      selectedSegmentIds: allIds,
      selectedSegmentId: allIds[0] ?? null,
    });
  },

  splitAt: (timelineT) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    const r = resolveSegment(s.project, timelineT);
    if (!r) return;
    const t = r.srcT;
    const orig = r.segment;
    if (t <= orig.srcStart + 0.001 || t >= orig.srcEnd - 0.001)
      return; // no-op at boundary

    const a = structuredClone(orig);
    a.id = crypto.randomUUID();
    a.srcEnd = t;
    a.zoomPoints = orig.zoomPoints
      .filter((z) => z.t < t)
      .map((z) => ({ ...z }));
    a.stagedZoomPoints = orig.stagedZoomPoints
      .filter((z) => z.t < t)
      .map((z) => ({ ...z }));
    a.textOverlays = orig.textOverlays
      .filter((o) => o.timestamp < t)
      .map((o) => ({ ...o }));
    a.stagedTextOverlays = orig.stagedTextOverlays
      .filter((o) => o.timestamp < t)
      .map((o) => ({ ...o }));
    a.captions = orig.captions
      .filter((c) => c.start < t)
      .map((c) => ({ ...c }));
    a.stagedCaptions = orig.stagedCaptions
      .filter((c) => c.start < t)
      .map((c) => ({ ...c }));

    const b = structuredClone(orig);
    b.id = crypto.randomUUID();
    b.srcStart = t;
    // Annotations are stored at ABSOLUTE source time (the `srcT` writers used),
    // so B keeps its filtered set as-is — rebasing to `- t` would put every
    // value below its own srcStart and silently drop the annotations.
    b.zoomPoints = orig.zoomPoints
      .filter((z) => z.t >= t)
      .map((z) => ({ ...z }));
    b.stagedZoomPoints = orig.stagedZoomPoints
      .filter((z) => z.t >= t)
      .map((z) => ({ ...z }));
    b.textOverlays = orig.textOverlays
      .filter((o) => o.timestamp >= t)
      .map((o) => ({ ...o }));
    b.stagedTextOverlays = orig.stagedTextOverlays
      .filter((o) => o.timestamp >= t)
      .map((o) => ({ ...o }));
    b.captions = orig.captions
      .filter((c) => c.start >= t)
      .map((c) => ({ ...c }));
    b.stagedCaptions = orig.stagedCaptions
      .filter((c) => c.start >= t)
      .map((c) => ({ ...c }));

    const idx = s.project.segments.indexOf(orig);
    const segments = [...s.project.segments];
    segments.splice(idx, 1, a, b);
    const project = { ...s.project, segments };
    pushHistoryAndSet(project, s, set, {
      selectedSegmentId: a.id,
      selectedSegmentIds: [a.id],
    });
  },

  deleteSegment: (id) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    const segments = s.project.segments;
    if (segments.length <= 1) return; // Cannot delete the only remaining segment

    const isMultiDelete =
      s.selectedSegmentIds.includes(id) &&
      s.selectedSegmentIds.length > 1 &&
      s.selectedSegmentIds.length < segments.length;
    const toDeleteIds = new Set(isMultiDelete ? s.selectedSegmentIds : [id]);

    const remainingSegments = segments.filter((seg) => !toDeleteIds.has(seg.id));
    if (remainingSegments.length === 0) return;

    const targetIndex = segments.findIndex((seg) => seg.id === id);
    const nextSelectedIndex = Math.max(0, Math.min(targetIndex - 1, remainingSegments.length - 1));
    const nextSelectedId = remainingSegments[nextSelectedIndex]?.id ?? remainingSegments[0]?.id ?? null;

    const newProject = { ...s.project, segments: remainingSegments };
    const newDur = projectDuration(newProject);
    const newCurrentTime = Math.min(newDur, s.currentTime);

    pushHistoryAndSet(newProject, s, set, {
      selectedSegmentId: nextSelectedId,
      selectedSegmentIds: nextSelectedId ? [nextSelectedId] : [],
      currentTime: newCurrentTime,
    });
  },

  updateSegment: (id, updates) => {
    const s = get();
    if (!s.project) return;
    // Bounded writes for programmatic/agent callers: speed is the one scalar
    // that feeds the renderer's time mapping, so keep it on the engine's grid.
    const applied =
      updates.speed === undefined
        ? updates
        : { ...updates, speed: clampSpeed(updates.speed) };
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        seg.id === id ? { ...seg, ...applied } : seg,
      ),
    };
    pushHistoryAndSet(project, s, set);
  },

  updateSelectedSegments: (updates) => {
    const s = get();
    if (!s.project || s.selectedSegmentIds.length === 0) return;
    const applied =
      updates.speed === undefined
        ? updates
        : { ...updates, speed: clampSpeed(updates.speed) };
    const idSet = new Set(s.selectedSegmentIds);
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, ...applied } : seg,
      ),
    };
    pushHistoryAndSet(project, s, set);
  },

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
  seek: (t) =>
    set((s) => {
      if (s.exportProgress !== null) return {};
      const segId = s.project
        ? (resolveSegment(s.project, t)?.segment.id ?? s.selectedSegmentId)
        : s.selectedSegmentId;
      const nextIds =
        s.selectedSegmentIds.length > 1
          ? s.selectedSegmentIds
          : segId
            ? [segId]
            : [];
      return {
        currentTime: t,
        isPlaying: false,
        selectedSegmentId: segId,
        selectedSegmentIds: nextIds,
      };
    }),
  setCurrentTime: (t) => {
    const s = get();
    if (s.isPlaying && s.project) {
      const r = resolveSegment(s.project, t);
      if (r && r.segment.id !== s.selectedSegmentId) {
        set({
          currentTime: t,
          selectedSegmentId: r.segment.id,
          selectedSegmentIds: [r.segment.id],
        });
        return;
      }
    }
    set({ currentTime: t });
  },

  // ── Zoom — committed ──

  addZoomPoint: (zp) => {
    const state = get();
    if (!state.project || state.project.segments.length === 0) return;
    const targetSegId =
      state.selectedSegmentId ??
      resolveSegment(state.project, state.currentTime)?.segment.id ??
      state.project.segments[0]?.id;
    if (!targetSegId) return;

    const newZP: ZoomPoint = {
      ...zp,
      id: crypto.randomUUID(),
      staged: false,
    };
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        seg.id === targetSegId
          ? { ...seg, zoomPoints: [...seg.zoomPoints, newZP] }
          : seg,
      ),
    };
    pushHistoryAndSet(project, state, set, {
      selectedSegmentId: targetSegId,
      // Select it so the inspector opens on what was just created.
      selectedZoomId: newZP.id,
    });
  },

  removeZoomPoint: (id) => {
    const state = get();
    if (!state.project) return;
    let found = false;
    const segments = state.project.segments.map((seg) => {
      const has = seg.zoomPoints.some((z) => z.id === id);
      if (!has) return seg;
      found = true;
      return {
        ...seg,
        zoomPoints: seg.zoomPoints.filter((z) => z.id !== id),
      };
    });
    if (!found) return;
    const project = { ...state.project, segments };
    pushHistoryAndSet(project, state, set, {
      selectedZoomId:
        state.selectedZoomId === id ? null : state.selectedZoomId,
    });
  },

  updateZoomPoint: (id, updates) => {
    const state = get();
    if (!state.project) return;
    let found = false;
    const segments = state.project.segments.map((seg) => {
      const inCommitted = seg.zoomPoints.some((z) => z.id === id);
      const inStaged = seg.stagedZoomPoints.some((z) => z.id === id);
      if (!inCommitted && !inStaged) return seg;
      found = true;
      return {
        ...seg,
        zoomPoints: inCommitted
          ? seg.zoomPoints.map((z) => (z.id === id ? { ...z, ...updates } : z))
          : seg.zoomPoints,
        stagedZoomPoints: inStaged
          ? seg.stagedZoomPoints.map((z) => (z.id === id ? { ...z, ...updates } : z))
          : seg.stagedZoomPoints,
      };
    });
    if (!found) return;
    set({ project: { ...state.project, segments } });
  },

  commitDrag: () => {
    const state = get();
    if (!state.project) return;
    pushHistoryAndSet(state.project, state, set);
  },

  setSelectedZoom: (id) => set({ selectedZoomId: id }),

  // ── Zoom — staging ──

  stageZoomProposals: (proposals) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedZoomPoints: [...seg.stagedZoomPoints, ...proposals],
    }));
    if (!project) return;
    set({ project });
  },

  removeStagedZoom: (id) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedZoomPoints: seg.stagedZoomPoints.filter((z) => z.id !== id),
    }));
    if (!project) return;
    set({ project });
  },

  // ── Text — committed ──

  addTextOverlay: (overlay) => {
    const state = get();
    if (!state.project || !state.selectedSegmentId) return;
    const newOverlay: TextOverlay = {
      ...overlay,
      id: crypto.randomUUID(),
      staged: false,
    };
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      textOverlays: [...seg.textOverlays, newOverlay],
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set);
  },

  removeTextOverlay: (id) => {
    const state = get();
    if (!state.project || !state.selectedSegmentId) return;
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      textOverlays: seg.textOverlays.filter((t) => t.id !== id),
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set);
  },

  updateTextOverlay: (id, updates) => {
    const state = get();
    if (!state.project || !state.selectedSegmentId) return;
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      textOverlays: seg.textOverlays.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
    if (!project) return;
    set({ project });
  },

  // ── Text — staging ──

  stageTextOverlay: (overlay) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedTextOverlays: [...seg.stagedTextOverlays, overlay],
    }));
    if (!project) return;
    set({ project });
  },

  removeStagedTextOverlay: (id) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedTextOverlays: seg.stagedTextOverlays.filter((t) => t.id !== id),
    }));
    if (!project) return;
    set({ project });
  },

  // ── Captions — committed ──

  setCaptions: (captions) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      captions,
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set);
  },

  // ── Captions — staging ──

  stageCaptions: (captions) => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedCaptions: captions,
    }));
    if (!project) return;
    set({ project });
  },

  clearStagedCaptions: () => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      stagedCaptions: [],
    }));
    if (!project) return;
    set({ project });
  },

  // ── Background ──

  setBackground: (bg) => {
    const state = get();
    if (!state.project || state.selectedSegmentIds.length === 0) return;
    const idSet = new Set(state.selectedSegmentIds);
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, background: bg } : seg,
      ),
    };
    pushHistoryAndSet(project, state, set, { pendingBackgroundBadge: false });
  },

  stageBackground: (bg) => {
    const state = get();
    if (!state.project || state.selectedSegmentIds.length === 0) return;
    const idSet = new Set(state.selectedSegmentIds);
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, background: bg } : seg,
      ),
    };
    // Staged background applies immediately to visual + sets badge
    set({ project, pendingBackgroundBadge: true });
  },

  // ── Staging diff ──

  getStagedDiff: () => {
    const state = get();
    const seg = selectedSegment(state);
    if (!seg)
      return { added: [], removed: [], totalCount: 0 };
    return {
      added: [
        ...seg.stagedZoomPoints.map(
          (zp) => `Zoom at ${zp.t.toFixed(1)}s`,
        ),
        ...seg.stagedTextOverlays.map(
          (t) => `"${t.text}" at ${t.timestamp.toFixed(1)}s`,
        ),
        ...(seg.stagedCaptions.length
          ? [`${seg.stagedCaptions.length} captions`]
          : []),
        ...(state.pendingBackgroundBadge
          ? ["Background change"]
          : []),
      ],
      removed: [],
      totalCount:
        seg.stagedZoomPoints.length +
        seg.stagedTextOverlays.length +
        seg.stagedCaptions.length +
        (state.pendingBackgroundBadge ? 1 : 0),
    };
  },

  commitAll: () => {
    const state = get();
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      zoomPoints: [
        ...seg.zoomPoints,
        ...seg.stagedZoomPoints.map((z) => ({
          ...z,
          staged: false,
        })),
      ],
      stagedZoomPoints: [],
      textOverlays: [
        ...seg.textOverlays,
        ...seg.stagedTextOverlays.map((t) => ({
          ...t,
          staged: false,
        })),
      ],
      stagedTextOverlays: [],
      captions: [...seg.captions, ...seg.stagedCaptions],
      stagedCaptions: [],
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set, { pendingBackgroundBadge: false });
  },

  clearStaged: () => {
    const state = get();
    if (!state.project || !state.selectedSegmentId) return;
    // Revert background to last committed if pending
    let revertedBg = selectedSegment(state)?.background;
    if (
      state.pendingBackgroundBadge &&
      state.historyIndex >= 0 &&
      state.history[state.historyIndex]
    ) {
      const histSeg = state.history[state.historyIndex]!.segments.find(
        (seg) => seg.id === state.selectedSegmentId,
      );
      if (histSeg) revertedBg = histSeg.background;
    }
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        seg.id === state.selectedSegmentId
          ? {
              ...seg,
              stagedZoomPoints: [],
              stagedTextOverlays: [],
              stagedCaptions: [],
              ...(revertedBg !== undefined
                ? { background: revertedBg }
                : {}),
            }
          : seg,
      ),
    };
    set({ project, pendingBackgroundBadge: false });
  },

  // ── Undo / redo ──

  undo: () => {
    const state = get();
    if (state.historyIndex <= 0 || !state.project) return;
    const newIndex = state.historyIndex - 1;
    const snap = state.history[newIndex]!;
    const validSelected = (state.selectedSegmentIds || []).filter((id) =>
      snap.segments.some((seg) => seg.id === id),
    );
    const nextSelectedIds =
      validSelected.length > 0
        ? validSelected
        : snap.segments[0]
          ? [snap.segments[0].id]
          : [];
    const nextSelectedId = nextSelectedIds[0] ?? null;

    const currentMediaSrc = state.project.media.src;
    const currentAudioSrc = state.project.audioSrc;
    const currentFacecamSrc = state.project.segments[0]?.facecam?.src ?? null;

    const restoredProject = structuredClone(snap);
    restoredProject.media.src = currentMediaSrc;
    restoredProject.audioSrc = currentAudioSrc;
    restoredProject.segments = restoredProject.segments.map((seg) => ({
      ...seg,
      facecam: {
        ...seg.facecam,
        src: seg.facecam?.src ? currentFacecamSrc : null,
      },
    }));

    set({
      project: restoredProject,
      historyIndex: newIndex,
      selectedSegmentId: nextSelectedId,
      selectedSegmentIds: nextSelectedIds,
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
    const validSelected = (state.selectedSegmentIds || []).filter((id) =>
      snap.segments.some((seg) => seg.id === id),
    );
    const nextSelectedIds =
      validSelected.length > 0
        ? validSelected
        : snap.segments[0]
          ? [snap.segments[0].id]
          : [];
    const nextSelectedId = nextSelectedIds[0] ?? null;

    const currentMediaSrc = state.project.media.src;
    const currentAudioSrc = state.project.audioSrc;
    const currentFacecamSrc = state.project.segments[0]?.facecam?.src ?? null;

    const restoredProject = structuredClone(snap);
    restoredProject.media.src = currentMediaSrc;
    restoredProject.audioSrc = currentAudioSrc;
    restoredProject.segments = restoredProject.segments.map((seg) => ({
      ...seg,
      facecam: {
        ...seg.facecam,
        src: seg.facecam?.src ? currentFacecamSrc : null,
      },
    }));

    set({
      project: restoredProject,
      historyIndex: newIndex,
      selectedSegmentId: nextSelectedId,
      selectedSegmentIds: nextSelectedIds,
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

  setStagePadding: (n) => {
    const s = get();
    if (s.selectedSegmentIds.length === 0) return;
    const clamped = Math.max(0, Math.min(48, n));
    s.updateSelectedSegments({ stagePadding: clamped });
  },

  setAspectPreset: (preset) => {
    const s = get();
    if (s.selectedSegmentIds.length === 0) return;
    s.updateSelectedSegments({ aspectPreset: preset });
  },

  setFacecam: (updates) => {
    const s = get();
    if (!s.project || s.selectedSegmentIds.length === 0) return;
    const idSet = new Set(s.selectedSegmentIds);
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        idSet.has(seg.id) ? { ...seg, facecam: { ...seg.facecam, ...updates } } : seg,
      ),
    };
    pushHistoryAndSet(project, s, set);
  },

  replaceFacecamMedia: (facecamSrc, audioSrc, startT) => {
    const s = get();
    if (!s.project) return;
    const project = {
      ...s.project,
      audioSrc: audioSrc !== undefined ? audioSrc : s.project.audioSrc,
      segments: s.project.segments.map((seg) => ({
        ...seg,
        facecam: {
          ...seg.facecam,
          src: facecamSrc,
          startT: startT !== undefined ? startT : seg.facecam?.startT,
        },
      })),
    };
    pushHistoryAndSet(project, s, set);
  },
}));