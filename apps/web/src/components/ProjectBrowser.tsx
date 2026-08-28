/**
 * OWNER: DEV B — OPFS project browser: Save / Load — Vercel card style.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

type SavedProject = { id: string; name: string };

async function doSave(project: Parameters<typeof import("@panoptik/engine").saveProject>[0]) {
  const { saveProject } = await import("@panoptik/engine");
  return saveProject(project);
}
async function doLoad(id: string) {
  const { loadProject } = await import("@panoptik/engine");
  return loadProject(id);
}
async function doList() {
  const { listProjects } = await import("@panoptik/engine");
  return listProjects();
}

export function ProjectBrowser() {
  const project = useProjectStore((s) => s.project);
  const setProject = useProjectStore((s) => s.setProject);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try { const list = await doList(); setSavedProjects(list); } catch { /* OPFS unavailable */ }
  }, []);

  useEffect(() => { refreshList(); }, [refreshList]);

  const handleSave = useCallback(async () => {
    if (!project || saving) return;
    setSaving(true);
    try { await doSave(project); setLastSaved(project.id); await refreshList(); } catch (err) { console.error("Save failed:", err); } finally { setSaving(false); }
  }, [project, saving, refreshList]);

  const handleLoad = useCallback(async (id: string) => {
    if (loading) return;
    setLoading(true);
    try { const loaded = await doLoad(id); if (loaded) setProject(loaded); } catch (err) { console.error("Load failed:", err); } finally { setLoading(false); }
  }, [loading, setProject]);

  return (
    <div className="pk-panel">
      <h3 className="pk-panel-title mb-2">Projects</h3>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!project || saving}
          className="rounded-full px-4 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-40"
          style={{ background: "#171717" }}
          onMouseEnter={(e) => { if (project && !saving) e.currentTarget.style.background = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#171717"; }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedProjects.length > 0 && (
          <select
            onChange={(e) => { if (e.target.value) handleLoad(e.target.value); e.target.value = ""; }}
            disabled={loading}
            className="rounded-full border bg-white px-3 py-1.5 text-xs outline-none disabled:opacity-40"
            style={{ borderColor: "#ebebeb", color: "#171717" }}
            defaultValue=""
          >
            <option value="" disabled>{loading ? "Loading…" : "Load project…"}</option>
            {savedProjects.map((sp) => (
              <option key={sp.id} value={sp.id} className="bg-white">{sp.name || sp.id}{sp.id === lastSaved ? " (saved)" : ""}</option>
            ))}
          </select>
        )}
      </div>
      {savedProjects.length === 0 && <p className="mt-2 font-mono text-[11px]" style={{ color: "#888" }}>No saved projects yet.</p>}
    </div>
  );
}
