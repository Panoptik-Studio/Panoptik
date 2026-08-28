/**
 * ZoomPanel — beautiful UI to add/manage zoom points.
 * Vercel card style, pill buttons black→blue, mono labels.
 * Per-segment: lists and edits the SELECTED segment's zoom points; adding at the
 * playhead resolves the active segment's source time and selects it.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";
import { resolveSegment, sourceToTimeline } from "@panoptik/engine";

export function ZoomPanel() {
  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const addZoomPoint = useProjectStore((s) => s.addZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const seek = useProjectStore((s) => s.seek);

  if (!project) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Zoom</h3>
        <p className="pk-help">Load a clip to add zooms. Click the preview while paused.</p>
      </div>
    );
  }

  const seg = project.segments.find((s) => s.id === selectedSegmentId) ?? null;

  if (!seg) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Zoom</h3>
        <p className="pk-help">Select a segment to edit its zooms.</p>
      </div>
    );
  }

  const allZooms = [...seg.zoomPoints, ...seg.stagedZoomPoints];

  return (
    <div className="pk-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="pk-panel-title">Zoom</h3>
        <span className="pk-chip">{allZooms.length} points · Seg {project.segments.findIndex((s) => s.id === seg.id) + 1}</span>
      </div>

      <button
        onClick={() => {
          const r = resolveSegment(project, currentTime);
          if (!r) return;
          // Keyframes are source-relative — land the new point at the active
          // segment's srcT and select it so addZoomPoint writes there.
          if (r.segment.id !== selectedSegmentId) selectSegment(r.segment.id);
          addZoomPoint({ t: r.srcT, to: { scale: 2.2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic" });
        }}
        className="pk-btn pk-btn-primary pk-btn-md w-full"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></svg>
        Add zoom at {currentTime.toFixed(1)}s
      </button>
      <p className="pk-help mt-2 text-center" style={{ fontSize: 11 }}>or click the preview while paused · drag focal to reposition</p>

      {allZooms.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {allZooms.map((zp) => {
            const isStaged = (zp as { staged?: boolean }).staged;
            const isSelected = selectedZoomId === zp.id;
            return (
              <div
                key={zp.id}
                onClick={() => {
                  setSelectedZoom(zp.id);
                  // Land where the move has settled, otherwise the preview shows
                  // the camera mid-transition (or not moved at all) and edits
                  // look like they do nothing.
                  const st = sourceToTimeline(project, seg.id, zp.t + zp.dur);
                  if (st != null) seek(st);
                }}
                className={`pk-ui flex cursor-pointer items-center justify-between rounded-[12px] border px-3 py-2.5 transition-colors ${isSelected ? "text-white" : "hover:border-[#0070f3]"}`}
                style={{ borderColor: isSelected ? "#1f1f1f" : "#ebebeb", background: isSelected ? "#1f1f1f" : "#f8f8f8" }}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${isStaged ? "bg-[#f5a623]" : "bg-[#0070f3]"}`} />
                  <span className="font-mono text-xs" style={{ color: isSelected ? "white" : "#1a1a1a" }}>{zp.t.toFixed(1)}s</span>
                  <span className="font-mono text-[10px]" style={{ color: isSelected ? "rgba(255,255,255,0.6)" : "#888" }}>{zp.to.scale.toFixed(1)}×</span>
                  {isStaged && <span className="pk-chip pk-chip-amber">staged</span>}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); isStaged ? removeStagedZoom(zp.id) : removeZoomPoint(zp.id); }}
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[11px] leading-none transition-colors ${isSelected ? "text-white/70 hover:bg-white/15" : "text-[#888] hover:bg-[#d3e5ff] hover:text-[#0070f3]"}`}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {allZooms.length === 0 && (
        <div className="mt-3 rounded-[12px] border p-4 text-center" style={{ borderColor: "#ebebeb", background: "#f8f8f8" }}>
          <p className="text-xs" style={{ color: "#888" }}>No zooms yet. Add one at the playhead or click the preview.</p>
        </div>
      )}
    </div>
  );
}
