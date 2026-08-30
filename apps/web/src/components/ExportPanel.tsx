/**
 * OWNER: DEV A — ROADMAP-A.md Tasks 3.2 (modal + progress via "export-progress"
 * events) and 5.3 (declarative WebMCP form: tool-name / tool-description attrs,
 * human-click submit only).
 */
"use client";

import { useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useVideoExport } from "@/lib/useVideoExport";
import type { ExportOpts , ExportFps } from "@panoptik/schema";
import { DEFAULT_EXPORT_FPS, EXPORT_FPS_OPTIONS } from "@panoptik/schema";

const RESOLUTIONS: ExportOpts["resolution"][] = ["720p", "1080p", "4k"];
const FORMATS: ExportOpts["format"][] = ["mp4", "webm"];

export function ExportPanel() {
  const project = useProjectStore((s) => s.project);
  const [resolution, setResolution] = useState<ExportOpts["resolution"]>("1080p");
  const [format, setFormat] = useState<ExportOpts["format"]>("mp4");
  const [fps, setFps] = useState<ExportFps>(DEFAULT_EXPORT_FPS);
  const { progress, error, result, run, isExporting } = useVideoExport();
  const handleExport = () => run({ format, resolution, fps });

  if (!project) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Export</h3>
        <p className="pk-help">Load a clip to export.</p>
      </div>
    );
  }

  const busy = isExporting;

  return (
    <div className="pk-panel">
      <h3 className="pk-panel-title mb-3">Export</h3>

      <p className="pk-label mb-1.5">Resolution</p>
      <div className="mb-3 grid grid-cols-3 gap-1.5">
        {RESOLUTIONS.map((r) => (
          <button
            key={r}
            onClick={() => setResolution(r)}
            disabled={busy}
            className="pk-seg uppercase"
            data-active={resolution === r}
          >
            {r}
          </button>
        ))}
      </div>

      <p className="pk-label mb-1.5">Format</p>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {FORMATS.map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            disabled={busy}
            className="pk-seg uppercase"
            data-active={format === f}
          >
            {f}
          </button>
        ))}
      </div>

      <p className="pk-label mb-1.5">Frame rate</p>
      <div className="mb-1.5 grid grid-cols-3 gap-1.5">
        {EXPORT_FPS_OPTIONS.map((f) => (
          <button
            key={f}
            onClick={() => setFps(f)}
            disabled={busy}
            className="pk-seg"
            data-active={fps === f}
            title={
              f === DEFAULT_EXPORT_FPS
                ? "Standard"
                : f < DEFAULT_EXPORT_FPS
                  ? "Fewer frames — smaller file"
                  : "Smoother, larger file"
            }
          >
            {f} fps
          </button>
        ))}
      </div>
      <p className="pk-help mb-3" style={{ fontSize: 11 }}>
        {fps < DEFAULT_EXPORT_FPS
          ? "Fewer frames per second, so a smaller file. Fine for screen demos."
          : fps > DEFAULT_EXPORT_FPS
            ? "Smoother motion, larger file. Only helps if the recording itself is that fast."
            : "Standard for screen recordings."}
      </p>

      <button
        onClick={handleExport}
        disabled={busy}
        className="pk-btn pk-btn-primary pk-btn-md w-full"
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
          className="pk-btn pk-btn-ghost pk-btn-md mt-2 w-full"
        >
          Download · {(result.size / 1_000_000).toFixed(1)} MB
        </a>
      )}

      {error && (
        <p className="mt-2 rounded-lg px-2.5 py-2 text-[11px]" style={{ background: "#fff0f0", color: "#e11d48" }}>
          {error}
        </p>
      )}
    </div>
  );
}
