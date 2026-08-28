/**
 * Keeps the loaded clip across reloads.
 *
 * This lives at the editor level rather than inside a panel: the sidebar panels
 * are mounted per-tab, so restoring from one would only happen if the user
 * happened to open that tab — which is exactly when it is least useful.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { engine } from "@/lib/engineProvider";
import { useProjectStore } from "@/stores/projectStore";

export const LAST_PROJECT_KEY = "panoptik:lastProject";
/** Edits are frequent; rewriting the JSON on each one would thrash OPFS. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

export function useProjectPersistence() {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const setPersistStatus = useProjectStore((s) => s.setPersistStatus);

  // The recording itself is copied once; later saves only rewrite the JSON.
  const mediaSavedFor = useRef<string | null>(null);
  const restoreAttempted = useRef(false);

  // ── Reopen the last project on mount ──
  useEffect(() => {
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;
    if (useProjectStore.getState().project) return;
    const id = localStorage.getItem(LAST_PROJECT_KEY);
    if (!id) return;

    setPersistStatus("restoring");
    engine
      .restoreProject(id)
      .then((restored) => {
        if (restored) {
          mediaSavedFor.current = restored.id;
          setProject(restored);
        } else {
          localStorage.removeItem(LAST_PROJECT_KEY);
        }
      })
      .catch(() => localStorage.removeItem(LAST_PROJECT_KEY))
      .finally(() => setPersistStatus("idle"));
  }, [setProject, setPersistStatus]);

  // ── Autosave ──
  useEffect(() => {
    if (!project) return;
    const isNewProject = mediaSavedFor.current !== project.id;

    const timer = setTimeout(
      async () => {
        try {
          setPersistStatus("saving");
          const { saveProject } = await import("@panoptik/engine");
          // Copying the media is expensive, so only the first save carries it.
          await saveProject(project, isNewProject);
          if (isNewProject) {
            mediaSavedFor.current = project.id;
            localStorage.setItem(LAST_PROJECT_KEY, project.id);
          }
          setPersistStatus("saved");
        } catch {
          setPersistStatus("idle");
        }
      },
      isNewProject ? 0 : AUTOSAVE_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [project, setPersistStatus]);

  /** Forget the current video entirely, on disk as well as in memory. */
  const removeProject = useCallback(async () => {
    const id = useProjectStore.getState().project?.id;
    useProjectStore.getState().clearProject();
    mediaSavedFor.current = null;
    localStorage.removeItem(LAST_PROJECT_KEY);
    if (!id) return;
    try {
      const { deleteProject } = await import("@panoptik/engine");
      await deleteProject(id);
    } catch {
      /* nothing stored for it */
    }
  }, []);

  const openProject = useCallback(
    async (id: string) => {
      setPersistStatus("restoring");
      try {
        const restored = await engine.restoreProject(id);
        if (restored) {
          mediaSavedFor.current = restored.id;
          localStorage.setItem(LAST_PROJECT_KEY, restored.id);
          setProject(restored);
        }
      } catch {
        /* leave the current project alone */
      } finally {
        setPersistStatus("idle");
      }
    },
    [setProject, setPersistStatus],
  );

  return { removeProject, openProject };
}
