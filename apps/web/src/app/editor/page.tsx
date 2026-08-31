/**
 * Panoptik Video Editor.
 * Layout: left tool strip (Media · Zoom · Text · Captions · Audio · Camera · Stage)
 * + workspace (PreviewCanvas + Timeline) + right tabbed inspector.
 */
"use client";

import * as React from "react";
import { AudioPanel } from "@/components/AudioPanel";
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
import { TextPanel } from "@/components/TextPanel";
import { Timeline } from "@/components/Timeline";
import { ToolTrace } from "@/components/ToolTrace";
import { Toolbar } from "@/components/Toolbar";
import { ZoomPanel } from "@/components/ZoomPanel";
import { useProjectPersistence } from "@/lib/useProjectPersistence";
import { registerAllTools, unregisterAllTools } from "@/webmcp";

type LeftTab = "media" | "zoom" | "text" | "captions" | "audio" | "camera" | "stage";

export default function EditorPage() {
  const [activeTab, setActiveTab] = React.useState<LeftTab>("media");
  // Above the tabs: the clip must come back on reload regardless of which
  // panel happens to be open.
  useProjectPersistence();

  React.useEffect(() => {
    registerAllTools();
    return () => unregisterAllTools();
  }, []);

  return (
    <div className="flex h-screen flex-col" style={{ background: "#f8f8f8" }}>
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {/* Left — tabs grouped by job: Media / Zoom / Text / Captions / Audio / Camera / Stage */}
        <aside className="flex w-[64px] shrink-0 flex-col items-center gap-2 border-r bg-white py-5" style={{ borderColor: "#ebebeb" }}>
          <ToolBtn icon="media" label="Media" active={activeTab === "media"} onClick={() => setActiveTab("media")} />
          <ToolBtn icon="zoom" label="Zoom" kbd="Z" active={activeTab === "zoom"} onClick={() => setActiveTab("zoom")} />
          <ToolBtn icon="text" label="Text" kbd="T" active={activeTab === "text"} onClick={() => setActiveTab("text")} />
          <ToolBtn icon="captions" label="Captions" kbd="C" active={activeTab === "captions"} onClick={() => setActiveTab("captions")} />
          <ToolBtn icon="audio" label="Audio" active={activeTab === "audio"} onClick={() => setActiveTab("audio")} />
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
          <Timeline
            onSelectText={() => setActiveTab("text")}
            onSelectCaptions={() => setActiveTab("captions")}
            onSelectAudio={() => setActiveTab("audio")}
          />
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
          {activeTab === "text" && <TextPanel />}
          {activeTab === "captions" && <CaptionsPanel />}
          {activeTab === "audio" && <AudioPanel />}
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

/* Left toolbar button component */
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
        <rect width="20" height="16" x="2" y="4" rx="2"/><path d="M7 15h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z"/>
      </svg>
    ),
    audio: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    ),
    camera: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
    ),
    stage: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
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
        {kbd && (
          <kbd className="rounded border bg-[#f8f8f8] px-1 py-0.5 font-mono text-[10px]" style={{ borderColor: "#ebebeb", color: "#888" }}>
            {kbd}
          </kbd>
        )}
      </div>
    </div>
  );
}
