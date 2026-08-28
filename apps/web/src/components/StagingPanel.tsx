/**
 * OWNER: DEV A — ROADMAP-A.md Task 3.5.
 * The human-in-the-loop centerpiece: getStagedDiff() counts, per-item rejection
 * (removeStagedZoom / removeStagedTextOverlay / clearStagedCaptions),
 * Commit + Discard buttons, pending-background badge. All store consumption,
 * no store-file edits.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";

function Row({
  label,
  detail,
  onReject,
}: {
  label: string;
  detail: string;
  onReject: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
      style={{ borderColor: "#ffe8c2", background: "#fffaf2" }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "#f5a623" }} />
        <span className="pk-ui truncate text-[12px]" style={{ color: "#1a1a1a" }}>{label}</span>
        <span className="shrink-0 font-mono text-[10px]" style={{ color: "#ab570a" }}>{detail}</span>
      </div>
      <button
        onClick={onReject}
        title="Reject this proposal"
        className="pk-icon-btn h-6 w-6 shrink-0 text-[11px] leading-none"
        style={{ color: "#ab570a", background: "transparent", borderColor: "transparent" }}
      >
        ✕
      </button>
    </div>
  );
}

export function StagingPanel() {
  const project = useProjectStore((s) => s.project);
  const pendingBackgroundBadge = useProjectStore((s) => s.pendingBackgroundBadge);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const removeStagedTextOverlay = useProjectStore((s) => s.removeStagedTextOverlay);
  const clearStagedCaptions = useProjectStore((s) => s.clearStagedCaptions);
  const commitAll = useProjectStore((s) => s.commitAll);
  const clearStaged = useProjectStore((s) => s.clearStaged);

  if (!project) return null;

  const { stagedZoomPoints, stagedTextOverlays, stagedCaptions } = project;
  const total =
    stagedZoomPoints.length +
    stagedTextOverlays.length +
    stagedCaptions.length +
    (pendingBackgroundBadge ? 1 : 0);

  // Nothing proposed — staying out of the way is the right state here.
  if (total === 0) return null;

  return (
    <div className="border-b p-4" style={{ borderColor: "#ebebeb", background: "#fffdf8" }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="pk-panel-title">
          Proposed changes
        </h3>
        <span className="pk-chip pk-chip-amber">{total} pending</span>
      </div>

      <div className="space-y-1.5">
        {stagedZoomPoints.map((z) => (
          <Row
            key={z.id}
            label={`Zoom at ${z.t.toFixed(1)}s`}
            detail={`${z.to.scale.toFixed(1)}×`}
            onReject={() => removeStagedZoom(z.id)}
          />
        ))}
        {stagedTextOverlays.map((t) => (
          <Row
            key={t.id}
            label={`“${t.text}”`}
            detail={`${t.timestamp.toFixed(1)}s`}
            onReject={() => removeStagedTextOverlay(t.id)}
          />
        ))}
        {stagedCaptions.length > 0 && (
          <Row
            label="Captions"
            detail={`${stagedCaptions.length} lines`}
            onReject={clearStagedCaptions}
          />
        )}
        {pendingBackgroundBadge && (
          <Row label="Background change" detail="preview" onReject={clearStaged} />
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={commitAll}
          className="pk-btn pk-btn-primary pk-btn-sm flex-1"
        >
          Apply all
        </button>
        <button
          onClick={clearStaged}
          className="pk-btn pk-btn-ghost pk-btn-sm"
        >
          Discard
        </button>
      </div>

      <p className="pk-help mt-2" style={{ color: "#ab570a", fontSize: 11 }}>
        Proposals are drawn amber and do not affect the video until applied.
      </p>
    </div>
  );
}
