/**
 * OWNER: DEV A — Concrete MediaEngine implementation.
 * Wires decode.ts → render.ts → audio.ts into the MediaEngine interface.
 * Preview and export share renderFrame + prepareFrame.
 */
import type { Media, Project, Segment } from "@panoptik/schema";
import type { MediaEngine } from "./index";
import type { ExportFrameOpts } from "./encode";
import {
  loadClip as decodeLoadClip,
  importClip as decodeImportClip,
  prepareFrame as decodePrepareFrame,
  prepareAllFrames,
  setAudioBlob,
  setFacecamBlob,
  activateMedia as decodeActivateMedia } from "./decode";
import { renderFrame } from "./render";
import { getAudioBuffer as audioGetBuffer } from "./audio";
import { exportProject as encodeProject } from "./encode";
import { loadProjectRecord, mintUrl } from "./opfs";
import { mergeSavedProject } from "./sanitize";
import { formatDefaultProjectName } from "./naming";

export function createRealEngine(): MediaEngine {
  return {
    async loadClip(file: File): Promise<Project> {
      const proj = await decodeLoadClip(file);
      await decodePrepareFrame(0);
      return proj;
    },
    async importClip(file: File) {
      const media = await decodeImportClip(file);
      // A full-clip segment at 1x, same defaults loadClip produces — the store
      // appends it to the end of the timeline.
      const segment: Segment = {
        id: crypto.randomUUID(),
        mediaId: media.id,
        srcStart: 0,
        srcEnd: media.duration,
        speed: 1,
        stagePadding: 0,
        aspectPreset: "source",
        background: { kind: "solid", color: "#000000" },
        facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
        zoomPoints: [], stagedZoomPoints: [], textOverlays: [], stagedTextOverlays: [] };
      return { media, segment };
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
    async loadRecording(screen: Blob, facecam: Blob | null, audio: Blob | null, opts?: { append?: boolean }): Promise<Project> {
      // Capture/ingest boundary: B's record.ts captures blobs, we demux screen blob as clip.
      const screenFile = new File([screen], "screen.webm", { type: screen.type || "video/webm" });
      // Append mode keeps the previous project's blob URLs alive — a full
      // teardown would revoke the other clips' media srcs.
      const proj = await decodeLoadClip(screenFile, opts?.append ? { append: true } : undefined);
      if (!opts?.append) {
        proj.name = formatDefaultProjectName("recording");
      }
      // After loadClip: it tears down first, which revokes the previous take's
      // facecam URL and drops its cached <video>.
      const facecamSrc = await setFacecamBlob(facecam);
      if (facecamSrc) {
        proj.segments[0]!.facecam.src = facecamSrc;
        proj.audioSrc = null;
        if (audio) await setAudioBlob(audio);
      } else if (audio) {
        // Screen-only recording with narration
        proj.audioSrc = await setAudioBlob(audio);
      } else {
        proj.audioSrc = null;
      }
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

      // Multiclip: mint blob URLs for every additional clip and join them to the
      // demuxed project so mergeSavedProject restores the full media array (its
      // per-clip merge maps over fresh.media). Decode opens them lazily when a
      // segment from them becomes active.
      if (saved.project.media && saved.project.media.length > 1) {
        const additional: (Media & { src: string })[] = [];
        for (let i = 1; i < saved.project.media.length; i++) {
          const blob = saved.mediaFiles?.[i];
          const stored = saved.project.media[i];
          if (blob && stored) {
            additional.push({
              ...(stored as Media),
              id: stored.id ?? `m${i + 1}`,
              src: mintUrl(blob) });
          }
        }
        if (additional.length > 0) {
          proj.media = [...proj.media, ...additional];
        }
      }

      // Mint blob URLs for all loaded facecam takes
      const mintedTakes = new Map<string, string>();
      if (saved.facecamTakes) {
        for (const [filename, blob] of saved.facecamTakes.entries()) {
          mintedTakes.set(filename, mintUrl(blob));
        }
      }

      // Map each saved segment to its specific minted take URL
      const savedSegs = saved.project.segments ?? [];
      const segmentFacecamSrcs: (string | null)[] = savedSegs.map((seg, i) => {
        const filename = saved.segmentFacecamTakes?.[i];
        if (filename && mintedTakes.has(filename)) {
          return mintedTakes.get(filename)!;
        }
        if (!seg.facecam || seg.facecam.src === null) {
          return null;
        }
        return proj.segments[0]?.facecam.src ?? null;
      });

      // Background images come back as blobs and get fresh object URLs here.
      // sanitize rejects the src stored in JSON, so this is the only way one
      // reaches the renderer.
      // One URL per distinct blob: segments that shared an image on save come
      // back sharing the same Blob, and should share its URL too.
      const urlForBlob = new Map<Blob, string>();
      const backgroundImageUrls = (saved.backgroundImages ?? []).map((blob) => {
        if (!blob) return null;
        let url = urlForBlob.get(blob);
        if (!url) {
          url = URL.createObjectURL(blob);
          urlForBlob.set(blob, url);
        }
        return url;
      });
      return mergeSavedProject(proj, saved.project, segmentFacecamSrcs, backgroundImageUrls);
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
    async activateMedia(mediaId: string, src: string | null): Promise<void> {
      return decodeActivateMedia(mediaId, src);
    },
    async exportProject(project: Project, opts: ExportFrameOpts): Promise<Blob> {
      return encodeProject(project, opts);
    } };
}