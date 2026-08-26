/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 3.2 (modal + progress via "export-progress"
 * events) and 5.3 (declarative WebMCP form: tool-name / tool-description attrs,
 * human-click submit only).
 */
"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useVideoExport } from "@/lib/useVideoExport";
import type { ExportOpts } from "@panoptik/schema";

const RESOLUTIONS: ExportOpts["resolution"][] = ["720p", "1080p", "4k"];
const FORMATS: ExportOpts["format"][] = ["mp4", "webm"];

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const [resolution, setResolution] = useState<ExportOpts["resolution"]>("1080p");
  const [format, setFormat] = useState<ExportOpts["format"]>("mp4");
  const [burnCaptions, setBurnCaptions] = useState(true);
  const { progress, error, result, run, isExporting } = useVideoExport();
  const handleExport = () => run({ format, resolution, burnCaptions });

  if (!project) {
    return (
      <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
        <h3 className="mb-1 text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>Export</h3>
        <p className="font-mono text-[11px]" style={{ color: "#888" }}>Load a clip to export.</p>
      </div>
    );
  }

  const busy = isExporting;

  return (
    <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
      <h3 className="mb-3 text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>Export</h3>

      <p className="mb-1.5 text-xs font-medium" style={{ color: "#4d4d4d" }}>Resolution</p>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setResolution(r)}
            disabled={busy}
            className="rounded-full border px-2 py-1.5 text-[11px] font-medium uppercase transition-colors disabled:opacity-40"
            style={{
              background: resolution === r ? "#171717" : "#ffffff",
              borderColor: resolution === r ? "#171717" : "#ebebeb",
              color: resolution === r ? "#ffffff" : "#4d4d4d",
            }}
          >
            {r}
          </button>
        ))}
      </div>

      <p className="mb-1.5 text-xs font-medium" style={{ color: "#4d4d4d" }}>Format</p>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {FORMATS.map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            disabled={busy}
            className="rounded-full border px-2 py-1.5 text-[11px] font-medium uppercase transition-colors disabled:opacity-40"
            style={{
              background: format === f ? "#171717" : "#ffffff",
              borderColor: format === f ? "#171717" : "#ebebeb",
              color: format === f ? "#ffffff" : "#4d4d4d",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <label className="mb-3 flex items-center gap-2 text-[11px]" style={{ color: "#4d4d4d" }}>
        <input
          type="checkbox"
          checked={burnCaptions}
          onChange={(e) => setBurnCaptions(e.target.checked)}
          disabled={busy}
          className="accent-[#171717]"
        />
        Burn in captions
      </label>

      <button
        onClick={handleExport}
        disabled={busy}
        className="flex w-full items-center justify-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white transition-colors disabled:opacity-60"
        style={{ background: "#171717" }}
        onMouseEnter={(e) => { if (!busy) e.currentTarget.style.background = "#0070f3"; }}
        onMouseLeave={(e) => { if (!busy) e.currentTarget.style.background = "#171717"; }}
      >
        {busy ? `Exporting… ${Math.round((progress ?? 0) * 100)}%` : "Export video"}
      </button>

      {busy && (
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full" style={{ background: "#ebebeb" }}>
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${Math.round((progress ?? 0) * 100)}%`, background: "#0070f3" }}
          />
        </div>
      )}

      {result && (
        <a
          href={result.url}
          download={`panoptik-${resolution}.${result.format}`}
          className="mt-2 flex items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-xs font-medium transition-colors hover:border-[#0070f3] hover:text-[#0070f3]"
          style={{ borderColor: "#ebebeb", color: "#171717" }}
        >
          Download · {(result.size / 1_000_000).toFixed(1)} MB
        </a>
      )}

      {error && (
        <p className="mt-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ background: "#fff0f0", color: "#e11d48" }}>
          {error}
        </p>
      )}

      <p className="mt-2 font-mono text-[10px]" style={{ color: "#888" }}>
        Renders every frame through the same pipeline as the preview.
      </p>
    </div>
  );
}
