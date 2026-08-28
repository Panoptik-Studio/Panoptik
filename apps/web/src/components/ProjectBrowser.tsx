/**
 * OWNER: DEV B — OPFS project browser: autosave, restore, delete.
 *
 * The clip only ever lived in memory, so a reload lost it. Media is written to
 * OPFS once on import, edits are written as JSON on a debounce, and the last
 * project is reopened on mount.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectPersistence } from "@/lib/useProjectPersistence";

type SavedProject = { id: string; name: string };

const LAST_PROJECT_KEY = "panoptik:lastProject";
/** Edits are frequent; rewriting the JSON on every one would thrash OPFS. */
const AUTOSAVE_DEBOUNCE_MS = 1200;

async function opfs() {
  return import("@panoptik/engine");
}

function formatBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

export function ProjectBrowser() {
  const project = useProjectStore((s) => s.project);
  const status = useProjectStore((s) => s.persistStatus);
  // Restore and autosave run at the editor level; this panel drives the
  // explicit actions and reports what they are doing.
  const { removeProject, openProject } = useProjectPersistence();

  const [saved, setSaved] = useState<SavedProject[]>([]);
  const [usage, setUsage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { listProjects } = await opfs();
      setSaved(await listProjects());
    } catch {
      /* OPFS unavailable — the panel simply shows nothing saved */
    }
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) setUsage(formatBytes(est.usage));
    } catch {
      /* estimate is best-effort */
    }
  }, []);

  // Re-list whenever the loaded project changes, so a new save shows up.
  useEffect(() => {
    refresh();
  }, [refresh, project?.id, status]);

  const handleDelete = useCallback(async () => {
    setConfirmDelete(false);
    await removeProject();
    await refresh();
  }, [removeProject, refresh]);

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "restoring"
        ? "Restoring…"
        : status === "saved"
          ? "Saved"
          : null;

  return (
    <div className="pk-panel">
      <div className="pk-panel-head mb-3">
        <h3 className="pk-panel-title">Project</h3>
        {statusLabel && (
          <span className="pk-chip" style={status === "saved" ? { color: "#10b981" } : undefined}>
            {statusLabel}
          </span>
        )}
      </div>

      {project ? (
        <>
          <div
            className="mb-3 rounded-[12px] border p-3"
            style={{ borderColor: "#ebebeb", background: "#f8f8f8" }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="pk-ui truncate text-[13px] font-medium" style={{ color: "#1a1a1a" }}>
                {project.facecam.src ? "Recording" : "Imported clip"}
              </span>
              <span className="pk-value shrink-0">
                {project.clip.width}×{project.clip.height}
              </span>
            </div>
            <p className="pk-help mt-1" style={{ fontSize: 11 }}>
              {project.clip.duration.toFixed(1)}s · kept on this device · reopens automatically
            </p>
          </div>

          {confirmDelete ? (
            <div className="flex gap-2">
              <button onClick={handleDelete} className="pk-btn pk-btn-danger pk-btn-sm flex-1">
                Delete for good
              </button>
              <button onClick={() => setConfirmDelete(false)} className="pk-btn pk-btn-ghost pk-btn-sm">
                Keep
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="pk-btn pk-btn-danger pk-btn-sm w-full"
              title="Remove this video and its edits from this device"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
              </svg>
              Remove video
            </button>
          )}
        </>
      ) : (
        <p className="pk-help">
          {status === "restoring"
            ? "Reopening your last project…"
            : "Import or record a clip to begin. It is kept here automatically."}
        </p>
      )}

      {saved.length > 0 && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "#ebebeb" }}>
          <p className="pk-label mb-1.5">Saved on this device</p>
          <select
            onChange={(e) => {
              if (e.target.value) openProject(e.target.value);
              e.target.value = "";
            }}
            disabled={status === "restoring"}
            className="pk-select w-full"
            defaultValue=""
          >
            <option value="" disabled>
              Open a project…
            </option>
            {saved.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.id === project?.id ? "● " : ""}
                {sp.name || sp.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {usage && (
            <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>
              Using {usage} of browser storage.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
