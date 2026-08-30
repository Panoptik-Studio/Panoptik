/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.5 + 2.4.
 * Header bar — 64px, canvas #fff, hairline, ink, blue hover.
 * All buttons use 13px radius like homepage Open editor.
 */
"use client";

import Link from "next/link";

import { useRef } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { formatDefaultProjectName } from "@panoptik/engine";
import { useVideoExport } from "@/lib/useVideoExport";
import { engine } from "@/lib/engineProvider";

export function Toolbar() {
  const project = useProjectStore((s) => s.project);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.historyIndex > 0);
  const canRedo = useProjectStore((s) => s.historyIndex < s.history.length - 1);
  const quickExport = useVideoExport();
  const fileRef = useRef<HTMLInputElement>(null);

  const onAddClip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !file.type.startsWith("video/")) return;
    const state = useProjectStore.getState();
    if (!state.project) {
      try {
        const proj = await engine.loadClip(file);
        state.setProject(proj);
      } catch (err) {
        console.error("Add clip failed", err);
      }
      return;
    }
    try {
      const { media, segment } = await engine.importClip(file);
      state.appendClip(media, segment);
    } catch (err) {
      console.error("Add clip failed", err);
    }
  };

  return (
    <header className="flex shrink-0 items-center justify-between border-b px-8" style={{ background: "#ffffff", borderColor: "#ebebeb", height: 80, minHeight: 80 }}>
      {/* Left: brand — homepage Lato/Poppins, little small */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon-logo.webp" alt="" width={48} height={48} className="h-12 w-12 object-contain" draggable={false} style={{ opacity: 0.96 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/text-logo-dark.webp" alt="Panoptik" width={132} height={32} className="hidden h-8 w-auto object-contain sm:block" draggable={false} style={{ opacity: 0.96 }} />
          <span className="pk-chip hidden sm:inline-flex">
            Local
          </span>
        </div>
        <span className="hidden text-sm font-light sm:block" style={{ color: "#ebebeb" }}>|</span>
        <button
          className="pk-btn pk-btn-ghost pk-btn-sm hidden sm:flex"
          style={{ borderColor: "transparent", background: "transparent", fontSize: 14 }}
          title={project?.name || project?.id}
        >
          <span className="max-w-[180px] truncate" style={{ fontWeight: 500 }}>
            {project ? (project.name?.trim() || formatDefaultProjectName(project.segments[0]?.facecam?.src ? "recording" : "clip")) : "product-demo.ods"}
          </span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-50"><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>

      {/* Right: actions — larger to match homepage, Poppins */}
      <div className="flex items-center gap-2">
        <Link
          href="/projects"
          className="pk-btn pk-btn-ghost pk-btn-sm hidden sm:inline-flex"
          style={{ height: 38 }}
          title="All clips saved on this device"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          My clips
        </Link>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
          className="pk-btn pk-btn-ghost pk-btn-sm hidden sm:inline-flex"
          style={{ height: 38 }}
          title="Record screen + webcam"
        >
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Record
        </button>
        <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onAddClip} />
        <button
          onClick={() => fileRef.current?.click()}
          className="pk-btn pk-btn-ghost pk-btn-sm hidden sm:inline-flex"
          style={{ height: 38 }}
          title="Add clip to timeline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add clip
        </button>
        <button onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))} className="pk-icon-btn flex h-[38px] w-[38px] sm:hidden" title="Record">
          <span className="h-3 w-3 rounded-full bg-red-500" />
        </button>

        <div className="mx-2 hidden h-5 w-px sm:block" style={{ background: "#ebebeb" }} />

        <div className="hidden sm:flex items-center gap-1.5">
          <button onClick={undo} disabled={!canUndo} className="pk-icon-btn h-[38px] w-[38px]" title="Undo (⌘Z)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></svg>
          </button>
          <button onClick={redo} disabled={!canRedo} className="pk-icon-btn h-[38px] w-[38px]" title="Redo (⇧⌘Z)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" /></svg>
          </button>
        </div>

        <div className="mx-2 hidden h-5 w-px sm:block" style={{ background: "#ebebeb" }} />

        <button className="pk-icon-btn hidden h-[38px] items-center px-3.5 font-mono text-xs sm:flex" title="Command palette (⌘K)">
          ⌘K
        </button>

        <button onClick={() => quickExport.run({ format: "mp4", resolution: "720p" }, { download: true })} disabled={!project || quickExport.isExporting} title={project ? "Export 720p MP4 — use the Export panel for other options" : "Load a clip first"} className="pk-btn pk-btn-primary pk-btn-md" style={{ height: 38 }}>
          {quickExport.isExporting ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" /><span className="tabular-nums">{Math.round((quickExport.progress ?? 0) * 100)}%</span></> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg><span className="hidden sm:inline">Export Video</span><span className="sm:hidden">Export</span></>}
        </button>
      </div>
    </header>
  );
}
