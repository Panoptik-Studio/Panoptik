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
 * Persist a project. `includeMedia` copies the recordings themselves, which is
 * expensive — edits only need the JSON rewritten, so autosave passes false.
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

  if (!includeMedia) return;

  // Save clip blob if it's a blob URL
  if (project.media.src.startsWith("blob:")) {
    const response = await fetch(project.media.src);
    const blob = await response.blob();
    const clipFile = await projectDir.getFileHandle(
      "clip.webm",
      { create: true },
    );
    const clipWritable = await clipFile.createWritable();
    await clipWritable.write(blob);
    await clipWritable.close();
  }

  // The active (first) segment's facecam, if present and a blob URL.
  const facecamSrc = project.segments[0]?.facecam.src ?? null;
  if (facecamSrc && facecamSrc.startsWith("blob:")) {
    const response = await fetch(facecamSrc);
    const blob = await response.blob();
    const facecamFile = await projectDir.getFileHandle(
      "facecam.webm",
      { create: true },
    );
    const facecamWritable =
      await facecamFile.createWritable();
    await facecamWritable.write(blob);
    await facecamWritable.close();
  }

  // A recording's narration lives in its own file, so it has to be saved too —
  // otherwise a reloaded project comes back silent.
  if (project.audioSrc && project.audioSrc.startsWith("blob:")) {
    const blob = await (await fetch(project.audioSrc)).blob();
    const audioFile = await projectDir.getFileHandle("audio.webm", { create: true });
    const audioWritable = await audioFile.createWritable();
    await audioWritable.write(blob);
    await audioWritable.close();
  }
}

/** Read a saved project back as blobs, so the decoder can be re-opened on them. */
export async function loadProjectRecord(id: string): Promise<{
  project: Project;
  media: Blob | null;
  facecam: Blob | null;
  audio: Blob | null;
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
    return {
      project,
      media: await read("clip.webm"),
      facecam: await read("facecam.webm"),
      audio: await read("audio.webm"),
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

/**
 * Blob URLs minted for the last loaded project. They pin the whole recording in
 * memory until revoked, so loading another project releases the previous one.
 */
let loadedUrls: string[] = [];

function mintUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  loadedUrls.push(url);
  return url;
}

/** Release the blob URLs held by the previously loaded project. */
export function releaseLoadedProjectUrls(): void {
  loadedUrls.forEach((u) => URL.revokeObjectURL(u));
  loadedUrls = [];
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
    // Old v1.1 records upgrade to the v1.2 segment model on read.
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

    // Restore facecam blob URL from OPFS
    try {
      const facecamFile = await projectDir.getFileHandle(
        "facecam.webm",
      );
      const facecamBlob = await facecamFile.getFile();
      const src = mintUrl(facecamBlob);
      project = {
        ...project,
        segments: project.segments.map((seg, i) =>
          i === 0 ? { ...seg, facecam: { ...seg.facecam, src } } : seg,
        ),
      };
    } catch {
      // no facecam
    }

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
