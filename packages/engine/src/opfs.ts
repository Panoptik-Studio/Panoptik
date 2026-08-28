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
      if (!force) {
        // Check if file already exists
        try {
          await projectDir.getFileHandle(filename);
          return; // already saved
        } catch {
          // file does not exist, proceed to save
        }
      }
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      const file = await projectDir.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (e) {
      console.warn(`Failed to save blob to ${filename}:`, e);
    }
  };

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
        const hist = parsed.history.map(migrateProject);
        history = hist;
        historyIndex =
          typeof parsed.historyIndex === "number"
            ? parsed.historyIndex
            : hist.length - 1;
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

    return {
      project,
      media: await read("clip.webm"),
      facecam: primaryFacecamBlob,
      audio: await read("audio.webm"),
      facecamTakes,
      segmentFacecamTakes,
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
