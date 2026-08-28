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
  setAudioBlob,
  setFacecamBlob,
} from "./decode";
import { renderFrame } from "./render";
import { getAudioBuffer as audioGetBuffer } from "./audio";
import { exportProject as encodeProject } from "./encode";

export function createRealEngine(): MediaEngine {
  return {
    async loadClip(file: File): Promise<Project> {
      const proj = await decodeLoadClip(file);
      await decodePrepareFrame(0);
      return proj;
    },
    async prepareFrame(t: number): Promise<void> {
      return decodePrepareFrame(t);
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
      const facecamSrc = setFacecamBlob(facecam);
      if (facecamSrc) proj.facecam.src = facecamSrc;
      // The screen track is captured silently; the microphone rides along with
      // the camera recording, so the audio has to be read from there.
      if (audio) await setAudioBlob(audio);
      await decodePrepareFrame(0);
      return proj;
    },
    async getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
      return audioGetBuffer(project);
    },
    async exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
      return encodeProject(project, opts);
    },
  };
}
