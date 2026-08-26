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
        <span className="truncate text-[11px]" style={{ color: "#171717" }}>{label}</span>
        <span className="shrink-0 font-mono text-[10px]" style={{ color: "#ab570a" }}>{detail}</span>
      </div>
      <button
        onClick={onReject}
        title="Reject this proposal"
        className="shrink-0 rounded-full px-1.5 text-[10px] leading-none transition-colors hover:bg-white"
        style={{ color: "#ab570a" }}
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
        <h3 className="text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>
          Proposed changes
        </h3>
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[10px] font-medium"
          style={{ background: "#ffefcf", color: "#ab570a", border: "1px solid #ffe8c2" }}
        >
          {total} pending
        </span>
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
          className="flex-1 rounded-full px-3 py-2 text-[11px] font-medium text-white transition-colors"
          style={{ background: "#171717" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#0070f3")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "#171717")}
        >
          Apply all
        </button>
        <button
          onClick={clearStaged}
          className="rounded-full border px-3 py-2 text-[11px] font-medium transition-colors hover:bg-white"
          style={{ borderColor: "#ebebeb", color: "#4d4d4d" }}
        >
          Discard
        </button>
      </div>

      <p className="mt-2 font-mono text-[10px]" style={{ color: "#ab570a" }}>
        Proposals are drawn amber and do not affect the video until applied.
      </p>
    </div>
  );
}
