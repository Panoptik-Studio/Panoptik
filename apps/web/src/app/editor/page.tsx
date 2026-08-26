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
import { StagingPanel } from "@/components/StagingPanel";
import { Timeline } from "@/components/Timeline";
import { ToolTrace } from "@/components/ToolTrace";
import { Toolbar } from "@/components/Toolbar";

export default function EditorPage() {
  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--color-bg-app)" }}>
      {/* Header bar */}
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        {/* ── Left tool strip (52px) ── */}
        <aside className="flex w-[52px] shrink-0 flex-col items-center gap-2 border-r py-3"
          style={{ background: "var(--color-bg-panel)", borderColor: "var(--color-border-subtle)" }}>
          <ToolBtn icon="zoom" label="Add / Edit Zoom (Z)" active />
          <ToolBtn icon="canvas" label="Media & Video Canvas" />
          <ToolBtn icon="text" label="Text Overlay" />
          <div className="my-1 h-px w-6" style={{ background: "var(--color-border-subtle)" }} />
          <ToolBtn icon="settings" label="Project Settings" />
        </aside>

        {/* ── Center workspace ── */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Canvas viewport */}
          <div className="flex min-h-0 flex-1 items-center justify-center"
            style={{ background: "radial-gradient(circle at center, #111216 0%, #08090a 100%)" }}>
            <PreviewCanvas />
          </div>
          {/* Timeline */}
          <Timeline />
        </main>

        {/* ── Right inspector (290px) ── */}
        <aside className="flex w-[290px] shrink-0 flex-col overflow-y-auto border-l"
          style={{ background: "var(--color-bg-panel)", borderColor: "var(--color-border-subtle)" }}>
          <StagingPanel />
          <ProjectBrowser />
          <CaptionsSlot />
          <Inspector />
          <ExportPanel />
          <ToolTrace />
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

/* ── Left sidebar icon buttons ── */
function ToolBtn({ icon, label, active }: { icon: string; label: string; active?: boolean }) {
  const icons: Record<string, React.ReactNode> = {
    zoom: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    ),
    canvas: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <path d="M7 3v18" /><path d="M3 7.5h4" /><path d="M3 12h18" /><path d="M3 16.5h4" />
        <path d="M17 3v18" /><path d="M17 7.5h4" /><path d="M17 16.5h4" />
      </svg>
    ),
    text: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
    settings: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };

  return (
    <button title={label}
      className={`relative flex h-9 w-9 flex-col items-center justify-center rounded transition-colors ${
        active ? "" : "hover:bg-[var(--color-bg-surface)]"
      }`}
      style={{
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        background: active ? "var(--color-bg-surface-active)" : "transparent",
      }}>
      {active && (
        <div className="absolute -left-2 h-[18px] w-[3px] rounded-r"
          style={{ background: "var(--color-accent)" }} />
      )}
      {icons[icon]}
    </button>
  );
}
