/**
 * OWNER: DEV A — ROADMAP-A.md Task 1.5 fills this in (drop zone, playback loop).
 * Structure is locked on Day 1: it renders one slot per component and the import
 * block below never changes. Each slot's file belongs to exactly one dev.
 */
"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ExportPanel } from "@/components/ExportPanel";
import { Inspector } from "@/components/Inspector";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { RecordModal } from "@/components/RecordModal";
import { StagingPanel } from "@/components/StagingPanel";
import { Timeline } from "@/components/Timeline";
import { ToolTrace } from "@/components/ToolTrace";
import { Toolbar } from "@/components/Toolbar";

export default function EditorPage() {
  return (
    <div className="flex h-screen flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* DEV A: drop zone wraps this area in Task 1.5 */}
          <div className="flex flex-1 items-center justify-center">
            <PreviewCanvas />
          </div>
          <Timeline />
        </div>
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-gray-800">
          <StagingPanel />
          <CaptionsSlot />
          <Inspector />
          <ExportPanel />
        </aside>
        <aside className="w-72 shrink-0 border-l border-gray-800">
          <ToolTrace />
        </aside>
      </div>
      <RecordModal />
      <ConfirmDialog />
    </div>
  );
}

function CaptionsSlot() {
  return null; // DEV B: mount CaptionsPanel here when implemented
}
