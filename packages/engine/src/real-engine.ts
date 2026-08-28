/**
 * OWNER: DEV A — Concrete MediaEngine implementation.
 * Wires decode.ts → render.ts → audio.ts into the MediaEngine interface.
 * Preview and export share renderFrame + prepareFrame.
 */
import type { Project } from "@panoptik/schema";
import type { MediaEngine } from "./index";
import type { ExportFrameOpts } from "./encode";
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
import { loadProjectRecord, mintUrl } from "./opfs";
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
    async prepareAllFrames(t: number, fcT?: number): Promise<void> {
      return prepareAllFrames(t, fcT);
    },
    renderFrame(ctx, project, t, options) {
      renderFrame(ctx, project, t, options);
    },
    async loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null): Promise<Project> {
      // Capture/ingest boundary: B's record.ts captures blobs, we demux screen blob as clip.
      const screenFile = new File([screen], "screen.webm", { type: screen.type || "video/webm" });
      const proj = await decodeLoadClip(screenFile);
      // After loadClip: it tears down first, which revokes the previous take's
      // facecam URL and drops its cached <video>.
      const facecamSrc = await setFacecamBlob(facecam);
      if (facecamSrc) proj.segments[0]!.facecam.src = facecamSrc;
      // The screen track is captured silently; the microphone rides along with
      // the camera recording, so the audio has to be read from there.
      if (audio) proj.audioSrc = await setAudioBlob(audio);
      await decodePrepareFrame(0);
      return proj;
    },
    async restoreProject(id: string): Promise<Project | null> {
      const saved = await loadProjectRecord(id);
      if (!saved?.media) return null;
      // Run the media back through the normal ingest so the decoder, audio sink
      // and facecam pipeline are all opened — loading only the JSON would give
      // a project whose blob URLs point at nothing decodable.
      const proj = await this.loadRecording(saved.media, saved.facecam, saved.audio);

      // Mint blob URLs for all loaded facecam takes
      const mintedTakes = new Map<string, string>();
      if (saved.facecamTakes) {
        for (const [filename, blob] of saved.facecamTakes.entries()) {
          mintedTakes.set(filename, mintUrl(blob));
        }
      }

      // Map each saved segment to its specific minted take URL
      const savedSegs = saved.project.segments ?? [];
      const segmentFacecamSrcs: (string | null)[] = savedSegs.map((_, i) => {
        const filename = saved.segmentFacecamTakes?.[i];
        if (filename && mintedTakes.has(filename)) {
          return mintedTakes.get(filename)!;
        }
        return proj.segments[0]?.facecam.src ?? null;
      });

      // project.json is same-origin but not something we produced this session,
      // so its values are validated before they reach the renderer. The saved
      // edits (annotations, settings) are re-applied per-segment over the
      // freshly re-opened media.
      return mergeSavedProject(proj, saved.project, segmentFacecamSrcs);
    },
    async getAudioBuffer(project: Project): Promise<AudioBuffer | null> {
      return audioGetBuffer(project);
    },
    async setFacecamBlob(facecam: Blob | null, audio?: Blob | null): Promise<string | null> {
      const facecamSrc = await setFacecamBlob(facecam);
      if (audio) {
        await setAudioBlob(audio);
      }
      return facecamSrc;
    },
    async exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob> {
      return encodeProject(project, opts);
    },
  };
}
