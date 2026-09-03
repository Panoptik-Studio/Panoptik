/**
 * WebMCP Engine Tools (Read-only project inspection + Gated Export).
 * Registered via registerToolWithLifecycle.
 *
 * TIME SPACE CONTRACT: every timestamp these tools return is in CURRENT
 * TIMELINE seconds at the `timelineRevision` included in the response.
 * Source-media timestamps (analysis cache, click log, stored edits) are mapped
 * via timeSpace.ts before returning, and moments trimmed out of the timeline
 * are dropped. Agents therefore never need to convert source↔timeline
 * themselves — they only must RE-INGEST after the revision changes.
 */

import { registerToolWithLifecycle } from "./lifecycle";
import { useProjectStore } from "../stores/projectStore";
import { projectDuration, segmentDuration } from "@panoptik/engine";
import { engine } from "@/lib/engineProvider";
import { showConfirmDialog } from "./confirm";
import { getAnalysisCache } from "./tools-batch";
import { getTimelineRevision, STALENESS_CONTRACT } from "./revision";
import { directorPlaybookBlock } from "./playbook";
import {
  mapIntervalToTimeline,
  sourceToTimelineT,
} from "./timeSpace";
import type { ExportFps, ExportOpts } from "@panoptik/schema";
import { DEFAULT_EXPORT_FPS } from "@panoptik/schema";

export function registerEngineTools(): void {
  // ── READ-ONLY PROJECT INSPECTION TOOLS ──

  registerToolWithLifecycle({
    name: "get_project_state",
    description:
      "MANDATORY FIRST STEP for any video editing, review, or enhancement request. Returns the full project: clips, durations, zooms, overlays, audio, plus the Director Playbook and the autonomous decision tree for vague requests like 'edit this video'. All timestamps are CURRENT TIMELINE seconds; check timelineRevision — if it changed since your last read, your cached observations are stale and you MUST re-ingest.",
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
      const revision = getTimelineRevision();

      // Display helper: stored source seconds → current timeline seconds.
      const mapT = (t: number, mediaId: string): number =>
        Number((sourceToTimelineT(project, t, mediaId) ?? t).toFixed(2));

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
        timelineRevision: revision,
        timeSpace: "timeline",
        durationSeconds: Number(totalDur.toFixed(2)),
        mediaSourceDuration: media ? Number(media.duration.toFixed(2)) : null,
        dimensions,
        segmentCount: project.segments.length,
        segments: project.segments.map((seg, i) => ({
          index: i + 1,
          id: seg.id,
          name: seg.name ?? `Clip ${i + 1}`,
          timelineStart: Number(
            project
              .segments.slice(0, i)
              .reduce((acc, s) => acc + segmentDuration(s), 0)
              .toFixed(2),
          ),
          duration: Number(segmentDuration(seg).toFixed(2)),
          speed: seg.speed,
          aspect: seg.aspectPreset,
          transition: seg.transition ?? "cut",
          background: seg.background,
          facecam: seg.facecam,
          zoomPoints: (seg.zoomPoints ?? []).map((z) => ({
            id: z.id,
            t: mapT(z.t, seg.mediaId),
            scale: z.to.scale,
            focalPoint: `(${z.to.x.toFixed(2)}, ${z.to.y.toFixed(2)})`,
          })),
          stagedZooms: (seg.stagedZoomPoints ?? []).map((z) => ({
            id: z.id,
            t: mapT(z.t, seg.mediaId),
            scale: z.to.scale,
          })),
          textOverlays: (seg.textOverlays ?? []).map((o) => ({
            ...o,
            timestamp: mapT(o.timestamp, seg.mediaId),
          })),
          stagedTextOverlays: (seg.stagedTextOverlays ?? []).map((o) => ({
            ...o,
            timestamp: mapT(o.timestamp, seg.mediaId),
          })),
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
        audioTrackCount,
        facecamPresent,
        aspectPreset: project.segments[0]?.aspectPreset ?? "source",
        background: project.segments[0]?.background ?? { kind: "solid", color: "#000000" },
        clickLogCount: project.clickLog?.length ?? 0,
        stalenessContract: STALENESS_CONTRACT,
        directorPlaybook: directorPlaybookBlock(),
      };
    },
  });

  registerToolWithLifecycle({
    name: "list_clips",
    description:
      "Returns all timeline video clips with cumulative start/end timestamps, durations, speeds, and transitions. All times are CURRENT TIMELINE seconds.",
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
      const clips = project.segments.map((seg, idx) => {
        const dur = segmentDuration(seg);
        const start = timelineCursor;
        const end = timelineCursor + dur;
        timelineCursor = end;

        return {
          clipIndex: idx,
          id: seg.id,
          name: seg.name ?? `Clip ${idx + 1}`,
          timelineStart: Number(start.toFixed(2)),
          timelineEnd: Number(end.toFixed(2)),
          duration: Number(dur.toFixed(2)),
          speed: seg.speed,
          transition: seg.transition ?? "cut",
          transitionDuration: seg.transitionDuration ?? 0.45,
        };
      });

      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        totalClips: clips.length,
        totalDuration: Number(timelineCursor.toFixed(2)),
        clips,
      };
    },
  });

  registerToolWithLifecycle({
    name: "list_scenes",
    description:
      "Returns all timeline segments (scenes) with cumulative timeline start/end timestamps, duration, speed, and transitions. All times are CURRENT TIMELINE seconds.",
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
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        totalScenes: scenes.length,
        totalDuration: Number(timelineCursor.toFixed(2)),
        scenes,
      };
    },
  });

  registerToolWithLifecycle({
    name: "get_silence_intervals",
    description:
      "Detects audio silence and dead-air intervals where the speaker is inactive, returned in CURRENT TIMELINE seconds. Use for ripple trimming: dead air >= 1.5s is a cut candidate ({op:'cut', dropSilence:true}). Requires transcription — call generate_captions first if status is PENDING_TRANSCRIPTION.",
    inputSchema: {
      type: "object",
      properties: {
        minDurationSec: {
          type: "number",
          description: "Minimum silence duration threshold in seconds (default 1.0).",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({ minDurationSec = 1.0 }: { minDurationSec?: number } = {}) => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) {
        return { error: "No project loaded." };
      }

      const totalDur = projectDuration(project);
      const cache = getAnalysisCache();
      const revision = getTimelineRevision();

      if (cache?.audio?.silences && cache.audio.silences.length > 0) {
        // Cache silences are SOURCE-media seconds — map to the current timeline
        // and drop moments that were trimmed away.
        const silences = cache.audio.silences
          .map((s) => mapIntervalToTimeline(project, s.start, s.end, cache.mediaId))
          .filter((s): s is { start: number; end: number } => s !== null)
          .map((s) => ({
            start: Number(s.start.toFixed(2)),
            end: Number(s.end.toFixed(2)),
            duration: Number((s.end - s.start).toFixed(2)),
          }))
          .filter((s) => s.duration >= minDurationSec)
          .sort((a, b) => a.start - b.start);
        return {
          timelineRevision: revision,
          timeSpace: "timeline",
          totalDuration: Number(totalDur.toFixed(2)),
          count: silences.length,
          silences,
        };
      }

      // Compute silences from transcript phrases (also source-space → mapped).
      const allTextOverlays = project.segments.flatMap((s) => [
        ...(s.textOverlays ?? []),
        ...(s.stagedTextOverlays ?? []),
      ]);
      const sourcePhrases =
        cache?.phrases && cache.phrases.length > 0
          ? cache.phrases
          : allTextOverlays
              .filter((o) => Boolean(o.text && o.text.trim()))
              .map((c) => ({
                start: c.timestamp,
                end: c.timestamp + (c.duration ?? 3),
                text: c.text,
                speaker: c.speaker === "Screen" ? 1 : 0,
              }));

      if (sourcePhrases.length === 0) {
        return {
          timelineRevision: revision,
          timeSpace: "timeline",
          totalDuration: Number(totalDur.toFixed(2)),
          count: 0,
          silences: [],
          status: "PENDING_TRANSCRIPTION",
          guidance: "Speech transcription has not run yet. Call `generate_captions` to transcribe audio before detecting silence intervals.",
        };
      }

      const phrases = sourcePhrases
        .map((p) => mapIntervalToTimeline(project, p.start, p.end))
        .filter((p): p is { start: number; end: number } => p !== null)
        .sort((a, b) => a.start - b.start);

      const silences: Array<{ start: number; end: number; duration: number }> = [];
      let prevEnd = 0;
      for (const p of phrases) {
        if (p.start - prevEnd >= minDurationSec) {
          silences.push({
            start: Number(prevEnd.toFixed(2)),
            end: Number(p.start.toFixed(2)),
            duration: Number((p.start - prevEnd).toFixed(2)),
          });
        }
        prevEnd = Math.max(prevEnd, p.end);
      }
      if (totalDur - prevEnd >= minDurationSec) {
        silences.push({
          start: Number(prevEnd.toFixed(2)),
          end: Number(totalDur.toFixed(2)),
          duration: Number((totalDur - prevEnd).toFixed(2)),
        });
      }

      return {
        timelineRevision: revision,
        timeSpace: "timeline",
        totalDuration: Number(totalDur.toFixed(2)),
        count: silences.length,
        silences,
      };
    },
  });

  registerToolWithLifecycle({
    name: "get_transcript",
    description:
      "Returns the spoken transcript with timestamps in CURRENT TIMELINE seconds. If empty, call generate_captions to transcribe. Re-fetch this after any cut/delete/speed change — earlier timestamps go stale when the timeline shifts.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) return { error: "No project loaded." };
      const allOverlays = project.segments.flatMap((s) => [
        ...(s.textOverlays ?? []),
        ...(s.stagedTextOverlays ?? []),
      ]);
      const cache = getAnalysisCache();
      const sourcePhrases =
        cache?.phrases && cache.phrases.length > 0
          ? cache.phrases
          : allOverlays
              .filter((o) => Boolean(o.text && o.text.trim()))
              .map((c) => ({
                start: c.timestamp,
                end: c.timestamp + (c.duration ?? 3),
                text: c.text,
                speaker: c.speaker === "Screen" ? 1 : 0,
              }));

      if (sourcePhrases.length === 0) {
        return {
          timelineRevision: getTimelineRevision(),
          timeSpace: "timeline",
          phraseCount: 0,
          transcript: "",
          phrases: [],
          status: "TRANSCRIPT_NOT_YET_GENERATED",
          guidance: "Transcript has not been generated for this video yet. Call `generate_captions` to transcribe audio and produce timestamped speech phrases.",
        };
      }

      // Source → timeline mapping; trimmed speech is dropped.
      const phrases = sourcePhrases
        .map((p) => {
          const iv = mapIntervalToTimeline(project, p.start, p.end);
          return iv ? { ...p, start: iv.start, end: iv.end } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .sort((a, b) => a.start - b.start);

      const formatted = phrases
        .map((p) => {
          const mm = Math.floor(p.start / 60)
            .toString()
            .padStart(2, "0");
          const ss = (p.start % 60).toFixed(1).padStart(4, "0");
          return `[${mm}:${ss}] ${p.text}`;
        })
        .join("\n");

      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        phraseCount: phrases.length,
        transcript: formatted,
        phrases,
      };
    },
  });

  registerToolWithLifecycle({
    name: "inspect_timeline",
    description:
      "Detailed inspector of all clips, timeline timestamps, transitions, speed, zooms, and overlays. All times are CURRENT TIMELINE seconds.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) return { error: "No project loaded." };
      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        totalDuration: Number(projectDuration(project).toFixed(2)),
        clips: project.segments.map((seg, idx) => ({
          clipIndex: idx,
          id: seg.id,
          duration: Number(segmentDuration(seg).toFixed(2)),
          speed: seg.speed,
          transition: seg.transition ?? "cut",
          transitionDuration: seg.transitionDuration ?? 0.45,
          zoomCount: (seg.zoomPoints ?? []).length,
          overlayCount: (seg.textOverlays ?? []).length,
        })),
      };
    },
  });

  registerToolWithLifecycle({
    name: "get_click_log",
    description:
      "Returns cursor telemetry in CURRENT TIMELINE seconds. Default response is COMPACT: per-20s attention buckets (where the mouse was active), click counts, and suggested zoom timestamps — plus exact cursor (x, y) interpolation via atTimestamp. Pass detail:'full' for the raw point list (token-heavy; rarely needed). Click clusters are prime zoom candidates; a parked cursor (no recent events) is NOT a good zoom target.",
    inputSchema: {
      type: "object",
      properties: {
        atTimestamp: {
          type: "number",
          description: "Optional: interpolate and return the exact cursor (x, y) at this timeline timestamp",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "'summary' (default) returns attention buckets only; 'full' also includes the raw point list.",
        },
      },
    },
    annotations: { readOnlyHint: true },
    execute: async ({
      atTimestamp,
      detail,
    }: {
      atTimestamp?: number;
      detail?: "summary" | "full";
    } = {}) => {
      const project = useProjectStore.getState().project;
      if (!project) {
        return { error: "No project loaded. Ask the user to import or record a clip first." };
      }

      const revision = getTimelineRevision();
      const clicks = project.clickLog ?? [];

      // Clicks are stored at source-media seconds; map to the current timeline
      // and drop moments that were trimmed away.
      const mapped = clicks
        .map((c) => {
          const tl = sourceToTimelineT(project, c.t);
          return tl == null ? null : { ...c, t: tl };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => a.t - b.t);

      // If atTimestamp requested, interpolate the cursor at that timeline time.
      if (typeof atTimestamp === "number") {
        if (mapped.length === 0) {
          return { timelineRevision: revision, timeSpace: "timeline", t: atTimestamp, x: 0.5, y: 0.5, interpolated: false, count: 0 };
        }
        const exact = mapped.find((c) => Math.abs(c.t - atTimestamp) < 0.05);
        if (exact) {
          return { timelineRevision: revision, timeSpace: "timeline", t: Number(exact.t.toFixed(2)), x: exact.x, y: exact.y, type: exact.type, count: mapped.length };
        }
        // Interpolate in timeline space between the mapped neighbours.
        let prev = mapped[0]!;
        let next = mapped[mapped.length - 1]!;
        for (let i = 0; i < mapped.length - 1; i++) {
          if (mapped[i]!.t <= atTimestamp && mapped[i + 1]!.t >= atTimestamp) {
            prev = mapped[i]!;
            next = mapped[i + 1]!;
            break;
          }
        }
        const span = next.t - prev.t;
        const alpha = span > 0.001 ? Math.max(0, Math.min(1, (atTimestamp - prev.t) / span)) : 0;
        const interpX = Number((prev.x + alpha * (next.x - prev.x)).toFixed(3));
        const interpY = Number((prev.y + alpha * (next.y - prev.y)).toFixed(3));
        return { timelineRevision: revision, timeSpace: "timeline", t: atTimestamp, x: interpX, y: interpY, type: "interpolated", count: mapped.length };
      }

      const clickOnly = mapped.filter((c) => c.type === "click" || c.type === "manual");

      // Attention summary: per-20s buckets so the agent sees WHERE the mouse
      // was active without parsing a raw point dump.
      const bucketSec = 20;
      const buckets = new Map<number, { events: number; clicks: number; sx: number; sy: number }>();
      for (const c of mapped) {
        const key = Math.floor(c.t / bucketSec);
        const b = buckets.get(key) ?? { events: 0, clicks: 0, sx: 0, sy: 0 };
        b.events++;
        if (c.type === "click" || c.type === "manual") b.clicks++;
        b.sx += c.x;
        b.sy += c.y;
        buckets.set(key, b);
      }
      const attention = [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, b]) => ({
          from: Number((key * bucketSec).toFixed(1)),
          to: Number(((key + 1) * bucketSec).toFixed(1)),
          events: b.events,
          clicks: b.clicks,
          centroid: { x: Number((b.sx / b.events).toFixed(3)), y: Number((b.sy / b.events).toFixed(3)) },
        }));

      // Raw points: capped by default, omitted in summary mode. The old
      // response also sent the same list twice (clicks + trajectory) — gone.
      const cap = detail === "full" ? 300 : 120;
      const rawPoints =
        detail === "summary"
          ? undefined
          : mapped.slice(0, cap).map((c) => ({
              t: Number(c.t.toFixed(2)),
              x: Number(c.x.toFixed(3)),
              y: Number(c.y.toFixed(3)),
              type: c.type,
            }));

      return {
        timelineRevision: revision,
        timeSpace: "timeline",
        count: mapped.length,
        clickCount: clickOnly.length,
        ...(rawPoints ? { clicks: rawPoints } : { clicksOmitted: "Pass detail:'full' to receive the raw point list." }),
        attention,
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
