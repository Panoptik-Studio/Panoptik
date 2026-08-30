/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 3.4/3.5.
 * Zoom inspector: depth / duration / easing / focal / delete for selectedZoomId
 * (a field in B's store — consume, never edit the store file).
 * Zoom points live on the selected segment, so lookups and the seek-to-keyframe
 * (on-timeline) both go through it.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";
import { sourceToTimeline } from "@panoptik/engine";
import { mediaForSegment } from "@panoptik/schema";
import type { ZoomPoint } from "@panoptik/schema";

const EASE_OPTIONS: { value: string; label: string }[] = [
  { value: "easeInOutCubic", label: "Smooth" },
  { value: "easeOutCubic", label: "Ease out" },
  { value: "linear", label: "Linear" },
];

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="pk-label">{label}</span>
        <span className="pk-help">{value}</span>
      </div>
      {children}
    </div>
  );
}

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const commitDrag = useProjectStore((s) => s.commitDrag);
  const seek = useProjectStore((s) => s.seek);

  if (!project) return null;

  const seg = project.segments.find((s) => s.id === selectedSegmentId);

  const zoom: ZoomPoint | undefined = seg
    ? seg.zoomPoints.find((z) => z.id === selectedZoomId) ??
      seg.stagedZoomPoints.find((z) => z.id === selectedZoomId)
    : undefined;

  // Source clip row — shows which media this segment cuts from (multiclip)
  const sourceMedia = seg ? mediaForSegment(project, seg) : null;
  const sourceIndex = sourceMedia ? project.media.findIndex((m) => m.id === sourceMedia.id) : -1;

  if (!zoom) {
    return (
      <div className="pk-panel">
        {seg && sourceMedia && project.media.length > 1 && (
          <div className="mb-3 rounded border border-pk-hairline bg-pk-surface-soft px-2.5 py-2">
            <div className="pk-label">Source clip</div>
            <div className="pk-help mt-1 flex items-center gap-2">
              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium border border-pk-hairline">Clip {sourceIndex + 1}</span>
              <span className="truncate">{sourceMedia.width}×{sourceMedia.height} · {sourceMedia.duration.toFixed(1)}s</span>
              <span className="ml-auto font-mono text-[10px] text-pk-faint">{sourceMedia.id.slice(0, 6)}</span>
            </div>
          </div>
        )}
        <h3 className="pk-panel-title mb-1">
          Zoom settings
        </h3>
        <p className="pk-help">
          Select a zoom
        </p>
      </div>
    );
  }

  // Live edit, then snapshot on release so a drag is one undo step.
  const patch = (updates: Partial<ZoomPoint>) => updateZoomPoint(zoom.id, updates);
  const patchTo = (to: Partial<ZoomPoint["to"]>) => patch({ to: { ...zoom.to, ...to } });

  return (
    <div className="pk-panel">
      {sourceMedia && project.media.length > 1 && (
        <div className="mb-3 rounded border border-pk-hairline bg-pk-surface-soft px-2.5 py-2">
          <div className="pk-label">Source clip</div>
          <div className="pk-help mt-1 flex items-center gap-2">
            <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium border border-pk-hairline">Clip {sourceIndex + 1}</span>
            <span className="truncate">{sourceMedia.width}×{sourceMedia.height} · {sourceMedia.duration.toFixed(1)}s</span>
            <span className="ml-auto font-mono text-[10px] text-pk-faint">{sourceMedia.id.slice(0, 6)}</span>
          </div>
        </div>
      )}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="pk-panel-title">
          Zoom settings
        </h3>
        <div className="flex items-center gap-1.5">
          {zoom.staged && (
            <span className="pk-chip pk-chip-amber">
              staged
            </span>
          )}
          <button
            onClick={() => {
              // zoom.t is source-relative — land the playhead on the keyframe's
              // on-timeline position in its segment.
              if (!seg) return;
              const st = sourceToTimeline(project, seg.id, zoom.t);
              if (st != null) seek(st);
            }}
            className="pk-chip"
            title="Move the playhead to this zoom"
          >
            {zoom.t.toFixed(2)}s
          </button>
        </div>
      </div>

      <Row label="Depth" value={`${zoom.to.scale.toFixed(2)}×`}>
        <input
          type="range"
          min={1}
          max={6}
          step={0.05}
          value={zoom.to.scale}
          onChange={(e) => patchTo({ scale: Number(e.target.value) })}
          onPointerUp={commitDrag}
          onKeyUp={commitDrag}
          className="pk-range"
        />
      </Row>

      <Row label="Zoom in" value={`${zoom.dur.toFixed(2)}s`}>
        <input
          type="range"
          min={0.1}
          max={3}
          step={0.05}
          value={zoom.dur}
          onChange={(e) => patch({ dur: Number(e.target.value) })}
          onPointerUp={commitDrag}
          onKeyUp={commitDrag}
          className="pk-range"
        />
      </Row>



      <Row label="Easing" value="">
        <div className="flex gap-1">
          {EASE_OPTIONS.map((o) => {
            const active = zoom.ease === o.value;
            return (
              <button
                key={o.value}
                onClick={() => {
                  patch({ ease: o.value });
                  commitDrag();
                }}
                className="pk-seg flex-1"
                data-active={active}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </Row>

      <div className="mt-3 flex gap-2 border-t pt-3" style={{ borderColor: "#ebebeb" }}>
        <button
          onClick={() => {
            patchTo({ scale: 1, x: 0.5, y: 0.5 });
            commitDrag();
          }}
          className="pk-btn pk-btn-ghost pk-btn-sm flex-1"
          title="Make this keyframe pull the camera back out"
        >
          Reset to full frame
        </button>
        <button
          onClick={() => {
            if (zoom.staged) removeStagedZoom(zoom.id);
            else removeZoomPoint(zoom.id);
            setSelectedZoom(null);
          }}
          className="pk-btn pk-btn-danger pk-btn-sm"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
