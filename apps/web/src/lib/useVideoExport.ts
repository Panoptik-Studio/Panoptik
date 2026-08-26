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
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const onProgress = (e: Event) => setProgress((e as CustomEvent<number>).detail);
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
      setProgress(0);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setResult(null);
      try {
        const blob = await engine.exportProject(project, opts);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setResult({ url, size: blob.size, format: opts.format });
        if (download) {
          const a = document.createElement("a");
          a.href = url;
          a.download = `panoptik-${opts.resolution}.${opts.format}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        exportInFlight = false;
        setProgress(null);
      }
    },
    [project],
  );

  return { progress, error, result, run, isExporting: progress !== null };
}
