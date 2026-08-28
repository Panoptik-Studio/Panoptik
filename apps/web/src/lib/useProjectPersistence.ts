/**
 * Keeps the loaded clip and its undo/redo history across reloads.
 *
 * This lives at the editor level rather than inside a panel: the sidebar panels
 * are mounted per-tab, so restoring from one would only happen if the user
 * happened to open that tab — which is exactly when it is least useful.
 */
"use client";

import { useCallback, useEffect, useRef } from "react";
import { engine } from "@/lib/engineProvider";
import { useProjectStore } from "@/stores/projectStore";
import type { Project } from "@panoptik/schema";

export const LAST_PROJECT_KEY = "panoptik:lastProject";
export const HISTORY_KEY_PREFIX = "panoptik:history:";
/** Edits are frequent; rewriting the JSON on each one would thrash OPFS. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

function readSavedHistory(projectId: string): { history?: Project[]; historyIndex?: number } | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(HISTORY_KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.history)) {
      return {
        history: parsed.history,
        historyIndex:
          typeof parsed.historyIndex === "number"
            ? parsed.historyIndex
            : parsed.history.length - 1,
      };
    }
  } catch {
    /* ignore parsing errors */
  }
  return null;
}

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
      .then(async (restored) => {
        if (restored) {
          mediaSavedFor.current = restored.id;
          const savedHistory = readSavedHistory(restored.id);
          if (savedHistory?.history && savedHistory.history.length > 0) {
            setProject(restored, savedHistory.history, savedHistory.historyIndex);
          } else {
            try {
              const { loadProjectRecord } = await import("@panoptik/engine");
              const rec = await loadProjectRecord(restored.id);
              if (rec?.history && rec.history.length > 0) {
                setProject(restored, rec.history, rec.historyIndex);
              } else {
                setProject(restored);
              }
            } catch {
              setProject(restored);
            }
          }
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
    const state = useProjectStore.getState();

    // Persist history to localStorage immediately
    if (state.history.length > 0 && typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(
          HISTORY_KEY_PREFIX + project.id,
          JSON.stringify({
            history: state.history,
            historyIndex: state.historyIndex,
          }),
        );
      } catch {
        /* storage full or unavailable */
      }
    }

    const timer = setTimeout(
      async () => {
        try {
          setPersistStatus("saving");
          const { saveProject } = await import("@panoptik/engine");
          const currentState = useProjectStore.getState();
          // Copying the media is expensive, so only the first save carries it.
          await saveProject(project, isNewProject, {
            history: currentState.history,
            historyIndex: currentState.historyIndex,
          });
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
      localStorage.removeItem(HISTORY_KEY_PREFIX + id);
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
          const savedHistory = readSavedHistory(restored.id);
          if (savedHistory?.history && savedHistory.history.length > 0) {
            setProject(restored, savedHistory.history, savedHistory.historyIndex);
          } else {
            try {
              const { loadProjectRecord } = await import("@panoptik/engine");
              const rec = await loadProjectRecord(restored.id);
              if (rec?.history && rec.history.length > 0) {
                setProject(restored, rec.history, rec.historyIndex);
              } else {
                setProject(restored);
              }
            } catch {
              setProject(restored);
            }
          }
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
