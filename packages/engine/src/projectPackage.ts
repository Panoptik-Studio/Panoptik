/**
 * Project Package Export & Import for Panoptik.
 *
 * Creates self-contained, portable `.panoptik` project bundles containing:
 * - Full Project schema (segments, zoom points, text overlays, speech transcript, click telemetry, camera settings)
 * - Undo/Redo history stack
 * - Media video blobs (all clips for multiclip)
 * - Facecam recording takes
 * - Dedicated audio track files (voiceover / music)
 * - Custom backdrop images
 */

import { migrateProject, type Project } from "@panoptik/schema";
import { saveProject, saveAudioTrackFile, loadProjectRecord, loadAudioTrackFiles } from "./opfs";
import { formatDefaultProjectName } from "./naming";

export interface PanoptikProjectBundle {
  format: "panoptik-project";
  version: 1;
  exportedAt: string;
  project: Project;
  history?: Project[];
  historyIndex?: number;
  mediaFiles: Array<{
    id: string;
    filename: string;
    type: string;
    dataUrl: string;
  }>;
  facecamTakes: Array<{
    segmentIndex?: number;
    filename: string;
    type: string;
    dataUrl: string;
  }>;
  audioTracks: Array<{
    id: string;
    filename: string;
    type: string;
    dataUrl: string;
  }>;
  backgroundImages: Array<{
    segmentIndex: number;
    filename: string;
    type: string;
    dataUrl: string;
  }>;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(",");
  const mimeMatch = parts[0]?.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const bstr = atob(parts[1] || "");
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Serializes a project and all associated media assets into a PanoptikProjectBundle.
 */
export async function exportProjectBundle(
  project: Project,
  extra?: { history?: Project[]; historyIndex?: number },
): Promise<{ bundle: PanoptikProjectBundle; blob: Blob; filename: string }> {
  // 1. Try to fetch stored record from OPFS first for clean raw blobs
  const opfsRecord = await loadProjectRecord(project.id).catch(() => null);
  const opfsAudioTracks = await loadAudioTrackFiles(project.id).catch(() => []);

  // 2. Collect media clips
  const mediaFiles: PanoptikProjectBundle["mediaFiles"] = [];
  for (let i = 0; i < project.media.length; i++) {
    const media = project.media[i]!;
    let blob: Blob | null = opfsRecord?.mediaFiles?.[i] ?? (i === 0 ? opfsRecord?.media ?? null : null);
    if (!blob && media.src) {
      try {
        const res = await fetch(media.src);
        blob = await res.blob();
      } catch (e) {
        console.warn(`[ExportProject] Could not fetch media src for ${media.id}`, e);
      }
    }
    if (blob) {
      const dataUrl = await blobToDataUrl(blob);
      mediaFiles.push({
        id: media.id,
        filename: i === 0 ? "clip.webm" : `clip_${media.id}.webm`,
        type: blob.type || "video/webm",
        dataUrl,
      });
    }
  }

  // 3. Collect facecam takes
  const facecamTakes: PanoptikProjectBundle["facecamTakes"] = [];
  const handledFacecamUrls = new Set<string>();

  if (opfsRecord?.facecamTakes && opfsRecord.facecamTakes.size > 0) {
    for (const [filename, blob] of opfsRecord.facecamTakes.entries()) {
      const dataUrl = await blobToDataUrl(blob);
      facecamTakes.push({
        filename,
        type: blob.type || "video/webm",
        dataUrl,
      });
    }
  } else {
    for (let i = 0; i < project.segments.length; i++) {
      const fcSrc = project.segments[i]?.facecam?.src;
      if (fcSrc && typeof fcSrc === "string" && !handledFacecamUrls.has(fcSrc)) {
        handledFacecamUrls.add(fcSrc);
        try {
          const res = await fetch(fcSrc);
          const blob = await res.blob();
          const dataUrl = await blobToDataUrl(blob);
          const filename = facecamTakes.length === 0 ? "facecam.webm" : `facecam_take_${facecamTakes.length}.webm`;
          facecamTakes.push({
            filename,
            type: blob.type || "video/webm",
            dataUrl,
          });
        } catch (e) {
          console.warn("[ExportProject] Could not fetch facecam take", e);
        }
      }
    }
  }

  // 4. Collect audio tracks
  const audioTracks: PanoptikProjectBundle["audioTracks"] = [];
  for (const track of project.audioTracks ?? []) {
    let blob: Blob | null = opfsAudioTracks.find((f) => f.id === track.id)?.blob ?? null;
    if (!blob && track.src) {
      try {
        const res = await fetch(track.src);
        blob = await res.blob();
      } catch (e) {
        console.warn(`[ExportProject] Could not fetch audio track ${track.id}`, e);
      }
    }
    if (blob) {
      const dataUrl = await blobToDataUrl(blob);
      audioTracks.push({
        id: track.id,
        filename: `${track.id}.webm`,
        type: blob.type || "audio/webm",
        dataUrl,
      });
    }
  }

  // 5. Collect background images
  const backgroundImages: PanoptikProjectBundle["backgroundImages"] = [];
  for (let i = 0; i < project.segments.length; i++) {
    const bg = project.segments[i]?.background;
    if (bg?.kind === "image" && bg.src) {
      let blob: Blob | null = opfsRecord?.backgroundImages?.[i] ?? null;
      if (!blob) {
        try {
          const res = await fetch(bg.src);
          blob = await res.blob();
        } catch (e) {
          console.warn(`[ExportProject] Could not fetch bg image for segment ${i}`, e);
        }
      }
      if (blob) {
        const dataUrl = await blobToDataUrl(blob);
        backgroundImages.push({
          segmentIndex: i,
          filename: `bg-${i}.bin`,
          type: blob.type || "image/png",
          dataUrl,
        });
      }
    }
  }

  // 6. Build the clean project bundle JSON
  const cleanProject: Project = {
    ...project,
  };

  const history = extra?.history ?? opfsRecord?.history ?? undefined;
  const historyIndex = extra?.historyIndex ?? opfsRecord?.historyIndex ?? undefined;

  const bundle: PanoptikProjectBundle = {
    format: "panoptik-project",
    version: 1,
    exportedAt: new Date().toISOString(),
    project: cleanProject,
    history,
    historyIndex,
    mediaFiles,
    facecamTakes,
    audioTracks,
    backgroundImages,
  };

  const jsonString = JSON.stringify(bundle, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });

  const rawName = project.name?.trim() || formatDefaultProjectName(project.segments[0]?.facecam?.src ? "recording" : "clip");
  const sanitizedName = rawName.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_");
  const filename = `${sanitizedName}.panoptik`;

  return { bundle, blob, filename };
}

/**
 * Triggers a browser file download for the project package.
 */
export async function downloadProjectPackage(
  project: Project,
  extra?: { history?: Project[]; historyIndex?: number },
): Promise<string> {
  const { blob, filename } = await exportProjectBundle(project, extra);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return filename;
}

/**
 * Imports a `.panoptik` project file, unpacks its media blobs, and saves it into OPFS.
 */
export async function importProjectBundle(
  fileOrText: File | string,
): Promise<{ project: Project; projectId: string; filename?: string; history?: Project[]; historyIndex?: number }> {
  let text: string;
  let inputFileName: string | undefined;

  if (typeof fileOrText === "string") {
    text = fileOrText;
  } else {
    inputFileName = fileOrText.name;
    text = await fileOrText.text();
  }

  const parsed = JSON.parse(text);
  if (!parsed || (parsed.format !== "panoptik-project" && !parsed.segments && !parsed.project)) {
    throw new Error("Invalid Panoptik project file format.");
  }

  // Handle standard bundle vs raw Project JSON
  const bundle: PanoptikProjectBundle =
    parsed.format === "panoptik-project"
      ? (parsed as PanoptikProjectBundle)
      : {
          format: "panoptik-project",
          version: 1,
          exportedAt: new Date().toISOString(),
          project: parsed.project ? migrateProject(parsed.project) : migrateProject(parsed),
          mediaFiles: [],
          facecamTakes: [],
          audioTracks: [],
          backgroundImages: [],
        };

  const project = migrateProject(bundle.project);

  // Mint new ID if missing
  if (!project.id) {
    project.id = crypto.randomUUID();
  }

  // Re-mint object URLs for media clips
  const mediaBlobs = new Map<string, Blob>();
  for (const m of bundle.mediaFiles ?? []) {
    if (m.dataUrl) {
      const blob = dataUrlToBlob(m.dataUrl);
      mediaBlobs.set(m.id, blob);
    }
  }

  project.media = project.media.map((m) => {
    const blob = mediaBlobs.get(m.id);
    return {
      ...m,
      src: blob ? URL.createObjectURL(blob) : m.src,
    };
  });

  // Re-mint object URLs for facecam takes
  for (const fc of bundle.facecamTakes ?? []) {
    const idx = fc.segmentIndex ?? 0;
    if (fc.dataUrl && project.segments[idx]) {
      const blob = dataUrlToBlob(fc.dataUrl);
      const url = URL.createObjectURL(blob);
      const seg = project.segments[idx]!;
      if (seg.facecam) {
        seg.facecam.src = url;
      }
    }
  }

  // Re-mint object URLs for audio tracks
  for (const track of bundle.audioTracks ?? []) {
    if (track.dataUrl) {
      const blob = dataUrlToBlob(track.dataUrl);
      const url = URL.createObjectURL(blob);
      const matchingTrack = project.audioTracks?.find((t) => t.id === track.id);
      if (matchingTrack) {
        matchingTrack.src = url;
      }
      await saveAudioTrackFile(project.id, track.id, blob).catch(() => {});
    }
  }

  // Re-mint object URLs for background images
  for (const bg of bundle.backgroundImages ?? []) {
    if (bg.dataUrl && project.segments[bg.segmentIndex]) {
      const blob = dataUrlToBlob(bg.dataUrl);
      const url = URL.createObjectURL(blob);
      const seg = project.segments[bg.segmentIndex]!;
      if (seg.background?.kind === "image") {
        seg.background.src = url;
      }
    }
  }

  // Save into OPFS with all media (graceful fallback in restricted environments)
  try {
    await saveProject(project, true, {
      history: bundle.history,
      historyIndex: bundle.historyIndex,
    });
  } catch (err) {
    console.warn("[ProjectPackage] OPFS save skipped (environment restricted)", err);
  }

  return {
    project,
    projectId: project.id,
    filename: inputFileName,
    history: bundle.history,
    historyIndex: bundle.historyIndex,
  };
}
