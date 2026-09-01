/**
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
  type Background,
  type ClickEvent,
  type AspectPreset,
  type AudioTrack,
  type Facecam,
  type Media,
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
/**
 * Re-point a history snapshot's clips at the object URLs that are live now.
 *
 * Snapshots are structured clones taken earlier in the session; their srcs can
 * be stale, and a stale blob URL renders as nothing. Matching by media id keeps
 * this correct once a project holds more than one clip — index alone would
 * mis-assign after a reorder.
 */
function pinLiveMediaSrcs(snapshot: Project, live: Project): Media[] {
  return snapshot.media.map((m, i) => {
    const liveMedia = live.media.find((lm) => lm.id === m.id) ?? live.media[i];
    return liveMedia ? { ...m, src: liveMedia.src } : m;
  });
}

function pushHistoryAndSet(
  project: Project,
  state: ProjectStore,
  set: (partial: Partial<ProjectStore>) => void,
  extra: Partial<ProjectStore> = {},
): void {
  // A staged theme is visible but not approved, so it must not ride into
  // history on an unrelated commit — that is what silently turned a previewed
  // theme into the one Discard later restored.
  const pre = (extra.preStageBackgrounds ?? state.preStageBackgrounds) as
    | Record<string, Background>
    | undefined;
  const snap = structuredClone(project);
  if (pre && Object.keys(pre).length > 0) {
    snap.segments = snap.segments.map((seg) =>
      pre[seg.id] ? { ...seg, background: pre[seg.id]! } : seg,
    );
  }
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
  selectedTextOverlayId: string | null;
  pendingBackgroundBadge: boolean;
  /**
   * Background each segment had before the current staged theme, by segment id.
   *
   * The background is the one staged edit with nowhere to live: zooms and text
   * each have their own staged* array, while a theme is written
   * straight onto the committed field with only a badge to say it is pending.
   * Without a record of what it replaced, Discard had to guess from history —
   * and any unrelated commit in between would bake the unapproved theme in.
   * Transient: never written to storage.
   */
  preStageBackgrounds: Record<string, Background>;
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
  /** Name the entire project/video, or clear with "". */
  setProjectName: (name: string) => void;
  /** Name a single clip, or clear its name with "". */
  setSegmentName: (segmentId: string, name: string) => void;
  /** Remove a segment from the timeline (when >1 segment exists). */
  deleteSegment: (id: string) => void;
  updateSegment: (id: string, updates: Partial<Segment>) => void;
  updateSelectedSegments: (updates: Partial<Segment>) => void;

  // Audio tracks (music / voiceover) — wall-clock timeline assets
  addAudioTrack: (track: AudioTrack) => void;
  updateAudioTrack: (id: string, updates: Partial<AudioTrack>) => void;
  removeAudioTrack: (id: string) => void;

  // Multiclip — append assets to the end of the timeline
  appendClip: (media: Media, segment: Segment) => void;
  appendRecordedProject: (recorded: Project) => void;
  /** Reorder segments by drag — `from` and `to` are indices in the segments array. */
  reorderSegments: (fromIndex: number, toIndex: number) => void;
  /** Move a contiguous clip group (fromStart..fromEnd inclusive) to toIndex. */
  moveClipGroup: (fromStart: number, fromEnd: number, toIndex: number) => void;

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
  batchAddTextOverlays: (overlays: Array<Omit<TextOverlay, "id" | "staged">>, segmentId?: string) => void;
  setSegmentTextOverlays: (segmentId: string, overlays: TextOverlay[]) => void;
  removeTextOverlay: (id: string) => void;
  updateTextOverlay: (
    id: string,
    updates: Partial<TextOverlay>,
  ) => void;
  setSelectedTextOverlay: (id: string | null) => void;

  // Text — staging
  stageTextOverlay: (overlay: TextOverlay) => void;
  removeStagedTextOverlay: (id: string) => void;

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
  setCornerRadius: (n: number) => void;
  setOuterRadius: (n: number) => void;
  setAspectPreset: (preset: AspectPreset) => void;

  setFacecam: (updates: Partial<Facecam>) => void;
  setSegmentAudioVolume: (segmentId: string, volume: number) => void;
  setFacecamAudioVolume: (segmentId: string, volume: number) => void;
  setAllSegmentsAudioVolume: (type: "screen" | "facecam", volume: number) => void;
  replaceFacecamMedia: (
    facecamSrc: string | null,
    audioSrc?: string | null,
    startT?: number,
    duration?: number,
  ) => void;
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
  selectedTextOverlayId: null,
  pendingBackgroundBadge: false,
  preStageBackgrounds: {},
  whisperProgress: null,
  exportProgress: null,
  persistStatus: "idle",

  // ── Project lifecycle ──

  setProject: (project, savedHistory, savedHistoryIndex) => {
    const p = migrateProject(project);
    const validMediaSrc = p.media[0]?.src ?? "";
    const validAudioSrc = p.audioSrc;
    const validFacecamSrc = p.segments[0]?.facecam?.src ?? null;

    let hist: Project[];
    if (savedHistory && savedHistory.length > 0) {
      hist = savedHistory.map((snap) => {
        const migrated = migrateProject(snap);
        return {
          ...migrated,
          // Same re-pinning as undo/redo. Spreading the media array into an
          // object literal here produced {0: {...}, src} — shaped like neither
          // a Media nor an array, and it only surfaced when something later
          // called .map on it.
          media: pinLiveMediaSrcs(migrated, p),
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
      selectedTextOverlayId: null,
      pendingBackgroundBadge: false,
  preStageBackgrounds: {},
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
      selectedTextOverlayId: null,
      selectedSegmentId: null,
      selectedSegmentIds: [],
      pendingBackgroundBadge: false,
  preStageBackgrounds: {},
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

  setProjectName: (name) => {
    const state = get();
    if (!state.project) return;
    const trimmed = name.trim().slice(0, 120);
    const project = {
      ...state.project,
      name: trimmed || undefined,
    };
    pushHistoryAndSet(project, state, set);
  },

  setSegmentName: (segmentId, name) => {
    const state = get();
    if (!state.project) return;
    const trimmed = name.trim().slice(0, 120);
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, name: trimmed || undefined } : seg,
      ),
    };
    pushHistoryAndSet(project, state, set);
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

  // ── Audio tracks ──

  addAudioTrack: (track) => {
    const s = get();
    if (!s.project) return;
    const project = { ...s.project, audioTracks: [...(s.project.audioTracks ?? []), track] };
    pushHistoryAndSet(project, s, set);
  },

  updateAudioTrack: (id, updates) => {
    const s = get();
    if (!s.project) return;
    const project = {
      ...s.project,
      audioTracks: (s.project.audioTracks ?? []).map((t) => (t.id === id ? { ...t, ...updates } : t)),
    };
    pushHistoryAndSet(project, s, set);
  },

  removeAudioTrack: (id) => {
    const s = get();
    if (!s.project) return;
    const project = { ...s.project, audioTracks: (s.project.audioTracks ?? []).filter((t) => t.id !== id) };
    pushHistoryAndSet(project, s, set);
  },

  // ── Multiclip (append) ──

  appendClip: (media, segment) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    const project: Project = {
      ...s.project,
      media: [...s.project.media, media],
      segments: [...s.project.segments, segment],
    };
    pushHistoryAndSet(project, s, set);
  },

  appendRecordedProject: (recorded) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    // Media ids must be unique project-wide — a recorded take may reuse an id
    // (e.g. re-append after undo). Rename on collision.
    const used = new Set(s.project.media.map((m) => m.id));
    const renamedIds = new Map<string, string>();
    const media = recorded.media.map((m): Media => {
      let id = m.id;
      if (used.has(id)) {
        id = crypto.randomUUID();
        renamedIds.set(m.id, id);
      }
      used.add(id);
      return { ...m, id, src: m.src };
    });
    const segments = recorded.segments.map((seg) => ({
      ...seg,
      id: crypto.randomUUID(),
      mediaId: renamedIds.get(seg.mediaId) ?? seg.mediaId,
    }));
    const project: Project = {
      ...s.project,
      media: [...s.project.media, ...media],
      segments: [...s.project.segments, ...segments],
    };
    pushHistoryAndSet(project, s, set);
  },

  reorderSegments: (fromIndex, toIndex) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    const segs = s.project.segments;
    if (fromIndex < 0 || fromIndex >= segs.length || toIndex < 0 || toIndex >= segs.length || fromIndex === toIndex) return;
    const next = [...segs];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    const project: Project = { ...s.project, segments: next };
    pushHistoryAndSet(project, s, set);
  },

  moveClipGroup: (fromStart, fromEnd, toIndex) => {
    const s = get();
    if (!s.project || s.exportProgress !== null) return;
    const segs = s.project.segments;
    if (fromStart < 0 || fromEnd >= segs.length || fromStart > fromEnd) return;
    if (toIndex < 0 || toIndex > segs.length) return;
    // No-op if dropping inside the group
    if (toIndex >= fromStart && toIndex <= fromEnd + 1) return;
    const next = [...segs];
    const group = next.splice(fromStart, fromEnd - fromStart + 1);
    // Adjust target index for removal
    let target = toIndex;
    if (toIndex > fromEnd) target = toIndex - (fromEnd - fromStart + 1);
    // Clamp
    target = Math.max(0, Math.min(next.length, target));
    next.splice(target, 0, ...group);
    const project: Project = { ...s.project, segments: next };
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
        isPlaying: s.isPlaying,
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
      const inCommitted = seg.zoomPoints.some((z) => z.id === id);
      const inStaged = seg.stagedZoomPoints.some((z) => z.id === id);
      if (!inCommitted && !inStaged) return seg;
      found = true;
      return {
        ...seg,
        zoomPoints: seg.zoomPoints.filter((z) => z.id !== id),
        stagedZoomPoints: seg.stagedZoomPoints.filter((z) => z.id !== id),
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

  // ── Zoom — staging (applies automatically) ──

  stageZoomProposals: (proposals) => {
    const state = get();
    const cleanProposals = proposals.map((p) => ({ ...p, staged: false }));
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      zoomPoints: [...seg.zoomPoints, ...cleanProposals],
      stagedZoomPoints: [],
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set);
  },

  removeStagedZoom: (id) => {
    get().removeZoomPoint(id);
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
    set({ selectedTextOverlayId: newOverlay.id });
    pushHistoryAndSet(project, state, set);
  },

  batchAddTextOverlays: (overlays, targetSegmentId) => {
    const state = get();
    if (!state.project || state.project.segments.length === 0) return;
    const segmentId = targetSegmentId ?? state.selectedSegmentId ?? state.project.segments[0]?.id;
    if (!segmentId) return;
    const newItems: TextOverlay[] = overlays.map((o) => ({
      ...o,
      id: crypto.randomUUID(),
      staged: false,
    }));
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, textOverlays: [...seg.textOverlays, ...newItems] } : seg,
      ),
    };
    pushHistoryAndSet(project, state, set);
  },

  setSegmentTextOverlays: (segmentId, overlays) => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, textOverlays: overlays } : seg,
      ),
    };
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
    if (state.selectedTextOverlayId === id) {
      set({ selectedTextOverlayId: null });
    }
    pushHistoryAndSet(project, state, set);
  },

  updateTextOverlay: (id, updates) => {
    const state = get();
    if (!state.project || !state.selectedSegmentId) return;
    const project = mapSelectedSegment(state, (seg) => {
      const target = seg.textOverlays.find((t) => t.id === id);
      if (!target) return seg;

      const isCaption = target.kind === "caption";
      const isGroupUpdate =
        updates.x !== undefined ||
        updates.y !== undefined ||
        updates.position !== undefined ||
        updates.fontSize !== undefined;

      // When moving/repositioning or resizing a caption on canvas, move/resize the whole speaker/screen group together
      if (isCaption && isGroupUpdate) {
        const targetSpeaker =
          target.speaker ||
          (target.text.startsWith("Speaker:")
            ? "Speaker"
            : target.text.startsWith("Screen:")
            ? "Screen"
            : "caption");

        return {
          ...seg,
          textOverlays: seg.textOverlays.map((t) => {
            if (t.kind !== "caption") return t;
            const tSpeaker =
              t.speaker ||
              (t.text.startsWith("Speaker:")
                ? "Speaker"
                : t.text.startsWith("Screen:")
                ? "Screen"
                : "caption");

            if (tSpeaker === targetSpeaker) {
              return { ...t, ...updates };
            }
            return t;
          }),
        };
      }

      // Default single-overlay update
      return {
        ...seg,
        textOverlays: seg.textOverlays.map((t) =>
          t.id === id ? { ...t, ...updates } : t,
        ),
      };
    });
    if (!project) return;
    set({ project });
  },

  setSelectedTextOverlay: (id) => {
    set({ selectedTextOverlayId: id });
  },

  // ── Text — staging (applies automatically) ──

  stageTextOverlay: (overlay) => {
    const state = get();
    const newOverlay: TextOverlay = {
      ...overlay,
      id: overlay.id || crypto.randomUUID(),
      staged: false,
    };
    const project = mapSelectedSegment(state, (seg) => ({
      ...seg,
      textOverlays: [...seg.textOverlays, newOverlay],
      stagedTextOverlays: [],
    }));
    if (!project) return;
    pushHistoryAndSet(project, state, set);
  },

  removeStagedTextOverlay: (id) => {
    get().removeTextOverlay(id);
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
    pushHistoryAndSet(project, state, set, {
      pendingBackgroundBadge: false,
      preStageBackgrounds: {},
    });
  },

  stageBackground: (bg) => {
    get().setBackground(bg);
  },

  // ── Staging diff ──

  getStagedDiff: () => {
    const state = get();
    if (!state.project) return { added: [], removed: [], totalCount: 0 };
    const allStagedZooms = state.project.segments.flatMap((s) => s.stagedZoomPoints ?? []);
    const allStagedTexts = state.project.segments.flatMap((s) => s.stagedTextOverlays ?? []);
    return {
      added: [
        ...allStagedZooms.map((zp) => `Zoom at ${zp.t.toFixed(1)}s`),
        ...allStagedTexts.map((t) => `"${t.text}" at ${t.timestamp.toFixed(1)}s`),
        ...(state.pendingBackgroundBadge ? ["Background change"] : []),
      ],
      removed: [],
      totalCount:
        allStagedZooms.length +
        allStagedTexts.length +
        (state.pendingBackgroundBadge ? 1 : 0),
    };
  },

  commitAll: () => {
    const state = get();
    if (!state.project) return;
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) => ({
        ...seg,
        zoomPoints: [
          ...seg.zoomPoints,
          ...(seg.stagedZoomPoints ?? []).map((z) => ({
            ...z,
            staged: false,
          })),
        ],
        stagedZoomPoints: [],
        textOverlays: [
          ...seg.textOverlays,
          ...(seg.stagedTextOverlays ?? []).map((t) => ({
            ...t,
            staged: false,
          })),
        ],
        stagedTextOverlays: [],
      })),
    };
    // The staged theme is the committed one now, so it must reach history.
    pushHistoryAndSet(project, state, set, {
      pendingBackgroundBadge: false,
      preStageBackgrounds: {},
    });
  },

  clearStaged: () => {
    const state = get();
    if (!state.project) return;
    const pre = state.preStageBackgrounds;
    const project = {
      ...state.project,
      segments: state.project.segments.map((seg) => {
        const background = seg.id in pre ? pre[seg.id]! : seg.background;
        return {
          ...seg,
          background,
          stagedZoomPoints: [],
          stagedTextOverlays: [],
        };
      }),
    };
    set({ project, pendingBackgroundBadge: false, preStageBackgrounds: {} });
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

    const liveProject = state.project;
    const currentAudioSrc = state.project.audioSrc;
    const currentFacecamSrc = state.project.segments[0]?.facecam?.src ?? null;

    const restoredProject = structuredClone(snap);
    restoredProject.media = pinLiveMediaSrcs(restoredProject, liveProject);
    restoredProject.audioSrc = snap.audioSrc ?? currentAudioSrc;
    restoredProject.segments = restoredProject.segments.map((seg) => ({
      ...seg,
      facecam: {
        ...seg.facecam,
        src: seg.facecam?.src ?? (seg.facecam ? currentFacecamSrc : null),
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

    const liveProject = state.project;
    const currentAudioSrc = state.project.audioSrc;
    const currentFacecamSrc = state.project.segments[0]?.facecam?.src ?? null;

    const restoredProject = structuredClone(snap);
    restoredProject.media = pinLiveMediaSrcs(restoredProject, liveProject);
    restoredProject.audioSrc = snap.audioSrc ?? currentAudioSrc;
    restoredProject.segments = restoredProject.segments.map((seg) => ({
      ...seg,
      facecam: {
        ...seg.facecam,
        src: seg.facecam?.src ?? (seg.facecam ? currentFacecamSrc : null),
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

  setCornerRadius: (n) => {
    const s = get();
    if (s.selectedSegmentIds.length === 0) return;
    s.updateSelectedSegments({ cornerRadius: Math.max(0, Math.min(64, n)) });
  },

  setOuterRadius: (n) => {
    const s = get();
    if (s.selectedSegmentIds.length === 0) return;
    s.updateSelectedSegments({ outerRadius: Math.max(0, Math.min(64, n)) });
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

  replaceFacecamMedia: (facecamSrc, audioSrc, startT, duration) => {
    const s = get();
    if (!s.project) return;
    const isPartial = typeof startT === "number" && startT > 0.05;

    if (!isPartial) {
      const project = {
        ...s.project,
        audioSrc: audioSrc !== undefined ? audioSrc : s.project.audioSrc,
        segments: s.project.segments.map((seg) => ({
          ...seg,
          facecam: {
            ...seg.facecam,
            src: facecamSrc,
            startT: 0,
          },
        })),
      };
      pushHistoryAndSet(project, s, set);
      return;
    }

    let proj = s.project;
    const splitAtTimeline = (p: typeof proj, targetT: number): typeof proj => {
      const r = resolveSegment(p, targetT);
      if (!r) return p;
      const t = r.srcT;
      const orig = r.segment;
      if (t <= orig.srcStart + 0.05 || t >= orig.srcEnd - 0.05) return p;

      const a = structuredClone(orig);
      a.id = crypto.randomUUID();
      a.srcEnd = t;
      a.zoomPoints = orig.zoomPoints.filter((z) => z.t < t).map((z) => ({ ...z }));
      a.stagedZoomPoints = orig.stagedZoomPoints.filter((z) => z.t < t).map((z) => ({ ...z }));
      a.textOverlays = orig.textOverlays.filter((o) => o.timestamp < t).map((o) => ({ ...o }));
      a.stagedTextOverlays = orig.stagedTextOverlays.filter((o) => o.timestamp < t).map((o) => ({ ...o }));

      const b = structuredClone(orig);
      b.id = crypto.randomUUID();
      b.srcStart = t;
      b.zoomPoints = orig.zoomPoints.filter((z) => z.t >= t).map((z) => ({ ...z }));
      b.stagedZoomPoints = orig.stagedZoomPoints.filter((z) => z.t >= t).map((z) => ({ ...z }));
      b.textOverlays = orig.textOverlays.filter((o) => o.timestamp >= t).map((o) => ({ ...o }));
      b.stagedTextOverlays = orig.stagedTextOverlays.filter((o) => o.timestamp >= t).map((o) => ({ ...o }));

      const idx = p.segments.findIndex((seg) => seg.id === orig.id);
      const segments = [...p.segments];
      segments.splice(idx, 1, a, b);
      return { ...p, segments };
    };

    proj = splitAtTimeline(proj, startT);
    const takeDur = typeof duration === "number" && duration > 0.1 ? duration : null;
    if (takeDur !== null) {
      const endT = startT + takeDur;
      const total = projectDuration(proj);
      if (endT < total - 0.05) {
        proj = splitAtTimeline(proj, endT);
      }
    }

    let tAccum = 0;
    const finalSegments = proj.segments.map((seg) => {
      const segDur = (seg.srcEnd - seg.srcStart) / (seg.speed || 1);
      const segStartT = tAccum;
      const segEndT = tAccum + segDur;
      tAccum = segEndT;

      const isPrior = segEndT <= startT + 0.02;
      const isSubsequent = takeDur !== null && segStartT >= startT + takeDur - 0.02;

      if (isPrior || isSubsequent) {
        return seg;
      }

      return {
        ...seg,
        facecam: {
          ...seg.facecam,
          src: facecamSrc,
          startT: startT,
        },
      };
    });

    const project = {
      ...proj,
      segments: finalSegments,
    };
    pushHistoryAndSet(project, s, set);
  },

  setSegmentAudioVolume: (segmentId, volume) => {
    const s = get();
    if (!s.project) return;
    const vol = Math.max(0, Math.min(2, Number(volume.toFixed(2))));
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        seg.id === segmentId ? { ...seg, audioVolume: vol } : seg,
      ),
    };
    pushHistoryAndSet(project, s, set);
  },

  setFacecamAudioVolume: (segmentId, volume) => {
    const s = get();
    if (!s.project) return;
    const vol = Math.max(0, Math.min(2, Number(volume.toFixed(2))));
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        seg.id === segmentId
          ? { ...seg, facecam: { ...seg.facecam, audioVolume: vol } }
          : seg,
      ),
    };
    pushHistoryAndSet(project, s, set);
  },

  setAllSegmentsAudioVolume: (type, volume) => {
    const s = get();
    if (!s.project) return;
    const vol = Math.max(0, Math.min(2, Number(volume.toFixed(2))));
    const project = {
      ...s.project,
      segments: s.project.segments.map((seg) =>
        type === "screen"
          ? { ...seg, audioVolume: vol }
          : { ...seg, facecam: { ...seg.facecam, audioVolume: vol } },
      ),
    };
    pushHistoryAndSet(project, s, set);
  },
}));