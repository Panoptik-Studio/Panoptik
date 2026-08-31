/**
 * The library — everything recorded or imported on this device.
 *
 * Sits between the homepage and the editor: the editor works on one project at
 * a time and had no way to show the rest, so anything not currently open was
 * effectively invisible.
 *
 * Opening a card writes the id that the editor's restore-on-mount already reads
 * and navigates there, so there is one restore path rather than two.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProjectCard } from "@/components/ProjectCard";
import { LAST_PROJECT_KEY } from "@/lib/useProjectPersistence";
import { useProjectStore } from "@/stores/projectStore";
import { safeSetLocalStorage, cleanupLegacyLocalStorage } from "@/lib/storageUtils";
import type { ProjectSummary } from "@panoptik/engine";

type Filter = "all" | "drafts";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [storage, setStorage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    cleanupLegacyLocalStorage();
    try {
      const { listProjectSummaries } = await import("@panoptik/engine");
      setProjects(await listProjectSummaries());
    } catch {
      setProjects([]);
    }
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) {
        setStorage(est.usage >= 1e9 ? `${(est.usage / 1e9).toFixed(1)} GB` : `${Math.round(est.usage / 1e6)} MB`);
      }
    } catch {
      /* estimate is best-effort */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = useCallback(
    (id: string) => {
      // The editor restores whatever this key points at on mount.
      safeSetLocalStorage(LAST_PROJECT_KEY, id);
      // Client-side navigation does not reload the app, so the store still
      // holds whatever was open before. Without clearing it the editor's
      // restore sees a project already loaded, skips, and shows the old clip
      // no matter which card was clicked.
      useProjectStore.getState().clearProject();
      router.push("/editor");
    },
    [router],
  );

  /**
   * Begin a fresh project.
   *
   * Same two calls the cards use, minus the id: drop the pointer the editor
   * restores from and clear the store, so the editor lands in its empty state
   * instead of silently reopening whatever was last edited.
   */
  const startNew = useCallback(() => {
    localStorage.removeItem(LAST_PROJECT_KEY);
    useProjectStore.getState().clearProject();
    router.push("/editor");
  }, [router]);

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsImporting(true);
    try {
      const { importProjectBundle } = await import("@panoptik/engine");
      const { project, projectId } = await importProjectBundle(file);
      safeSetLocalStorage(LAST_PROJECT_KEY, projectId);
      useProjectStore.getState().setProject(project);
      router.push("/editor");
    } catch (err) {
      console.error("Import project failed", err);
      alert("Failed to import project. Please make sure the file is a valid .panoptik bundle.");
      setIsImporting(false);
      refresh();
    }
  };

  const rename = useCallback(
    async (id: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      // Optimistic update
      setProjects((prev) =>
        prev?.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) ?? prev,
      );
      try {
        const { renameProject } = await import("@panoptik/engine");
        await renameProject(id, trimmed);
      } catch (err) {
        console.warn("[Projects] Failed to rename project", err);
      }
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      // Drop it from the screen first; re-listing OPFS is slow enough to feel
      // like the click did nothing.
      setProjects((prev) => prev?.filter((p) => p.id !== id) ?? prev);
      if (localStorage.getItem(LAST_PROJECT_KEY) === id) {
        localStorage.removeItem(LAST_PROJECT_KEY);
      }
      try {
        const { deleteProject } = await import("@panoptik/engine");
        await deleteProject(id);
      } catch {
        /* nothing stored for it */
      }
      refresh();
    },
    [refresh],
  );

  const shown = (projects ?? []).filter((p) => (filter === "drafts" ? !p.exportedAt : true));
  const draftCount = (projects ?? []).filter((p) => !p.exportedAt).length;

  return (
    <div className="min-h-screen" style={{ background: "var(--color-pk-canvas)" }}>
      {/* Hidden file picker for importing .panoptik project files */}
      <input
        ref={importInputRef}
        type="file"
        accept=".panoptik,.json"
        className="hidden"
        onChange={onImportFile}
      />

      {/* Header */}
      <header className="border-b border-pk-hairline bg-pk-surface">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-6 py-3.5 sm:px-10">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Panoptik home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon-logo.webp" alt="" width={22} height={22} style={{ objectFit: "contain" }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/text-logo-dark.webp" alt="Panoptik" width={104} height={21} style={{ height: 21, width: "auto", objectFit: "contain" }} />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="pk-btn pk-btn-ghost pk-btn-sm">Home</Link>
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={isImporting}
              className="pk-btn pk-btn-ghost pk-btn-sm"
              title="Import a saved .panoptik project file"
            >
              {isImporting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  <span>Importing...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span>Import project</span>
                </>
              )}
            </button>
            <button onClick={startNew} className="pk-btn pk-btn-ghost pk-btn-sm">New project</button>
            {/* Reopens whatever was last edited — the editor restores from the
                same pointer the cards write, so the name matches what happens. */}
            <Link
              href="/editor"
              className="pk-btn pk-btn-primary pk-btn-sm"
              title="Reopen the clip you were last working on"
            >
              Last session
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-6 py-8 sm:px-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="pk-ui text-[26px] font-semibold leading-tight text-pk-ink">Your clips</h1>
            <p className="pk-help mt-1.5">
              {projects === null
                ? "Reading this device…"
                : projects.length === 0
                  ? "Nothing recorded yet."
                  : `${projects.length} clip${projects.length === 1 ? "" : "s"} on this device${storage ? ` · ${storage} used` : ""}`}
            </p>
          </div>

          {(projects?.length ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <button className="pk-seg" data-active={filter === "all"} onClick={() => setFilter("all")}>
                All
              </button>
              <button className="pk-seg" data-active={filter === "drafts"} onClick={() => setFilter("drafts")}>
                Not exported{draftCount > 0 ? ` (${draftCount})` : ""}
              </button>
            </div>
          )}
        </div>

        {projects === null ? (
          <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-2.5">
                <div className="aspect-video w-full animate-pulse rounded-[var(--radius-pk-card)] bg-pk-surface-soft" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-pk-surface-soft" />
              </div>
            ))}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-[var(--radius-pk-card)] border border-dashed border-pk-hairline bg-pk-surface px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--color-pk-blue-soft)", color: "var(--color-pk-blue)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" />
              </svg>
            </span>
            <div>
              <p className="pk-ui text-[15px] font-medium text-pk-ink">
                {filter === "drafts" ? "Everything here has been exported" : "No clips yet"}
              </p>
              <p className="pk-help mx-auto mt-1.5 max-w-[46ch]">
                {filter === "drafts"
                  ? "Clips you have not exported yet will collect here."
                  : "Record your screen and camera, or drop in a video you already have. Everything stays on this device."}
              </p>
            </div>
            {filter === "drafts" ? (
              <button className="pk-btn pk-btn-ghost pk-btn-md" onClick={() => setFilter("all")}>
                Show all clips
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/editor" className="pk-btn pk-btn-primary pk-btn-md">
                  Record or import
                </Link>
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="pk-btn pk-btn-ghost pk-btn-md"
                  title="Import a saved .panoptik project file"
                >
                  Import .panoptik file
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <button
              onClick={startNew}
              className="group flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-pk-card)] border border-dashed border-pk-hairline bg-pk-surface transition-all hover:border-pk-blue hover:bg-[var(--color-pk-blue-soft)]"
              title="Start a new project"
            >
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
                style={{ background: "var(--color-pk-surface-soft)", color: "var(--color-pk-faint)" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="pk-ui text-[13px] font-medium text-pk-body transition-colors group-hover:text-pk-blue">
                New project
              </span>
            </button>

            {shown.map((p) => (
              <ProjectCard key={p.id} summary={p} onOpen={open} onDelete={remove} onRename={rename} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
