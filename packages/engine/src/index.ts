/**
 * @panoptik/engine — browser-native media pipeline.
 *
 * OWNERSHIP (ROADMAP-A/B.md matrices — do not cross these lines):
 *   DEV A: decode.ts, render.ts, encode.ts, audio.ts, layout.ts, test-fixtures.ts
 *   DEV B: record.ts, opfs.ts (re-exported below in the B-region)
 */

import type { ExportOpts, Project } from "@panoptik/schema";

export interface MediaEngine {
  /** Seek + decode the frame at `t` into an internal cache. Call before renderFrame. */
  prepareFrame(t: number): Promise<void>;
  /** Sync draw of cached frame + full composition. Preview and export share this. */
  renderFrame(ctx: CanvasRenderingContext2D, project: Project, t: number): void;
  loadClip(file: File): Promise<Project>;
  loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project>;
  /** Re-open a saved project's media and reapply its edits. */
  restoreProject(id: string): Promise<Project | null>;
  /** Full-clip mono AudioBuffer for transcription/export. null when no decodable audio. */
  getAudioBuffer(project: Project): Promise<AudioBuffer | null>;
  exportProject(project: Project, opts: ExportOpts): Promise<Blob>;
}

export type { Project, ExportOpts };
export { createRealEngine } from "./real-engine";

// Camera geometry — shared so the editor's focal handles land exactly where
// renderFrame draws them.
export { frameRect, outputSize, presetAspect } from "./layout";
export type { Rect } from "./layout";
export {
  cameraViewport,
  canvasToFrame,
  frameToCanvas,
  getCameraTransform,
} from "./render";
export type { Transform, Viewport } from "./render";

// ── #region B-modules (DEV B adds re-export lines here; DEV A do not edit) ──
export { startRecording, openCameraTrack, openMicrophoneTrack } from "./record";
export { saveProject, loadProject, loadProjectRecord, listProjects, deleteProject } from "./opfs";
// ── #endregion ──
