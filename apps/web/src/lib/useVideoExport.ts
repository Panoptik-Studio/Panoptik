/**
 * Shared export driver for the toolbar CTA and the export panel.
 * Progress arrives as "export-progress" window events from the engine, so every
 * mounted consumer reflects an export no matter which one started it.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { engine } from "@/lib/engineProvider";
import { useProjectStore } from "@/stores/projectStore";
import type { ExportOpts } from "@panoptik/schema";

export type ExportResult = { url: string; size: number; format: ExportOpts["format"] };

/** Encoding saturates the machine; a second concurrent run would stall both. */
let exportInFlight = false;

export function useVideoExport() {
  const project = useProjectStore((s) => s.project);
  // Progress lives in the store as well, so the whole editor can lock itself
  // for the duration rather than each surface tracking it separately.
  const progress = useProjectStore((s) => s.exportProgress);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const onProgress = (e: Event) =>
      useProjectStore.getState().setExportProgress((e as CustomEvent<number>).detail);
    window.addEventListener("export-progress", onProgress);
    return () => window.removeEventListener("export-progress", onProgress);
  }, []);

  // An object URL outlives the component unless it is revoked.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const run = useCallback(
    async (opts: ExportOpts, { download = false }: { download?: boolean } = {}) => {
      if (!project || exportInFlight) return;
      exportInFlight = true;
      setError(null);
      useProjectStore.getState().beginExport();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setResult(null);
      try {
        // Speed is per-segment (applied inside the engine's per-segment export),
        // so there is no global playbackRate override to spread in here.
        // The frame aspect follows the currently-selected segment (like the
        // preview canvas does), so export is what-you-see-is-what-you-get.
        const selectedSegmentId = useProjectStore.getState().selectedSegmentId;
        const blob = await engine.exportProject(project, {
          ...opts,
          selectedSegmentId: selectedSegmentId ?? undefined,
        });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        const actualFormat: ExportOpts["format"] = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : opts.format;
        if (actualFormat !== opts.format) {
          console.warn(`[Export] requested ${opts.format} but delivered ${actualFormat} (aac not encodable, switched for maximal native compatibility)`);
        }
        setResult({ url, size: blob.size, format: actualFormat });
        // Record the export so the library can tell a finished clip from a
        // draft. Best-effort: a failed marker must never fail the export.
        try {
          const { markExported } = await import("@panoptik/engine");
          await markExported(project.id);
        } catch {
          /* the card just keeps showing as a draft */
        }
        if (download) {
          const a = document.createElement("a");
          a.href = url;
          a.download = `panoptik-${opts.resolution}.${actualFormat}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        exportInFlight = false;
        useProjectStore.getState().endExport();
      }
    },
    [project],
  );

  return { progress, error, result, run, isExporting: progress !== null };
}
