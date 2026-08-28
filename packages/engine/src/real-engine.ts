/**
 * OWNER: DEV A — Concrete MediaEngine implementation.
 * Wires decode.ts → render.ts → audio.ts into the MediaEngine interface.
 * Preview and export share renderFrame + prepareFrame.
 */
import type { ExportOpts, Project } from "@panoptik/schema";
import type { MediaEngine } from "./index";
import {
  loadClip as decodeLoadClip,
  prepareFrame as decodePrepareFrame,
  prepareAllFrames,
  setAudioBlob,
  setFacecamBlob,
} from "./decode";
import { renderFrame } from "./render";
import { getAudioBuffer as audioGetBuffer } from "./audio";
import { exportProject as encodeProject } from "./encode";
import { loadProjectRecord } from "./opfs";
import { mergeSavedProject } from "./sanitize";

export function createRealEngine(): MediaEngine {
  return {
    async loadClip(file: File): Promise<Project> {
      const proj = await decodeLoadClip(file);
      await decodePrepareFrame(0);
      return proj;
    },
    async prepareFrame(t: number): Promise<void> {
      // Clip and camera together — a half-decoded frame would composite stale
      // camera pixels over a fresh screen.
      return prepareAllFrames(t);
    },
    async prepareAllFrames(t: number): Promise<void> {
      return prepareAllFrames(t);
    },
    renderFrame(ctx, project, t) {
      renderFrame(ctx, project, t);
    },
    async loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project> {
      // Capture/ingest boundary: B's record.ts captures blobs, we demux screen blob as clip.
      const screenFile = new File([screen], "screen.webm", { type: screen.type || "video/webm" });
      const proj = await decodeLoadClip(screenFile);
      // After loadClip: it tears down first, which revokes the previous take's
      // facecam URL and drops its cached <video>.
      const facecamSrc = await setFacecamBlob(facecam);
      if (facecamSrc) proj.facecam.src = facecamSrc;
      // The screen track is captured silently; the microphone rides along with
      // the camera recording, so the audio has to be read from there.
      if (audio) proj.audioSrc = await setAudioBlob(audio);
      await decodePrepareFrame(0);
      return proj;
    },
    async restoreProject(id: string): Promise<Project | null> {
      const saved = await loadProjectRecord(id);
      if (!saved?.clip) return null;
      // Run the media back through the normal ingest so the decoder, audio sink
      // and facecam pipeline are all opened — loading only the JSON would give
      // a project whose blob URLs point at nothing decodable.
      const proj = await this.loadRecording(saved.clip, saved.facecam, saved.audio);
      // project.json is same-origin but not something we produced this session,
      // so its values are validated before they reach the renderer.
      return mergeSavedProject(proj, saved.project);
    },
    async getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
      return audioGetBuffer(project);
    },
    async exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
      return encodeProject(project, opts);
    },
  };
}
