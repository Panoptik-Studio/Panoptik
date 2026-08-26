/**
 * OWNER: DEV B — OPFS project persistence (ROADMAP-B.md Task 2.6).
 * Layout under navigator.storage.getDirectory():
 *   <project.id>/project.json · clip.webm · facecam.webm (optional)
 * Degrades gracefully off secure context.
 */

import type { Project } from "@panoptik/schema";

function isSecureContext(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    "storage" in navigator
  );
}

export async function saveProject(
  project: Project,
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

  // Save clip blob if it's a blob URL
  if (project.clip.src.startsWith("blob:")) {
    const response = await fetch(project.clip.src);
    const blob = await response.blob();
    const clipFile = await projectDir.getFileHandle(
      "clip.webm",
      { create: true },
    );
    const clipWritable = await clipFile.createWritable();
    await clipWritable.write(blob);
    await clipWritable.close();
  }

  // Save facecam blob if present and is a blob URL
  if (
    project.facecam.src &&
    project.facecam.src.startsWith("blob:")
  ) {
    const response = await fetch(project.facecam.src);
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
}

export async function loadProject(
  id: string,
): Promise<Project | null> {
  if (!isSecureContext()) return null;

  try {
    const root = await navigator.storage.getDirectory();
    const projectDir = await root.getDirectoryHandle(id);

    const jsonFile = await projectDir.getFileHandle(
      "project.json",
    );
    const file = await jsonFile.getFile();
    const text = await file.text();
    const project = JSON.parse(text) as Project;

    // Restore clip blob URL from OPFS
    try {
      const clipFile = await projectDir.getFileHandle(
        "clip.webm",
      );
      const clipBlob = await clipFile.getFile();
      project.clip.src = URL.createObjectURL(clipBlob);
    } catch {
      // clip not saved — keep existing src
    }

    // Restore facecam blob URL from OPFS
    try {
      const facecamFile = await projectDir.getFileHandle(
        "facecam.webm",
      );
      const facecamBlob = await facecamFile.getFile();
      project.facecam.src =
        URL.createObjectURL(facecamBlob);
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
        const project = JSON.parse(
          await file.text(),
        ) as Project;
        projects.push({
          id: name,
          name: `Clip ${project.clip.duration.toFixed(0)}s`,
        });
      } catch {
        // skip corrupt/empty dirs
      }
    }
  }

  return projects;
}
