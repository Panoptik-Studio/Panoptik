/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.5.
 * Structure is locked: renders one slot per component, import block never changes.
 * Layout matches ui-sample.html: left tool strip + workspace (canvas+timeline) + right inspector.
 */
"use client";

import { CaptionsPanel } from "@/components/CaptionsPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ExportPanel } from "@/components/ExportPanel";
import { Inspector } from "@/components/Inspector";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { ProjectBrowser } from "@/components/ProjectBrowser";
import { RecordModal } from "@/components/RecordModal";
import { StageControls } from "@/components/StageControls";
import { StagingPanel } from "@/components/StagingPanel";
import { Timeline } from "@/components/Timeline";
import { ToolTrace } from "@/components/ToolTrace";
import { Toolbar } from "@/components/Toolbar";
import { ZoomPanel } from "@/components/ZoomPanel";

export default function EditorPage() {
  return (
    <div className="flex h-screen flex-col" style={{ background: "#fafafa" }}>
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {/* Left — ex-app-shell-row (white, hairline, active indicator #171717) */}
        <aside className="flex w-[56px] shrink-0 flex-col items-center gap-1.5 border-r bg-white py-4" style={{ borderColor: "#ebebeb" }}>
          <ToolBtn icon="zoom" label="Add / Edit Zoom" kbd="Z" active />
          <ToolBtn icon="canvas" label="Media & Video Canvas" />
          <ToolBtn icon="text" label="Text Overlay" kbd="T" />
          <div className="my-2 h-px w-6 rounded-full" style={{ background: "#ebebeb" }} />
          <ToolBtn icon="settings" label="Project Settings" />
          <div className="mt-auto flex flex-col items-center gap-2 pb-2">
            <div className="h-px w-6 rounded-full" style={{ background: "#ebebeb" }} />
            <div className="flex h-7 w-7 items-center justify-center rounded-full border bg-[#fafafa] text-[10px] font-bold tracking-widest" style={{ borderColor: "#ebebeb", color: "#888" }} title="Local · No upload">●</div>
          </div>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-1 flex-col bg-[#fafafa]">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#fafafa]">
            <PreviewCanvas />
          </div>
          <Timeline />
        </main>

        {/* Right — white cards on soft canvas */}
        <aside className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l bg-white" style={{ borderColor: "#ebebeb", scrollbarGutter: "stable" }}>
          <StagingPanel />
          <ZoomPanel />
          <StageControls />
          <ProjectBrowser />
          <CaptionsSlot />
          <Inspector />
          <ExportPanel />
          <div className="border-t" style={{ borderColor: "#ebebeb" }}>
            <ToolTrace />
          </div>
          <div className="shrink-0 border-t bg-[#fafafa] px-4 py-3 text-center text-[10px] leading-relaxed tracking-wide" style={{ borderColor: "#ebebeb", color: "#888" }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0070f3] shadow-[0_0_6px_rgba(0,112,243,0.5)]" /> Local · No upload · 100% in browser
            </span>
          </div>
        </aside>
      </div>

      <RecordModal />
      <ConfirmDialog />
    </div>
  );
}

function CaptionsSlot() {
  return <CaptionsPanel />; // DEV B: CaptionsPanel implemented
}

/* Left — ex-app-shell-row: active indicator #171717, rounded sm */
function ToolBtn({ icon, label, kbd, active }: { icon: string; label: string; kbd?: string; active?: boolean }) {
  const icons: Record<string, React.ReactNode> = {
    zoom: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    canvas: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />
      </svg>
    ),
    text: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
    settings: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };
  return (
    <div className="group relative">
      <button
        className="relative flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors"
        style={{
          color: active ? "#171717" : "#888",
          background: active ? "#fafafa" : "transparent",
          border: active ? "1px solid #ebebeb" : "1px solid transparent",
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = "#0070f3"; e.currentTarget.style.background = "#f5f5f5"; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = "#888"; e.currentTarget.style.background = "transparent"; } }}
      >
        {active && <div className="absolute -left-[14px] h-[18px] w-[3px] rounded-r-full" style={{ background: "#171717" }} />}
        {icons[icon]}
      </button>
      <div className="pointer-events-none absolute left-[46px] top-1/2 z-50 hidden -translate-y-1/2 items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shadow-vercel-5 group-hover:flex" style={{ borderColor: "#ebebeb", color: "#171717" }}>
        {label}
        {kbd && <span className="rounded border bg-[#fafafa] px-1 py-px text-[10px] font-mono" style={{ borderColor: "#ebebeb", color: "#888" }}>{kbd}</span>}
      </div>
    </div>
  );
}
