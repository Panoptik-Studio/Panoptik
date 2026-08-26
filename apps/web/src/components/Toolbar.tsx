/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 1.5 + 2.4.
 * Header bar: logo, project name, play/pause + time, undo/redo, ⌘K, Export.
 * Consumes useProjectStore; never edits B's store file.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

/** Own subscription to currentTime so playback repaints the readout, not the header. */
function TimeReadout({ duration }: { duration: number }) {
  const currentTime = useProjectStore((s) => s.currentTime);
  return (
    <span className="w-28 text-center text-[11px]"
      style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>
      {fmtTime(currentTime)} / {fmtTime(duration)}
    </span>
  );
}

export function Toolbar() {
  // Selectors only — a full-store subscription re-renders the header 60x/s.
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const togglePlay = useProjectStore((s) => s.togglePlay);
  const project = useProjectStore((s) => s.project);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const dur = project?.clip.duration ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b px-4"
      style={{ background: "var(--color-bg-panel)", borderColor: "var(--color-border-subtle)" }}>

      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--color-accent)" }}>
            <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
            <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
          </svg>
          Open Demo Studio
          <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase"
            style={{ background: "var(--color-accent-light)", color: "var(--color-accent)" }}>
            Local
          </span>
        </div>
        <span style={{ color: "var(--color-border-medium)" }}>/</span>
        <button className="flex items-center gap-1.5 rounded px-2 py-1 text-sm transition-colors hover:bg-[var(--color-bg-surface)]"
          style={{ color: "var(--color-text-secondary)" }}>
          <span>product-demo.ods</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* Center: play + time */}
      <div className="flex items-center gap-2 rounded-lg px-1.5 py-0.5"
        style={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border-subtle)" }}>
        <button onClick={togglePlay}
          className="flex h-[30px] w-[30px] items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-surface-hover)]"
          style={{ color: "var(--color-text-secondary)" }}
          title="Space">
          {isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
        <TimeReadout duration={dur} />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
          className="flex h-[30px] items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors hover:bg-red-600"
          style={{ background: "#dc2626", color: "white" }}
          title="Record Screen"
        >
          <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
          Record
        </button>
        <div className="mx-1 h-4 w-px" style={{ background: "var(--color-border-subtle)" }} />
        <button onClick={undo}
          className="flex h-[30px] w-[30px] items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-surface)]"
          style={{ color: "var(--color-text-secondary)" }} title="Undo (⌘Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button onClick={redo}
          className="flex h-[30px] w-[30px] items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-surface)]"
          style={{ color: "var(--color-text-secondary)" }} title="Redo (⇧⌘Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
          </svg>
        </button>
        <div className="mx-1 h-4 w-px" style={{ background: "var(--color-border-subtle)" }} />
        <button className="flex h-[30px] items-center gap-1.5 rounded px-2 transition-colors hover:bg-[var(--color-bg-surface)]"
          style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--color-text-muted)",
                   border: "1px solid var(--color-border-subtle)", background: "var(--color-bg-surface)" }}>
          ⌘K
        </button>
        <button className="flex items-center gap-1.5 rounded px-3.5 py-1.5 text-xs font-medium text-white transition-all"
          style={{ background: "var(--color-accent)", boxShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Export Video
        </button>
      </div>
    </header>
  );
}
