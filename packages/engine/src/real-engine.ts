/**
 * OWNER: DEV A — Concrete MediaEngine implementation.
 * Wires decode.ts → render.ts → audio.ts into the MediaEngine interface.
 * Preview and export share renderFrame + prepareFrame.
 */
import type { ExportOpts, Project } from "@panoptik/schema";
import type { MediaEngine } from "./index";
import { loadClip as decodeLoadClip, prepareFrame as decodePrepareFrame } from "./decode";
import { renderFrame } from "./render";
import { getAudioBuffer as audioGetBuffer } from "./audio";

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
    async loadRecording(screen: Blob, facecam: Blob | null, _audio: Blob | null): Promise<Project> {
      // Capture/ingest boundary: B's record.ts captures blobs, we demux screen blob as clip.
      const screenFile = new File([screen], "screen.webm", { type: screen.type || "video/webm" });
      const proj = await decodeLoadClip(screenFile);
      if (facecam) {
        proj.facecam.src = URL.createObjectURL(facecam);
      }
      await decodePrepareFrame(0);
      return proj;
    },
    async getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
      return audioGetBuffer(project);
    },
    async exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
      // Day 3 backend — stub until encode.ts lands
      void project;
      void opts;
      return new Blob(["not yet"], { type: "video/mp4" });
    },
  };
}
