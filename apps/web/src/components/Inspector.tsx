/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 3.4/3.5.
 * Zoom inspector: depth / duration / easing / focal / delete for selectedZoomId
 * (a field in B's store — consume, never edit the store file).
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";
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
        <span className="text-[11px] font-medium" style={{ color: "#4d4d4d" }}>{label}</span>
        <span className="font-mono text-[11px]" style={{ color: "#888" }}>{value}</span>
      </div>
      {children}
    </div>
  );
}

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const commitDrag = useProjectStore((s) => s.commitDrag);
  const seek = useProjectStore((s) => s.seek);

  if (!project) return null;

  const zoom: ZoomPoint | undefined =
    project.zoomPoints.find((z) => z.id === selectedZoomId) ??
    project.stagedZoomPoints.find((z) => z.id === selectedZoomId);

  if (!zoom) {
    return (
      <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
        <h3 className="mb-1 text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>
          Zoom settings
        </h3>
        <p className="font-mono text-[11px]" style={{ color: "#888" }}>
          Select a zoom — click its handle on the canvas, its diamond on the timeline, or a row above.
        </p>
      </div>
    );
  }

  // Live edit, then snapshot on release so a drag is one undo step.
  const patch = (updates: Partial<ZoomPoint>) => updateZoomPoint(zoom.id, updates);
  const patchTo = (to: Partial<ZoomPoint["to"]>) => patch({ to: { ...zoom.to, ...to } });

  return (
    <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>
          Zoom settings
        </h3>
        <div className="flex items-center gap-1.5">
          {zoom.staged && (
            <span className="rounded-full bg-[#ffefcf] px-1.5 py-px font-mono text-[9px] font-medium" style={{ color: "#ab570a" }}>
              staged
            </span>
          )}
          <button
            onClick={() => seek(zoom.t)}
            className="rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors hover:border-[#0070f3] hover:text-[#0070f3]"
            style={{ borderColor: "#ebebeb", color: "#888" }}
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
          className="w-full accent-[#0070f3]"
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
          className="w-full accent-[#0070f3]"
        />
      </Row>

      <Row label="Hold" value={`${(zoom.hold ?? 2).toFixed(2)}s`}>
        <input
          type="range"
          min={0.2}
          max={5}
          step={0.1}
          value={zoom.hold ?? 2}
          onChange={(e) => patch({ hold: Number(e.target.value) })}
          onPointerUp={commitDrag}
          onKeyUp={commitDrag}
          className="w-full accent-[#0070f3]"
        />
      </Row>

      <Row label="Focal" value={`${zoom.to.x.toFixed(2)}, ${zoom.to.y.toFixed(2)}`}>
        <div className="flex gap-2">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom.to.x}
            onChange={(e) => patchTo({ x: Number(e.target.value) })}
            onPointerUp={commitDrag}
            onKeyUp={commitDrag}
            className="w-full accent-[#0070f3]"
            aria-label="Focal X"
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={zoom.to.y}
            onChange={(e) => patchTo({ y: Number(e.target.value) })}
            onPointerUp={commitDrag}
            onKeyUp={commitDrag}
            className="w-full accent-[#0070f3]"
            aria-label="Focal Y"
          />
        </div>
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
                className="flex-1 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors"
                style={{
                  background: active ? "#171717" : "#fafafa",
                  borderColor: active ? "#171717" : "#ebebeb",
                  color: active ? "#ffffff" : "#4d4d4d",
                }}
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
          className="flex-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors hover:border-[#0070f3] hover:text-[#0070f3]"
          style={{ borderColor: "#ebebeb", color: "#4d4d4d" }}
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
          className="rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors hover:bg-[#fff0f0]"
          style={{ borderColor: "#ebebeb", color: "#e11d48" }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
