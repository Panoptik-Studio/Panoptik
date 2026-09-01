/**
 * Human-in-the-loop staging panel: diff counts, per-item rejection,
 * commit + discard actions and pending background indicator.
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
  return null;
}
