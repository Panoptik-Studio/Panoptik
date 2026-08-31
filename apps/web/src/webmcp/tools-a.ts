/**
 * WebMCP Engine Tools (Read-only project inspection + Gated Export).
 * Registered via registerToolWithLifecycle.
 */

import { registerToolWithLifecycle } from "./lifecycle";
import { useProjectStore } from "../stores/projectStore";
import { projectDuration, segmentDuration } from "@panoptik/engine";
import { engine } from "@/lib/engineProvider";
import { showConfirmDialog } from "./confirm";
import type { ExportFps, ExportOpts } from "@panoptik/schema";
import { DEFAULT_EXPORT_FPS } from "@panoptik/schema";

export function registerEngineTools(): void {
  // ── READ-ONLY PROJECT INSPECTION TOOLS ──

  registerToolWithLifecycle({
    name: "get_project_state",
    description:
      "Returns the complete project state: duration, dimensions, segments, committed & staged zoom keyframes, text overlays, audio tracks, facecam PiP, aspect ratio, background, and user interaction click log. Use this first to understand the existing project before proposing changes.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return { error: "No project loaded. Ask the user to import or record a clip first." };
      }

      const totalDur = projectDuration(project);
      const media = project.media[0];
      const dimensions = media ? `${media.width}x${media.height}` : "1920x1080";

      let allCommittedZooms = 0;
      let allStagedZooms = 0;
      let allTextOverlays = 0;
      let allStagedTextOverlays = 0;

      for (const seg of project.segments) {
        allCommittedZooms += seg.zoomPoints?.length ?? 0;
        allStagedZooms += seg.stagedZoomPoints?.length ?? 0;
        allTextOverlays += seg.textOverlays?.length ?? 0;
        allStagedTextOverlays += seg.stagedTextOverlays?.length ?? 0;
      }

      const audioTrackCount = project.audioTracks?.length ?? 0;
      const facecamPresent = project.segments.some((s) => !!s.facecam.src);

      return {
        projectId: project.id,
        durationSeconds: Number(totalDur.toFixed(2)),
        dimensions,
        segmentCount: project.segments.length,
        segments: project.segments.map((seg, i) => ({
          index: i + 1,
          id: seg.id,
          name: seg.name ?? `Clip ${i + 1}`,
          duration: Number(segmentDuration(seg).toFixed(2)),
          speed: seg.speed,
          aspect: seg.aspectPreset,
          transition: seg.transition ?? "cut",
          background: seg.background,
          facecam: seg.facecam,
          zoomPoints: (seg.zoomPoints ?? []).map((z) => ({
            id: z.id,
            t: Number(z.t.toFixed(2)),
            scale: z.to.scale,
            focalPoint: `(${z.to.x.toFixed(2)}, ${z.to.y.toFixed(2)})`,
          })),
          stagedZooms: (seg.stagedZoomPoints ?? []).map((z) => ({
            id: z.id,
            t: Number(z.t.toFixed(2)),
            scale: z.to.scale,
          })),
          textOverlays: seg.textOverlays ?? [],
          stagedTextOverlays: seg.stagedTextOverlays ?? [],
        })),
        totalCommittedZooms: allCommittedZooms,
        totalStagedZooms: allStagedZooms,
        totalTextOverlays: allTextOverlays,
        totalStagedTextOverlays: allStagedTextOverlays,
        audioTracks: (project.audioTracks ?? []).map((a) => ({
          id: a.id,
          name: a.name ?? "Audio track",
          kind: a.kind,
          startT: a.startT,
          volume: a.volume,
          ducking: a.ducking,
        })),
        facecamPresent,
        aspectPreset: project.segments[0]?.aspectPreset ?? "source",
        background: project.segments[0]?.background ?? { kind: "solid", color: "#000000" },
        clickLogCount: project.clickLog?.length ?? 0,
      };
    },
  });

  registerToolWithLifecycle({
    name: "list_scenes",
    description:
      "Returns a list of all timeline segments (scenes) with their cumulative timeline start/end timestamps, duration, speed, and transitions.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      let timelineCursor = 0;
      const scenes = project.segments.map((seg, idx) => {
        const dur = segmentDuration(seg);
        const start = timelineCursor;
        const end = timelineCursor + dur;
        timelineCursor = end;

        return {
          index: idx + 1,
          id: seg.id,
          name: seg.name ?? `Scene ${idx + 1}`,
          timelineStart: Number(start.toFixed(2)),
          timelineEnd: Number(end.toFixed(2)),
          duration: Number(dur.toFixed(2)),
          speed: seg.speed,
          transition: seg.transition ?? "cut",
        };
      });

      return {
        totalScenes: scenes.length,
        totalDuration: Number(timelineCursor.toFixed(2)),
        scenes,
      };
    },
  });

  registerToolWithLifecycle({
    name: "get_click_log",
    description:
      "Returns the continuous cursor trajectory and click interaction timestamps recorded during the session. Can also interpolate the exact cursor (x, y) at a specific timestamp.",
    inputSchema: {
      type: "object",
      properties: {
        atTimestamp: {
          type: "number",
          description: "Optional: interpolate and return the exact cursor (x, y) at this specific video timestamp",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ atTimestamp }: { atTimestamp?: number } = {}) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return { error: "No project loaded. Ask the user to import or record a clip first." };
      }

      const clicks = project.clickLog ?? [];

      // If atTimestamp requested, find nearest cursor coordinate or interpolate
      if (typeof atTimestamp === "number") {
        if (clicks.length === 0) {
          return { t: atTimestamp, x: 0.5, y: 0.5, interpolated: false, count: 0 };
        }
        const sorted = [...clicks].sort((a, b) => a.t - b.t);
        const exact = sorted.find((c) => Math.abs(c.t - atTimestamp) < 0.05);
        if (exact) {
          return { t: exact.t, x: exact.x, y: exact.y, type: exact.type, count: clicks.length };
        }
        // Find surrounding points
        let prev = sorted[0]!;
        let next = sorted[sorted.length - 1]!;
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i]!.t <= atTimestamp && sorted[i + 1]!.t >= atTimestamp) {
            prev = sorted[i]!;
            next = sorted[i + 1]!;
            break;
          }
        }
        const span = next.t - prev.t;
        const alpha = span > 0.001 ? Math.max(0, Math.min(1, (atTimestamp - prev.t) / span)) : 0;
        const interpX = Number((prev.x + alpha * (next.x - prev.x)).toFixed(3));
        const interpY = Number((prev.y + alpha * (next.y - prev.y)).toFixed(3));
        return { t: atTimestamp, x: interpX, y: interpY, type: "interpolated", count: clicks.length };
      }

      const clickOnly = clicks.filter((c) => c.type === "click" || c.type === "manual");

      const formatted = clicks.slice(0, 300).map((c) => ({
        t: Number(c.t.toFixed(2)),
        x: Number(c.x.toFixed(3)),
        y: Number(c.y.toFixed(3)),
        type: c.type,
      }));

      return {
        count: clicks.length,
        clickCount: clickOnly.length,
        clicks: formatted,
        trajectory: formatted,
        suggestedZoomTimestamps: clickOnly.slice(0, 15).map((c) => Number(c.t.toFixed(2))),
      };
    },
  });

  // ── WRITE / EXPORT TOOL (Confirmation-Gated) ──

  registerToolWithLifecycle({
    name: "export_clip",
    description:
      "Renders and exports the edited video locally in the browser via WebCodecs. Prompts the human for confirmation before encoding. Returns a downloadable Blob URL and file metadata upon completion.",
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["mp4", "webm"],
          description: "Video container format. 'mp4' (H.264) is most compatible; 'webm' (VP9) is smaller.",
        },
        resolution: {
          type: "string",
          enum: ["720p", "1080p", "4k"],
          description: "Export resolution. '1080p' is standard HD, '720p' is faster, '4k' is ultra high-res.",
        },
        fps: {
          type: "number",
          enum: [24, 30, 60],
          description: "Output frame rate (default 30).",
        },
      },
      required: ["format", "resolution"],
    },
    execute: async ({
      format,
      resolution,
      fps,
    }: {
      format: ExportOpts["format"];
      resolution: ExportOpts["resolution"];
      fps?: ExportFps;
    }) => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) {
        return { error: "No project loaded to export." };
      }

      const targetFps = fps ?? DEFAULT_EXPORT_FPS;
      const confirmed = await showConfirmDialog({
        message: `Export video as ${format.toUpperCase()} (${resolution}, ${targetFps} fps)? Rendering will run locally on your device.`,
      });

      if (!confirmed) {
        return {
          exported: false,
          reason: "user_declined",
          message: "Export cancelled by user.",
        };
      }

      try {
        store.beginExport();
        const selectedSegmentId = store.selectedSegmentId ?? undefined;
        const blob = await engine.exportProject(project, {
          format,
          resolution,
          fps: targetFps,
          selectedSegmentId,
        });

        store.endExport();
        const url = URL.createObjectURL(blob);
        const fileSizeMB = (blob.size / (1024 * 1024)).toFixed(2);

        return {
          exported: true,
          downloadUrl: url,
          fileName: `panoptik-${resolution}.${format}`,
          fileSizeMB: `${fileSizeMB} MB`,
          format,
          resolution,
          fps: targetFps,
          message: `Export complete! Video rendered at ${resolution} (${fileSizeMB} MB).`,
        };
      } catch (err) {
        store.endExport();
        return {
          exported: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });
}
