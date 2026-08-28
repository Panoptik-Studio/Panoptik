/**
 * OWNER: DEV B — OPFS project browser: autosave, restore, delete.
 *
 * The clip only ever lived in memory, so a reload lost it. Media is written to
 * OPFS once on import, edits are written as JSON on a debounce, and the last
 * project is reopened on mount.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useProjectActions } from "@/lib/useProjectPersistence";

type SavedProject = { id: string; name: string };

async function opfs() {
  return import("@panoptik/engine");
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  // Below half a megabyte, rounding to MB just reads "0 MB".
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${Math.round(n / 1e6)} MB`;
}

export function ProjectBrowser() {
  const project = useProjectStore((s) => s.project);
  const status = useProjectStore((s) => s.persistStatus);
  // Actions only. Restore and autosave run once at the editor level — calling
  // the full persistence hook here mounted a second autosave, which saw an
  // unfamiliar project id and re-copied the whole video to OPFS on every mount.
  const { removeProject, openProject } = useProjectActions();

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

  useEffect(() => {
    refresh();
  }, [refresh, project?.id]);

  // Re-list when a save completes, so a new project appears. Keyed on the
  // transition rather than on `status` itself: status cycles through saving and
  // saved on every autosave, and listing OPFS on each of those meant walking
  // the directory several times per edit.
  const prevStatus = useRef(status);
  useEffect(() => {
    const justSaved = prevStatus.current !== "saved" && status === "saved";
    prevStatus.current = status;
    if (justSaved) refresh();
  }, [status, refresh]);

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
                {project.segments[0]?.facecam.src ? "Recording" : "Imported clip"}
              </span>
              <span className="pk-value shrink-0">
                {project.media.width}×{project.media.height}
              </span>
            </div>
            <p className="pk-help mt-1" style={{ fontSize: 11 }}>
              {project.media.duration.toFixed(1)}s · kept on this device · reopens automatically
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

      {(saved.length > 0 || usage) && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "#ebebeb" }}>
          {saved.length > 0 && (
            <>
              <p className="pk-label mb-1.5">Saved on this device</p>
              <select
                onChange={(e) => {
                  const id = e.target.value;
                  e.target.value = "";
                  if (id) openProject(id);
                }}
                disabled={status === "restoring"}
                className="pk-select w-full"
                defaultValue=""
              >
                <option value="" disabled>
                  Open a project…
                </option>
                {saved.map((sp) => {
                  const isOpen = sp.id === project?.id;
                  return (
                    <option key={sp.id} value={sp.id} disabled={isOpen}>
                      {isOpen ? "● " : ""}
                      {sp.name || sp.id.slice(0, 8)}
                      {isOpen ? " (open)" : ""}
                    </option>
                  );
                })}
              </select>
            </>
          )}
          {usage && (
            <p className={`pk-help ${saved.length > 0 ? "mt-1.5" : ""}`} style={{ fontSize: 11 }}>
              Using {usage} of browser storage.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
