/**
 * @panoptik/engine — browser-native media pipeline.
 *
 * OWNERSHIP (ROADMAP-A/B.md matrices — do not cross these lines):
 *   DEV A: decode.ts, render.ts, encode.ts, audio.ts, layout.ts, test-fixtures.ts
 *   DEV B: record.ts, opfs.ts (re-exported below in the B-region)
 */

import type { ExportOpts, Project } from "@panoptik/schema";
import type { ExportFrameOpts } from "./encode";
import type { RenderOptions } from "./render";

export interface MediaEngine {
  /** Seek + decode the frame at `t` into an internal cache. Call before renderFrame. */
  prepareFrame(t: number): Promise<void>;
  /** Decode clip + facecam together for a complete frame. */
  prepareAllFrames(t: number): Promise<void>;
  /** Sync draw of cached frame + full composition. Preview and export share this. */
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number, options?: RenderOptions): void;
  loadClip(file: File): Promise<Project>;
  loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project>;
  /** Re-open a saved project's media and reapply its edits. */
  restoreProject(id: string): Promise<Project | null>;
  /** Full-clip mono AudioBuffer for transcription/export. null when no decodable audio. */
  getAudioBuffer(project: Project): Promise<AudioBuffer | null>;
  /** Encode the project. `opts.selectedSegmentId` picks which segment's aspect
   *  preset sets the output frame — the preview sizes to the same selection, so
   *  export matches what the user is looking at. */
  exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob>;
}

export type { Project, ExportOpts, ExportFrameOpts };
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
  resolveInterpolatedFacecam,
} from "./render";
export type { Transform, Viewport, RenderOptions } from "./render";

// ── #region B-modules (DEV B adds re-export lines here; DEV A do not edit) ──
export { segmentDuration, projectDuration, resolveSegment, sourceToTimeline } from "./timeline";
export { startRecording, openCameraTrack, openMicrophoneTrack } from "./record";
export type { RecordingHandles } from "./record";
export { saveProject, loadProject, loadProjectRecord, listProjects, deleteProject } from "./opfs";
// ── #endregion ──
