/**
 * OWNER: DEV B — OPFS project persistence (ROADMAP-B.md Task 2.6).
 * Layout under navigator.storage.getDirectory():
 *   <project.id>/project.json · clip.webm · facecam.webm (optional)
 * Degrades gracefully off secure context.
 */

import { migrateProject, primaryMedia, type Media, type Project } from "@panoptik/schema";
import { formatDefaultProjectName } from "./naming";

export type ProjectSummary = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  updatedAt: number;
  bytes: number;
  exportedAt: number | null;
  hasPoster: boolean;
};

function isSecureContext(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage?.getDirectory === "function"
  );
}

/** Safely obtains the OPFS root directory handle without throwing unhandled rejections */
async function getStorageRoot(): Promise<FileSystemDirectoryHandle | null> {
  if (!isSecureContext()) return null;
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

/**
 * Blob URLs minted for the last loaded project. They pin the whole recording in
 * memory until revoked, so loading another project releases the previous one.
 */
let loadedUrls: string[] = [];

/**
 * Maps OPFS filename -> last saved blob URL to skip re-saving unchanged media
 * while ensuring new takes (e.g. reshoots) are always written.
 */
const savedBlobUrls = new Map<string, string>();

export function mintUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  loadedUrls.push(url);
  return url;
}

/** Release the blob URLs held by the previously loaded project. */
export function releaseLoadedProjectUrls(): void {
  loadedUrls.forEach((u) => URL.revokeObjectURL(u));
  loadedUrls = [];
}

/**
 * Persist a project. `includeMedia` copies the recordings themselves.
 * Edits rewrite the JSON and any newly added take blobs (e.g. reshots).
 */
export async function saveProject(
  project: Project,
  includeMedia = true,
  extra?: { history?: Project[]; historyIndex?: number },
): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;

  try {
    const projectDir = await root.getDirectoryHandle(
      project.id,
      { create: true },
    );

    // Collect all unique facecam sources across all segments
    const uniqueFacecamSrcs: string[] = [];
    const srcToFilename = new Map<string, string>();
    for (const seg of project.segments) {
      const src = seg.facecam?.src;
      if (src && typeof src === "string" && src.startsWith("blob:") && !srcToFilename.has(src)) {
        const idx = uniqueFacecamSrcs.length;
        const filename = idx === 0 ? "facecam.webm" : `facecam_take_${idx}.webm`;
        uniqueFacecamSrcs.push(src);
        srcToFilename.set(src, filename);
      }
    }

    // Save takes manifest
    const takesManifest = {
      segmentFacecams: project.segments.map((seg) =>
        seg.facecam?.src ? srcToFilename.get(seg.facecam.src) ?? null : null,
      ),
    };
    try {
      const takesFile = await projectDir.getFileHandle("takes.json", { create: true });
      const takesWritable = await takesFile.createWritable();
      await takesWritable.write(JSON.stringify(takesManifest));
      await takesWritable.close();
    } catch (e) {
      console.warn("Failed to write takes.json", e);
    }

    // Save project JSON
    const jsonFile = await projectDir.getFileHandle(
      "project.json",
      { create: true },
    );
    const jsonWritable = await jsonFile.createWritable();
    await jsonWritable.write(JSON.stringify(project));
    await jsonWritable.close();

    // Save history JSON if provided
    if (extra?.history && extra.history.length > 0) {
      try {
        const historyFile = await projectDir.getFileHandle(
          "history.json",
          { create: true },
        );
        const historyWritable = await historyFile.createWritable();
        await historyWritable.write(
          JSON.stringify({
            history: extra.history,
            historyIndex: extra.historyIndex ?? extra.history.length - 1,
          }),
        );
        await historyWritable.close();
      } catch {
        /* ignore history write error */
      }
    }

    // Helper to save a blob to a file in projectDir
    const saveBlobFile = async (filename: string, blobUrl: string, force = false) => {
      try {
        if (!force && savedBlobUrls.get(filename) === blobUrl) {
          return; // already saved this exact blobUrl to this filename
        }
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        const file = await projectDir.getFileHandle(filename, { create: true });
        const writable = await file.createWritable();
        await writable.write(blob);
        await writable.close();
        savedBlobUrls.set(filename, blobUrl);
      } catch (e) {
        console.warn(`Failed to save blob to ${filename}:`, e);
      }
    };

    // ── Background images ──
    const bgFileFor = new Map<string, number>();
    for (let i = 0; i < project.segments.length; i++) {
      const bg = project.segments[i]?.background;
      const name = `bg-${i}.bin`;
      const isOwnCopy = bg?.kind === "image" && bg.src.startsWith("blob:") && !bgFileFor.has(bg.src);

      if (!isOwnCopy) {
        await projectDir.removeEntry(name).catch(() => {});
        continue;
      }
      const src = (bg as { src: string }).src;
      try {
        const blob = await (await fetch(src)).blob();
        const existing = await projectDir
          .getFileHandle(name)
          .then((h) => h.getFile())
          .catch(() => null);
        if (!existing || existing.size !== blob.size) {
          const handle = await projectDir.getFileHandle(name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        bgFileFor.set(src, i);
      } catch {
        /* the URL was revoked before the save ran; it falls back on load */
      }
    }

    if (!includeMedia) return;

    for (const media of project.media) {
      if (!media.src.startsWith("blob:")) continue;
      await saveBlobFile(mediaFileName(project, media), media.src, true);
    }

    // Save audio blob if it's a blob URL
    if (project.audioSrc && project.audioSrc.startsWith("blob:")) {
      await saveBlobFile("audio.webm", project.audioSrc, includeMedia);
    }

    // Save all facecam takes
    for (const [src, filename] of srcToFilename.entries()) {
      await saveBlobFile(filename, src, includeMedia);
    }
  } catch (err) {
    console.warn("[OPFS] saveProject unavailable in this environment", err);
  }
}

/** Read a saved project back as blobs, so the decoder can be re-opened on them. */
export async function loadProjectRecord(id: string): Promise<{
  project: Project;
  media: Blob | null;
  mediaFiles?: (Blob | null)[];
  facecam: Blob | null;
  audio: Blob | null;
  facecamTakes?: Map<string, Blob>;
  segmentFacecamTakes?: (string | null)[];
  backgroundImages?: (Blob | null)[];
  history?: Project[];
  historyIndex?: number;
} | null> {
  const root = await getStorageRoot();
  if (!root) return null;
  try {
    const dir = await root.getDirectoryHandle(id);
    const json = await (await (await dir.getFileHandle("project.json")).getFile()).text();
    const project = migrateProject(JSON.parse(json));

    let history: Project[] | undefined;
    let historyIndex: number | undefined;
    try {
      const histJson = await (await (await dir.getFileHandle("history.json")).getFile()).text();
      const parsed = JSON.parse(histJson);
      if (Array.isArray(parsed.history)) {
        history = parsed.history.map((h: unknown) => migrateProject(h));
      }
      if (typeof parsed.historyIndex === "number") {
        historyIndex = parsed.historyIndex;
      }
    } catch {
      /* history file is optional */
    }

    const read = async (name: string): Promise<Blob | null> => {
      try {
        return await (await dir.getFileHandle(name)).getFile();
      } catch {
        return null;
      }
    };

    const mediaFiles: (Blob | null)[] = [];
    for (const media of project.media) {
      const blob = await read(mediaFileName(project, media));
      mediaFiles.push(blob);
    }
    const primaryMediaBlob = mediaFiles[0] ?? null;

    let facecamTakes: Map<string, Blob> | undefined;
    let segmentFacecamTakes: (string | null)[] | undefined;
    try {
      const takesFile = await (await dir.getFileHandle("takes.json")).getFile();
      const manifest = JSON.parse(await takesFile.text());
      segmentFacecamTakes = manifest.segmentFacecams;
      facecamTakes = new Map<string, Blob>();
      for (const filename of new Set(segmentFacecamTakes?.filter((f): f is string => Boolean(f)) ?? [])) {
        const blob = await read(filename);
        if (blob) facecamTakes.set(filename, blob);
      }
    } catch {
      /* no takes manifest */
    }

    const backgroundImages: (Blob | null)[] = [];
    for (let i = 0; i < project.segments.length; i++) {
      const bg = project.segments[i]?.background;
      if (bg?.kind === "image") {
        backgroundImages.push(await read(`bg-${i}.bin`));
      } else {
        backgroundImages.push(null);
      }
    }

    const primaryFacecamBlob = segmentFacecamTakes?.[0]
      ? facecamTakes?.get(segmentFacecamTakes[0]) ?? (await read("facecam.webm"))
      : await read("facecam.webm");

    return {
      project,
      media: primaryMediaBlob,
      mediaFiles: mediaFiles.every((b) => b !== null) ? mediaFiles : undefined,
      facecam: primaryFacecamBlob,
      audio: await read("audio.webm"),
      facecamTakes,
      segmentFacecamTakes,
      backgroundImages,
      history,
      historyIndex,
    };
  } catch {
    return null;
  }
}

/** Remove a saved project and everything under it. */
export async function deleteProject(id: string): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  try {
    await root.removeEntry(id, { recursive: true });
  } catch {
    /* already gone */
  }
}

export async function loadProject(id: string): Promise<Project | null> {
  const root = await getStorageRoot();
  if (!root) return null;

  releaseLoadedProjectUrls();

  try {
    const projectDir = await root.getDirectoryHandle(id);
    const jsonFile = await projectDir.getFileHandle("project.json");
    const file = await jsonFile.getFile();
    const text = await file.text();
    const project = migrateProject(JSON.parse(text));

    const read = async (name: string): Promise<Blob | null> => {
      try {
        return await (await projectDir.getFileHandle(name)).getFile();
      } catch {
        return null;
      }
    };

    for (const media of project.media) {
      const blob = await read(mediaFileName(project, media));
      if (blob) media.src = mintUrl(blob);
    }

    try {
      const takesFile = await (await projectDir.getFileHandle("takes.json")).getFile();
      const manifest = JSON.parse(await takesFile.text());
      const filenames: (string | null)[] = manifest.segmentFacecams ?? [];
      const filenameToUrl = new Map<string, string>();
      for (const [i, filename] of filenames.entries()) {
        if (!filename || !project.segments[i]?.facecam) continue;
        if (!filenameToUrl.has(filename)) {
          const blob = await read(filename);
          if (blob) filenameToUrl.set(filename, mintUrl(blob));
        }
        const url = filenameToUrl.get(filename);
        if (url) project.segments[i]!.facecam.src = url;
      }
    } catch {
      const facecamBlob = await read("facecam.webm");
      if (facecamBlob) {
        const facecamUrl = mintUrl(facecamBlob);
        for (const seg of project.segments) {
          if (seg.facecam) seg.facecam.src = facecamUrl;
        }
      }
    }

    const audioBlob = await read("audio.webm");
    if (audioBlob) {
      project.audioSrc = mintUrl(audioBlob);
    }

    for (let i = 0; i < project.segments.length; i++) {
      const seg = project.segments[i];
      if (seg?.background?.kind === "image") {
        const bgBlob = await read(`bg-${i}.bin`);
        if (bgBlob) {
          seg.background.src = mintUrl(bgBlob);
        }
      }
    }

    return project;
  } catch (err) {
    console.error("loadProject failed:", err);
    return null;
  }
}

function mediaFileName(project: Project, media: Media): string {
  return project.media[0]?.id === media.id ? "clip.webm" : `media-${media.id}.bin`;
}

function totalMediaDuration(project: Project): number {
  return project.media.reduce((sum, m) => sum + (Number.isFinite(m.duration) ? m.duration : 0), 0);
}

const POSTER = "poster.jpg";
const EXPORTED = "exported.json";

/**
 * Summaries for every stored project, newest first.
 */
export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const root = await getStorageRoot();
  if (!root) return [];
  const out: ProjectSummary[] = [];

  try {
    for await (const [name, handle] of (root as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      if (handle.kind !== "directory") continue;
      const dir = handle as FileSystemDirectoryHandle;
      try {
        const jsonHandle = await dir.getFileHandle("project.json");
        const jsonFile = await jsonHandle.getFile();
        const project = migrateProject(JSON.parse(await jsonFile.text()));

        let bytes = 0;
        let hasPoster = false;
        let exportedAt: number | null = null;
        for await (const [fileName, fh] of (dir as unknown as {
          entries: () => AsyncIterable<[string, FileSystemHandle]>;
        }).entries()) {
          if (fh.kind !== "file") continue;
          if (fileName === POSTER) hasPoster = true;
          try {
            const f = await (fh as FileSystemFileHandle).getFile();
            bytes += f.size;
            if (fileName === EXPORTED) {
              const parsed = JSON.parse(await f.text()) as { at?: unknown };
              if (typeof parsed.at === "number") exportedAt = parsed.at;
            }
          } catch {
            /* unreadable entry */
          }
        }

        const defaultName = formatDefaultProjectName(
          project.segments[0]?.facecam?.src ? "recording" : "clip",
          jsonFile.lastModified || Date.now(),
        );
        out.push({
          id: name,
          name: project.name && project.name.trim() ? project.name : defaultName,
          duration: totalMediaDuration(project),
          width: primaryMedia(project).width,
          height: primaryMedia(project).height,
          updatedAt: jsonFile.lastModified,
          bytes,
          exportedAt,
          hasPoster,
        });
      } catch {
        /* skip corrupt directories */
      }
    }
  } catch {
    return [];
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Cache a poster frame so the library does not re-decode video every visit. */
export async function savePoster(id: string, poster: Blob): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  try {
    const dir = await root.getDirectoryHandle(id, { create: true });
    const handle = await dir.getFileHandle(POSTER, { create: true });
    const writable = await handle.createWritable();
    await writable.write(poster);
    await writable.close();
  } catch {
    /* ignore */
  }
}

export async function loadPoster(id: string): Promise<Blob | null> {
  const root = await getStorageRoot();
  if (!root) return null;
  try {
    const dir = await root.getDirectoryHandle(id);
    return await (await dir.getFileHandle(POSTER)).getFile();
  } catch {
    return null;
  }
}

/** Record that a project has been exported, so drafts can be told apart. */
export async function markExported(id: string): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  try {
    const dir = await root.getDirectoryHandle(id, { create: true });
    const handle = await dir.getFileHandle(EXPORTED, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ at: Date.now() }));
    await writable.close();
  } catch {
    /* ignore */
  }
}

export async function renameProject(id: string, name: string): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  const trimmed = name.trim().slice(0, 120);
  try {
    const dir = await root.getDirectoryHandle(id);
    const jsonHandle = await dir.getFileHandle("project.json");
    const jsonFile = await jsonHandle.getFile();
    const project = migrateProject(JSON.parse(await jsonFile.text()));
    project.name = trimmed || undefined;
    const jsonWritable = await jsonHandle.createWritable();
    await jsonWritable.write(JSON.stringify(project));
    await jsonWritable.close();
  } catch (err) {
    console.warn(`[OPFS] Failed to rename project ${id}`, err);
  }
}

export async function listProjects(): Promise<{ id: string; name: string }[]> {
  const root = await getStorageRoot();
  if (!root) return [];
  const projects: { id: string; name: string }[] = [];

  try {
    for await (const [name, handle] of (root as any).entries()) {
      if (handle.kind === "directory") {
        try {
          const dir = handle as FileSystemDirectoryHandle;
          const jsonFile = await dir.getFileHandle("project.json");
          const file = await jsonFile.getFile();
          const project = migrateProject(JSON.parse(await file.text()));
          const fallbackName = formatDefaultProjectName(
            project.segments[0]?.facecam?.src ? "recording" : "clip",
            file.lastModified || Date.now(),
          );
          projects.push({
            id: name,
            name: project.name && project.name.trim() ? project.name : fallbackName,
          });
        } catch {
          // skip corrupt dirs
        }
      }
    }
  } catch {
    return [];
  }

  return projects;
}

// ── Audio track files (Phase 2) ─────────────────────────────────────────────
function audioExt(type: string): string {
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  return "webm";
}

export async function saveAudioTrackFile(projectId: string, trackId: string, blob: Blob): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  try {
    const dir = await root.getDirectoryHandle(projectId, { create: true });
    const audioDir = await dir.getDirectoryHandle("audio", { create: true });
    const fh = await audioDir.getFileHandle(`${trackId}.${audioExt(blob.type)}`, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  } catch (err) {
    console.warn("[OPFS] saveAudioTrackFile failed", err);
  }
}

export async function loadAudioTrackFiles(projectId: string): Promise<{ id: string; blob: Blob }[]> {
  const out: { id: string; blob: Blob }[] = [];
  const root = await getStorageRoot();
  if (!root) return out;
  try {
    const dir = await root.getDirectoryHandle(projectId);
    const audioDir = await dir.getDirectoryHandle("audio");
    for await (const [name, handle] of (audioDir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      if (handle.kind !== "file") continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ id: name.replace(/\.[^.]+$/, ""), blob: file });
    }
  } catch {
    /* no audio dir */
  }
  return out;
}

export async function deleteAudioTrackFile(projectId: string, trackId: string): Promise<void> {
  const root = await getStorageRoot();
  if (!root) return;
  try {
    const dir = await root.getDirectoryHandle(projectId);
    const audioDir = await dir.getDirectoryHandle("audio");
    const doomed: string[] = [];
    for await (const [name, handle] of (audioDir as unknown as {
      entries: () => AsyncIterable<[string, FileSystemHandle]>;
    }).entries()) {
      if (handle.kind === "file" && name.startsWith(trackId)) doomed.push(name);
    }
    for (const name of doomed) await audioDir.removeEntry(name);
  } catch {
    /* nothing stored */
  }
}
