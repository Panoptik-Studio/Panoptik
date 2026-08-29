/**
 * OWNER: DEV B — OPFS project persistence (ROADMAP-B.md Task 2.6).
 * Layout under navigator.storage.getDirectory():
 *   <project.id>/project.json · clip.webm · facecam.webm (optional)
 * Degrades gracefully off secure context.
 */

import { migrateProject, type Project } from "@panoptik/schema";

function isSecureContext(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    "storage" in navigator
  );
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
  if (!isSecureContext()) return;

  const root = await navigator.storage.getDirectory();
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
  //
  // Deliberately above the includeMedia gate. Media is only copied on a
  // project's first save, but a background is picked long after that, so
  // gating these behind it meant a chosen image was never stored and quietly
  // vanished on reload.
  //
  // One file per distinct source, not per segment: applying one image to every
  // clip would otherwise store the same picture once per segment. Files whose
  // segment no longer uses an image are removed, so switching back to a colour
  // does not leave the picture behind forever.
  const bgFileFor = new Map<string, number>();
  for (let i = 0; i < project.segments.length; i++) {
    const bg = project.segments[i]?.background;
    const name = `bg-${i}.bin`;
    const isOwnCopy = bg?.kind === "image" && bg.src.startsWith("blob:") && !bgFileFor.has(bg.src);

    if (!isOwnCopy) {
      // Either not an image any more, or a duplicate of one already written.
      await projectDir.removeEntry(name).catch(() => {});
      continue;
    }
    const src = (bg as { src: string }).src;
    try {
      const blob = await (await fetch(src)).blob();
      // Autosave runs on a debounce during editing; rewriting a large picture
      // every time would thrash OPFS for no gain. Size is enough to tell an
      // unchanged file from a newly chosen one.
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

  // Save clip blob if it's a blob URL
  if (project.media.src.startsWith("blob:")) {
    if (includeMedia) {
      await saveBlobFile("clip.webm", project.media.src, true);
    }
  }

  // Save audio blob if it's a blob URL
  if (project.audioSrc && project.audioSrc.startsWith("blob:")) {
    await saveBlobFile("audio.webm", project.audioSrc, includeMedia);
  }

  // Save all facecam takes
  for (const [src, filename] of srcToFilename.entries()) {
    await saveBlobFile(filename, src, includeMedia);
  }
}

/** Read a saved project back as blobs, so the decoder can be re-opened on them. */
export async function loadProjectRecord(id: string): Promise<{
  project: Project;
  media: Blob | null;
  facecam: Blob | null;
  audio: Blob | null;
  facecamTakes?: Map<string, Blob>;
  segmentFacecamTakes?: (string | null)[];
  /** Per-segment background image, index-aligned with project.segments. */
  backgroundImages?: (Blob | null)[];
  history?: Project[];
  historyIndex?: number;
} | null> {
  if (!isSecureContext()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(id);
    const json = await (await (await dir.getFileHandle("project.json")).getFile()).text();
    // Old v1.1 records get upgraded to the v1.2 segment model on read.
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

    let segmentFacecamTakes: (string | null)[] | undefined;
    const facecamTakes = new Map<string, Blob>();
    try {
      const takesJson = await (await (await dir.getFileHandle("takes.json")).getFile()).text();
      const parsedTakes = JSON.parse(takesJson);
      if (Array.isArray(parsedTakes.segmentFacecams)) {
        segmentFacecamTakes = parsedTakes.segmentFacecams;
        for (const filename of new Set(parsedTakes.segmentFacecams as (string | null)[])) {
          if (filename) {
            const blob = await read(filename);
            if (blob) facecamTakes.set(filename, blob);
          }
        }
      }
    } catch {
      // takes.json not present
    }

    const primaryFacecamBlob = await read("facecam.webm");
    if (primaryFacecamBlob && !facecamTakes.has("facecam.webm")) {
      facecamTakes.set("facecam.webm", primaryFacecamBlob);
    }

    // Indexed to match project.segments, so a restored background lands on the
    // segment it belonged to. Segments that shared one image share one stored
    // file, so they resolve to the first segment that used it — and to the same
    // Blob object, which lets the caller mint a single URL for all of them.
    const imageSrcOf = (i: number): string | null => {
      const bg = project.segments[i]?.background;
      return bg?.kind === "image" ? bg.src : null;
    };
    const fileCache = new Map<number, Blob | null>();
    const readOnce = async (i: number): Promise<Blob | null> => {
      if (!fileCache.has(i)) fileCache.set(i, await read(`bg-${i}.bin`));
      return fileCache.get(i) ?? null;
    };

    const backgroundImages: (Blob | null)[] = [];
    for (let i = 0; i < project.segments.length; i++) {
      const src = imageSrcOf(i);
      if (!src) {
        backgroundImages.push(null);
        continue;
      }
      let owner = i;
      for (let j = 0; j < i; j++) {
        if (imageSrcOf(j) === src) {
          owner = j;
          break;
        }
      }
      backgroundImages.push(await readOnce(owner));
    }

    return {
      project,
      media: await read("clip.webm"),
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
  if (!isSecureContext()) return;
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(id, { recursive: true });
  } catch {
    /* already gone */
  }
}

export async function loadProject(
  id: string,
): Promise<Project | null> {
  if (!isSecureContext()) return null;

  releaseLoadedProjectUrls();

  try {
    const root = await navigator.storage.getDirectory();
    const projectDir = await root.getDirectoryHandle(id);

    const jsonFile = await projectDir.getFileHandle(
      "project.json",
    );
    const file = await jsonFile.getFile();
    const text = await file.text();
    let project = migrateProject(JSON.parse(text));

    // Restore clip blob URL from OPFS
    try {
      const clipFile = await projectDir.getFileHandle(
        "clip.webm",
      );
      const clipBlob = await clipFile.getFile();
      project = { ...project, media: { ...project.media, src: mintUrl(clipBlob) } };
    } catch {
      // clip not saved — keep existing src
    }

    // Restore audio blob URL from OPFS
    try {
      const audioFile = await projectDir.getFileHandle(
        "audio.webm",
      );
      const audioBlob = await audioFile.getFile();
      project = { ...project, audioSrc: mintUrl(audioBlob) };
    } catch {
      // no audio
    }

    // Restore facecam blob URLs from OPFS
    let segmentFacecamFilenames: (string | null)[] | null = null;
    try {
      const takesFile = await projectDir.getFileHandle("takes.json");
      const takesText = await (await takesFile.getFile()).text();
      const parsedTakes = JSON.parse(takesText);
      if (Array.isArray(parsedTakes.segmentFacecams)) {
        segmentFacecamFilenames = parsedTakes.segmentFacecams;
      }
    } catch {}

    const fileToUrl = new Map<string, string>();
    const getOrMint = async (filename: string): Promise<string | null> => {
      if (fileToUrl.has(filename)) return fileToUrl.get(filename)!;
      try {
        const f = await projectDir.getFileHandle(filename);
        const b = await f.getFile();
        const url = mintUrl(b);
        fileToUrl.set(filename, url);
        return url;
      } catch {
        return null;
      }
    };

    let defaultFacecamUrl: string | null = null;
    try {
      const defaultFacecam = await getOrMint("facecam.webm");
      defaultFacecamUrl = defaultFacecam;
    } catch {}

    project = {
      ...project,
      segments: await Promise.all(
        project.segments.map(async (seg, i) => {
          const targetFilename = segmentFacecamFilenames?.[i];
          const segUrl = targetFilename ? await getOrMint(targetFilename) : defaultFacecamUrl;
          return {
            ...seg,
            facecam: {
              ...seg.facecam,
              src: segUrl ?? seg.facecam.src,
            },
          };
        }),
      ),
    };

    return project;
  } catch {
    return null;
  }
}

/** What the library grid needs to draw a card, without opening the media. */
export type ProjectSummary = {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  /** project.json's mtime — when the project was last edited. */
  updatedAt: number;
  /** Everything the project occupies on disk. */
  bytes: number;
  /** When it was last exported, or null if it never has been. */
  exportedAt: number | null;
  hasPoster: boolean;
};

const POSTER = "poster.jpg";
const EXPORTED = "exported.json";

/**
 * Summaries for every stored project, newest first.
 *
 * Reads only the metadata files: opening the media of every project just to
 * draw a grid would decode the user's whole library on page load.
 */
export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  if (!isSecureContext()) return [];
  const root = await navigator.storage.getDirectory();
  const out: ProjectSummary[] = [];

  for await (const [name, handle] of (root as unknown as {
    entries: () => AsyncIterable<[string, FileSystemHandle]>;
  }).entries()) {
    if (handle.kind !== "directory") continue;
    const dir = handle as FileSystemDirectoryHandle;
    try {
      const jsonHandle = await dir.getFileHandle("project.json");
      const jsonFile = await jsonHandle.getFile();
      const project = migrateProject(JSON.parse(await jsonFile.text()));

      // Size and poster presence come from walking the directory once.
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
          /* unreadable entry contributes nothing */
        }
      }

      out.push({
        id: name,
        name: project.name && project.name.trim() ? project.name : "Untitled clip",
        duration: project.media.duration,
        width: project.media.width,
        height: project.media.height,
        updatedAt: jsonFile.lastModified,
        bytes,
        exportedAt,
        hasPoster,
      });
    } catch {
      /* skip corrupt or half-written directories */
    }
  }

  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Cache a poster frame so the library does not re-decode video every visit. */
export async function savePoster(id: string, poster: Blob): Promise<void> {
  if (!isSecureContext()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(id, { create: true });
    const handle = await dir.getFileHandle(POSTER, { create: true });
    const writable = await handle.createWritable();
    await writable.write(poster);
    await writable.close();
  } catch {
    /* a missing poster just means the card regenerates it next time */
  }
}

export async function loadPoster(id: string): Promise<Blob | null> {
  if (!isSecureContext()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(id);
    return await (await dir.getFileHandle(POSTER)).getFile();
  } catch {
    return null;
  }
}

/** Record that a project has been exported, so drafts can be told apart. */
export async function markExported(id: string): Promise<void> {
  if (!isSecureContext()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(id, { create: true });
    const handle = await dir.getFileHandle(EXPORTED, { create: true });
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify({ at: Date.now() }));
    await writable.close();
  } catch {
    /* the marker is a nicety; failing to write it must not fail an export */
  }
}

export async function listProjects(): Promise<
  { id: string; name: string }[]
> {
  if (!isSecureContext()) return [];

  const root = await navigator.storage.getDirectory();
  const projects: { id: string; name: string }[] = [];

  for await (const [name, handle] of (root as any).entries()) {
    if (handle.kind === "directory") {
      try {
        const dir =
          handle as FileSystemDirectoryHandle;
        const jsonFile = await dir.getFileHandle(
          "project.json",
        );
        const file = await jsonFile.getFile();
        const project = migrateProject(
          JSON.parse(await file.text()),
        );
        projects.push({
          id: name,
          name: `Clip ${project.media.duration.toFixed(0)}s`,
        });
      } catch {
        // skip corrupt/empty dirs
      }
    }
  }

  return projects;
}
