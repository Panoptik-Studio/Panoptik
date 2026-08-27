/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.5 + 2.4.
 * Header bar — 64px, canvas #fff, hairline, ink, blue hover.
 * All buttons use 13px radius like homepage Open editor.
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

  return (
    <header className="flex shrink-0 items-center justify-between border-b px-8" style={{ background: "#ffffff", borderColor: "#ebebeb", height: 80, minHeight: 80 }}>
      {/* Left: brand — homepage Lato/Poppins, little small */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon-logo.webp" alt="" width={48} height={48} className="h-12 w-12 object-contain" draggable={false} style={{ opacity: 0.96 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/text-logo-dark.webp" alt="Panoptik" width={132} height={32} className="hidden h-8 w-auto object-contain sm:block" draggable={false} style={{ opacity: 0.96 }} />
          <span className="hidden sm:inline-flex px-2.5 py-1 text-[11px] font-medium tracking-wide" style={{ background: "#fafafa", color: "#666", border: "1px solid #ebebeb", fontFamily: "var(--font-mono)", opacity: 0.95, borderRadius: 13 }}>
            Local
          </span>
        </div>
        <span className="hidden text-sm font-light sm:block" style={{ color: "#ebebeb" }}>|</span>
        <button
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 transition-colors"
          style={{ color: "rgba(26,26,26,0.7)", background: "transparent", fontFamily: "var(--font-poppins)", fontSize: 16, fontWeight: 400, borderRadius: 13 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#fafafa"; e.currentTarget.style.color = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(26,26,26,0.7)"; }}
        >
          <span className="max-w-[160px] truncate" style={{ fontWeight: 500 }}>{project ? `${project.id.slice(0, 8)}…` : "product-demo.ods"}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {/* Right: actions — larger to match homepage, Poppins */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
          className="hidden sm:inline-flex h-9 items-center gap-1.5 border px-4 text-sm font-medium transition-colors"
          style={{ background: "#ffffff", color: "#1A1A1A", borderColor: "#ebebeb", fontFamily: "var(--font-poppins)", fontSize: 14, fontWeight: 500, opacity: 0.95, borderRadius: 13 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#1A1A1A"; }}
          title="Record screen + webcam"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Record
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))} className="flex sm:hidden h-9 w-9 items-center justify-center border bg-white" style={{ borderColor: "#ebebeb", borderRadius: 13 }} title="Record">
          <span className="h-3 w-3 rounded-full bg-red-500" />
        </button>

        <div className="mx-2 hidden h-5 w-px sm:block" style={{ background: "#ebebeb" }} />

        <div className="hidden sm:flex items-center gap-1.5">
          <button onClick={undo} disabled={!canUndo} className="flex h-9 w-9 items-center justify-center border bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed" style={{ borderColor: "#ebebeb", color: "#171717", borderRadius: 13 }} onMouseEnter={(e) => { if (!canUndo) return; e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }} title="Undo (⌘Z)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          <button onClick={redo} disabled={!canRedo} className="flex h-9 w-9 items-center justify-center border bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed" style={{ borderColor: "#ebebeb", color: "#171717", borderRadius: 13 }} onMouseEnter={(e) => { if (!canRedo) return; e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }} title="Redo (⇧⌘Z)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" /></svg>
          </button>
        </div>

        <div className="mx-2 hidden h-5 w-px sm:block" style={{ background: "#ebebeb" }} />

        <button className="hidden sm:flex h-9 items-center border bg-white px-3 text-xs font-medium transition-colors" style={{ borderColor: "#ebebeb", color: "#888", fontFamily: "var(--font-mono)", opacity: 0.95, borderRadius: 13 }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#888"; }} title="Command palette (⌘K)">
          ⌘K
        </button>

        <button onClick={() => quickExport.run({ format: "mp4", resolution: "720p", burnCaptions: true }, { download: true })} disabled={!project || quickExport.isExporting} title={project ? "Export 720p MP4 — use the Export panel for other options" : "Load a clip first"} className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50" style={{ background: "#1f1f1f", height: 40, fontFamily: "var(--font-poppins)", fontSize: 15, fontWeight: 700, borderRadius: 13, opacity: 0.98 }} onMouseEnter={(e) => { if (project && !quickExport.isExporting) e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "#1f1f1f"; }}>
          {quickExport.isExporting ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /><span className="tabular-nums">{Math.round((quickExport.progress ?? 0) * 100)}%</span></> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg><span className="hidden sm:inline">Export Video</span><span className="sm:hidden">Export</span></>}
        </button>
      </div>
    </header>
  );
}
