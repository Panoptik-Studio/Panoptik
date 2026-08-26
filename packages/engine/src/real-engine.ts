/**
 * OWNER: DEV A — Concrete MediaEngine implementation.
 * Wires decode.ts → render.ts → audio.ts into the MediaEngine interface.
 * Preview and export share renderFrame + prepareFrame.
 */
import type { ExportOpts, Project } from "@panoptik/schema";
import type { MediaEngine } from "./index";
import { loadClip as decodeLoadClip, prepareFrame as decodePrepareFrame } from "./decode";
import { renderFrame } from "./render";

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
      decodePrepareFrame(t).catch(() => {});
      renderFrame(ctx, project, t);
    },
    async loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project> {
      // Day 3 integration — for now, create a minimal project from the screen blob
      const file = new File([screen], "recording.webm", { type: "video/webm" });
      return decodeLoadClip(file);
    },
    async getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
      // Day 2 backend — stub until audio.ts is fully wired
      return null;
    },
    async exportProject(project: Project, opts: ExportOpts): Promise<Blob> {
      // Day 3 backend — stub
      return new Blob(["not yet"], { type: "video/mp4" });
    },
  };
}
