/**
 * @panoptik/engine — browser-native media pipeline.
 *
 * OWNERSHIP (ROADMAP-A/B.md matrices — do not cross these lines):
 *   DEV A: decode.ts, render.ts, encode.ts, audio.ts, layout.ts, test-fixtures.ts
 *   DEV B: record.ts, opfs.ts (re-exported below in the B-region)
 */

import type { AudioTrack, ExportOpts, Media, Project, Segment } from "@panoptik/schema";
import type { ExportFrameOpts } from "./encode";
import type { RenderOptions } from "./render";

export interface MediaEngine {
  /** Seek + decode the frame at `t` into an internal cache. Call before renderFrame. */
  prepareFrame(t: number): Promise<void>;
  /** Decode clip + facecam together for a complete frame. `fcT` is facecam track time offset. */
  prepareAllFrames(t: number, fcT?: number): Promise<void>;
  /** Sync draw of cached frame + full composition. Preview and export share this. */
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, options?: RenderOptions): void;
  loadClip(file: File): Promise<Project>;
  /**
   * Read a clip's metadata without touching the decode pipeline — the
   * append flow uses this so the playing clip and every project-owned blob
   * URL survive the import. The pipeline opens the returned media lazily.
   */
  importClip(file: File): Promise<{ media: Media; segment: Segment }>;
  loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null, opts?: { append?: boolean }): Promise<Project>;
  /** Re-open a saved project's media and reapply its edits. */
  restoreProject(id: string): Promise<Project | null>;
  /** Full-clip mono AudioBuffer for transcription/export. null when no decodable audio. */
  getAudioBuffer(project: Project): Promise<AudioBuffer | null>;
  /** Load/replace facecam media and optional audio track without replacing the screen recording. */
  setFacecamBlob(facecam: Blob | null, audio?: Blob | null): Promise<string | null>;
  /** Make `mediaId`'s clip the active decode pipeline (no-op if already active). */
  activateMedia(mediaId: string, src: string | null): Promise<void>;
  /** Encode the project. `opts.selectedSegmentId` picks which segment's aspect
   *  preset sets the output frame — the preview sizes to the same selection, so
   *  export matches what the user is looking at. */
  exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob>;
}

export type { Project, ExportOpts, ExportFrameOpts, AudioTrack };
export { createRealEngine } from "./real-engine";

// Camera geometry — shared so the editor's focal handles land exactly where
// renderFrame draws them.
export { frameRect, outputSize, presetAspect } from "./layout";
export type { Rect } from "./layout";
export {
  IDENTITY,
  cameraViewport,
  canvasToFrame,
  frameToCanvas,
  getCameraTransform,
  getProjectCameraTransform,
  renderFrame,
  frameCornerRadius,
  outerCornerRadius,
  DEFAULT_CORNER_RADIUS_UNITS,
  resolveInterpolatedFacecam,
  resolveVideoTransition,
  ensureBackgroundImages,
  clearBackgroundImages,
} from "./render";
export type { Transform, Viewport, RenderOptions, ResolvedVideoTransition } from "./render";

export { segmentDuration, projectDuration, resolveSegment, sourceToTimeline } from "./timeline";
export { decodeViaAudioContext } from "./audio";
export { startRecording, openCameraTrack, openMicrophoneTrack } from "./record";
export type { RecordingHandles } from "./record";
export { setFacecamBlob, setAudioBlob, getFirstVideoTimestamp } from "./decode";
export {
  saveProject,
  renameProject,
  loadProject,
  loadProjectRecord,
  listProjects,
  listProjectSummaries,
  deleteProject,
  savePoster,
  loadPoster,
  markExported,
  saveAudioTrackFile,
  loadAudioTrackFiles,
  deleteAudioTrackFile,
} from "./opfs";
export type { ProjectSummary } from "./opfs";
export {
  registerTrackBuffer,
  getTrackBuffer,
  clearTrackBuffers,
  trackGainAt,
  applyTrackEnvelope,
  computeDuckingEnvelope,
  mixTracksIntoBase,
} from "./audioTracks";
export { formatDefaultProjectName } from "./naming";

// Analysis & Semantic Digest Module
export * from "./analysis/videoFeatures";
export * from "./analysis/audioFeatures";
export * from "./analysis/audioPayload";
export * from "./analysis/transcriptPacking";
export * from "./analysis/interactionFeatures";
export * from "./analysis/cache";
export * from "./analysis/digest";
export * from "./analysis/selfEval";

// ── #endregion ──