/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.5.
 * Structure is locked: renders one slot per component, import block never changes.
 * Layout matches ui-sample.html: left tool strip + workspace (canvas+timeline) + right inspector.
 */
"use client";

import * as React from "react";
import { CameraControls } from "@/components/CameraControls";
import { CaptionsPanel } from "@/components/CaptionsPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ExportLock } from "@/components/ExportLock";
import { ExportPanel } from "@/components/ExportPanel";
import { Inspector } from "@/components/Inspector";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { ProjectBrowser } from "@/components/ProjectBrowser";
import { RecordModal } from "@/components/RecordModal";
import { ReshootModal } from "@/components/ReshootModal";
import { StageControls } from "@/components/StageControls";
import { Timeline } from "@/components/Timeline";
import { ToolTrace } from "@/components/ToolTrace";
import { Toolbar } from "@/components/Toolbar";
import { ZoomPanel } from "@/components/ZoomPanel";
import { useProjectPersistence } from "@/lib/useProjectPersistence";

type LeftTab = "media" | "zoom" | "text" | "captions" | "camera" | "stage";
export default function EditorPage() {
  const [activeTab, setActiveTab] = React.useState<LeftTab>("media");
  // Above the tabs: the clip must come back on reload regardless of which
  // panel happens to be open.
  useProjectPersistence();
  return (
    <div className="flex h-screen flex-col" style={{ background: "#f8f8f8" }}>
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {/* Left — 6 tabs grouped by job: Media / Zoom / Text / Captions / Camera / Stage */}
        <aside className="flex w-[64px] shrink-0 flex-col items-center gap-2 border-r bg-white py-5" style={{ borderColor: "#ebebeb" }}>
          <ToolBtn icon="media" label="Media" active={activeTab === "media"} onClick={() => setActiveTab("media")} />
          <ToolBtn icon="zoom" label="Zoom" kbd="Z" active={activeTab === "zoom"} onClick={() => setActiveTab("zoom")} />
          <ToolBtn icon="text" label="Text" kbd="T" active={activeTab === "text"} onClick={() => setActiveTab("text")} />
          <ToolBtn icon="captions" label="Captions" active={activeTab === "captions"} onClick={() => setActiveTab("captions")} />
          <ToolBtn icon="camera" label="Camera" active={activeTab === "camera"} onClick={() => setActiveTab("camera")} />
          <ToolBtn icon="stage" label="Stage" active={activeTab === "stage"} onClick={() => setActiveTab("stage")} />
          <div className="mt-auto flex flex-col items-center gap-2 pb-2">
            <div className="h-px w-6 rounded-full" style={{ background: "#ebebeb" }} />
            <div className="flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold tracking-widest" style={{ borderColor: "#ebebeb", background: "#f8f8f8", color: "#10b981" }} title="Local · No upload">●</div>
          </div>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-1 flex-col" style={{ background: "#f8f8f8" }}>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <PreviewCanvas />
          </div>
          <Timeline />
        </main>

        {/* Right — tabbed inspector */}
        <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l bg-white" style={{ borderColor: "#ebebeb", scrollbarGutter: "stable" }}>
          {activeTab === "media" && <ProjectBrowser />}
          {activeTab === "zoom" && (
            <>
              <ZoomPanel />
              <Inspector />
            </>
          )}
          {activeTab === "text" && <Inspector />}
          {activeTab === "captions" && <CaptionsSlot />}
          {activeTab === "camera" && <CameraControls />}
          {activeTab === "stage" && <StageControls />}
          {/* Export always reachable via header, but also show in media tab */}
          {activeTab === "media" && <ExportPanel />}
          <div className="border-t" style={{ borderColor: "#ebebeb" }}>
            <ToolTrace />
          </div>
          <div className="pk-ui mt-auto shrink-0 border-t px-4 py-3 text-center text-[11px] leading-relaxed" style={{ borderColor: "#ebebeb", background: "#f8f8f8", color: "#888" }}>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#0070f3] shadow-[0_0_6px_rgba(0,112,243,0.5)]" /> Local · No upload · 100% in browser
            </span>
          </div>
        </aside>
      </div>

      <RecordModal />
      <ReshootModal />
      <ConfirmDialog />
      <ExportLock />
    </div>
  );
}

function CaptionsSlot() {
  return <CaptionsPanel />; // DEV B: CaptionsPanel implemented
}

/* Left — 6 tabs: Media · Zoom · Text · Captions · Camera · Stage */
function ToolBtn({ icon, label, kbd, active, onClick }: { icon: string; label: string; kbd?: string; active?: boolean; onClick?: () => void }) {
  const icons: Record<string, React.ReactNode> = {
    media: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="2" y="2" width="20" height="16" rx="2"/><path d="M2 12h5l4-4 4 4h7"/><circle cx="8.5" cy="8" r="1.5" fill="currentColor" stroke="none"/></svg>
    ),
    zoom: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    text: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
    captions: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 7h18"/><path d="M3 12h10"/><path d="M3 17h14"/><path d="M17 7v10"/><path d="M7 12v5"/></svg>
    ),
    camera: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    ),
    stage: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
    ),
    canvas: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" /><path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />
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
        onClick={onClick}
        className="pk-icon-btn relative h-10 w-10"
        data-active={!!active}
        aria-pressed={!!active}
      >
        {icons[icon]}
      </button>
      <div className="pk-ui pointer-events-none absolute left-[52px] top-1/2 z-50 hidden -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-[11px] border bg-white px-3 py-1.5 text-[12px] font-medium pk-shadow-md group-hover:flex" style={{ borderColor: "#ebebeb", color: "#1a1a1a" }}>
        {label}
        {kbd && <span className="rounded-md border bg-[#f1f1f1] px-1.5 py-px font-mono text-[10px]" style={{ borderColor: "#ebebeb", color: "#666" }}>{kbd}</span>}
      </div>
    </div>
  );
}
