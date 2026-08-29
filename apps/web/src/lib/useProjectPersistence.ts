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

/**
 * Which project's media is already on disk.
 *
 * Module scope, not a ref: only one project is open at a time, but the actions
 * below are used from panels while the effects run at the editor level. Held
 * per-instance, a panel would start at null, conclude the open project was new
 * and re-copy the whole video to OPFS every time it mounted.
 */
let mediaSavedFor: string | null = null;

/** Track ids already written to OPFS per project — avoids re-fetch+rewrite each debounce. */
const audioSavedFor = new Map<string, Set<string>>();

/**
 * Audio track srcs are object URLs that die with the session — re-mint them
 * from OPFS and re-register the decoded buffers the preview/export read.
 */
async function restoreAudioTracks(project: Project): Promise<void> {
  const tracks = project.audioTracks ?? [];
  if (tracks.length === 0) return;
  const { loadAudioTrackFiles, decodeViaAudioContext, registerTrackBuffer } = await import("@panoptik/engine");
  const files = await loadAudioTrackFiles(project.id);
  for (const track of tracks) {
    const file = files.find((f) => f.id === track.id);
    if (!file) continue;
    try {
      const buffer = await decodeViaAudioContext(file.blob);
      if (buffer) registerTrackBuffer(track.id, buffer);
      track.src = URL.createObjectURL(file.blob);
      markTrackSaved(project.id, track.id);
    } catch {
      /* leave the dead src; the track shows but stays silent until re-added */
    }
  }
}

function markTrackSaved(projectId: string, trackId: string): void {
  const set = audioSavedFor.get(projectId) ?? new Set<string>();
  set.add(trackId);
  audioSavedFor.set(projectId, set);
}

/**
 * Does this project still need its media copied to OPFS?
 *
 * True only the first time a given project id is seen. Exported so the rule can
 * be tested directly: the bug it guards against is a second consumer answering
 * "yes" for a project whose media is already on disk, which re-copies the whole
 * video.
 */
export function needsMediaCopy(projectId: string): boolean {
  return mediaSavedFor !== projectId;
}

export function markMediaSaved(projectId: string): void {
  mediaSavedFor = projectId;
}

export function forgetMediaSaved(): void {
  mediaSavedFor = null;
  audioSavedFor.clear();
}

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
          markMediaSaved(restored.id);
          await restoreAudioTracks(restored);
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
    const isNewProject = needsMediaCopy(project.id);
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
          // Persist any audio track whose file isn't on OPFS yet.
          const savedAudio = audioSavedFor.get(project.id) ?? new Set<string>();
          for (const track of project.audioTracks ?? []) {
            if (savedAudio.has(track.id) || !track.src.startsWith("blob:")) continue;
            try {
              const blob = await (await fetch(track.src)).blob();
              const { saveAudioTrackFile } = await import("@panoptik/engine");
              await saveAudioTrackFile(project.id, track.id, blob);
              markTrackSaved(project.id, track.id);
            } catch {
              /* skip this track this round */
            }
          }
          if (isNewProject) {
            markMediaSaved(project.id);
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

  // Actions live in their own hook so that a panel can use them without
  // mounting a second copy of the effects above.
  return useProjectActions();
}

/**
 * The explicit project actions, safe to call from anywhere.
 *
 * Deliberately effect-free: mounting this does not start a restore or an
 * autosave, so panels can use it without duplicating the editor's writes.
 */
export function useProjectActions() {
  const setProject = useProjectStore((s) => s.setProject);
  const setPersistStatus = useProjectStore((s) => s.setPersistStatus);

  /** Forget the current video entirely, on disk as well as in memory. */
  const removeProject = useCallback(async () => {
    const id = useProjectStore.getState().project?.id;
    useProjectStore.getState().clearProject();
    forgetMediaSaved();
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
          markMediaSaved(restored.id);
          await restoreAudioTracks(restored);
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
