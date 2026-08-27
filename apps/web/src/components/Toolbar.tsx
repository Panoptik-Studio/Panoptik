/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.5 + 2.4.
 * Header bar — Vercel nav-bar spec (DESIGN.md): 64px, canvas #fff, hairline, ink, blue hover.
 * Consumes useProjectStore; never edits B's store file.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";
import { useVideoExport } from "@/lib/useVideoExport";

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.historyIndex > 0);
  const canRedo = useProjectStore((s) => s.historyIndex < s.history.length - 1);
  const quickExport = useVideoExport();

  const hasProject = project !== null;

  return (
    <header
      className="flex h-16 shrink-0 items-center justify-between border-b px-6"
      style={{ background: "#ffffff", borderColor: "#ebebeb", height: 64 }}
    >
      {/* Left: brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          {/* favicon — dark navy on white is crisp; 28px */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon-logo.webp" alt="" width={28} height={28} className="h-7 w-7 object-contain" draggable={false} />
          {/* wordmark — dark variant for light header */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/text-logo-dark.webp" alt="Panoptik" width={96} height={22} className="hidden h-[22px] w-auto object-contain sm:block" draggable={false} />
          <span className="hidden sm:inline-flex rounded-full px-2 py-0.5 text-[11px] font-normal tracking-wide" style={{ background: "#fafafa", color: "#666", border: "1px solid #ebebeb", fontFamily: "var(--font-mono)" }}>
            Local
          </span>
        </div>
        <span className="hidden text-sm font-light sm:block" style={{ color: "#ebebeb" }}>|</span>
        <button
          className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] transition-colors"
          style={{ color: "#4d4d4d", background: "transparent" }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#fafafa"; e.currentTarget.style.color = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#4d4d4d"; }}
        >
          <span className="max-w-[140px] truncate font-[450]">{project ? `${project.id.slice(0, 8)}…` : "product-demo.ods"}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
          className="hidden sm:inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors"
          style={{ background: "#ffffff", color: "#171717", borderColor: "#ebebeb" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}
          title="Record screen + webcam"
        >
          <span className="h-2 w-2 rounded-full bg-red-500" />
          Record
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
          className="flex sm:hidden h-7 w-7 items-center justify-center rounded-full border bg-white"
          style={{ borderColor: "#ebebeb" }}
          title="Record"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        </button>

        <div className="mx-1 hidden h-4 w-px sm:block" style={{ background: "#ebebeb" }} />

        <div className="hidden sm:flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="flex h-7 w-7 items-center justify-center rounded-full border bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ borderColor: "#ebebeb", color: "#171717" }}
            onMouseEnter={(e) => { if (!canUndo) return; e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}
            title="Undo (⌘Z)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="flex h-7 w-7 items-center justify-center rounded-full border bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ borderColor: "#ebebeb", color: "#171717" }}
            onMouseEnter={(e) => { if (!canRedo) return; e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}
            title="Redo (⇧⌘Z)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" /></svg>
          </button>
        </div>

        <div className="mx-1 hidden h-4 w-px sm:block" style={{ background: "#ebebeb" }} />

        <button
          className="hidden sm:flex h-7 items-center rounded-md border bg-white px-2 text-[11px] font-medium transition-colors"
          style={{ borderColor: "#ebebeb", color: "#888", fontFamily: "var(--font-mono)" }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#888"; }}
          title="Command palette (⌘K)"
        >
          ⌘K
        </button>

        {/* Primary CTA — quick 720p export straight to a download. The panel
            in the sidebar is where resolution and format are chosen. */}
        <button
          onClick={() => quickExport.run({ format: "mp4", resolution: "720p", burnCaptions: true }, { download: true })}
          disabled={!project || quickExport.isExporting}
          title={project ? "Export 720p MP4 — use the Export panel for other options" : "Load a clip first"}
          className="inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: "#171717", height: 32 }}
          onMouseEnter={(e) => { if (project && !quickExport.isExporting) e.currentTarget.style.background = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#171717"; }}
        >
          {quickExport.isExporting ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span className="tabular-nums">{Math.round((quickExport.progress ?? 0) * 100)}%</span>
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <span className="hidden sm:inline">Export Video</span>
              <span className="sm:hidden">Export</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
