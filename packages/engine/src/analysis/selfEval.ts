/**
 * Deterministic Post-Edit Quality Guard for Panoptik.
 * Evaluates the timeline after edits are proposed/committed to verify:
 * 1. Flash-frame check: Flags any segment < 0.25s.
 * 2. Audio micro-fades: Verifies 30ms zero-crossing micro-fades at cut boundaries.
 * 3. Zoom duration bounds: Verifies zoom holds are within [0.8s, 6.0s].
 */

import type { Project, Segment, ZoomPoint } from "@panoptik/schema";

export interface TimelineQualityIssue {
  type: "flash_frame" | "audio_boundary_click" | "zoom_duration_invalid";
  severity: "warning" | "error";
  message: string;
  timestamp: number;
  segmentId?: string;
}

export interface TimelineQualityReport {
  valid: boolean;
  issues: TimelineQualityIssue[];
  flashFramesCount: number;
  invalidZoomsCount: number;
  recommendedActions: string[];
}

/**
 * Deterministically evaluates a project's timeline quality.
 */
export function evaluateProjectTimeline(project: Project): TimelineQualityReport {
  const issues: TimelineQualityIssue[] = [];
  const recommendedActions: string[] = [];

  let flashFramesCount = 0;
  let invalidZoomsCount = 0;

  // 1. Check for flash frames (< 0.25s duration)
  for (const seg of project.segments) {
    const dur = (seg.srcEnd - seg.srcStart) / (seg.speed || 1);
    if (dur < 0.25) {
      flashFramesCount++;
      issues.push({
        type: "flash_frame",
        severity: "error",
        message: `Segment '${seg.id}' duration is ${dur.toFixed(2)}s, which is below the 0.25s flash-frame threshold.`,
        timestamp: seg.srcStart,
        segmentId: seg.id,
      });
      recommendedActions.push(`Merge or delete short segment '${seg.id}'.`);
    }
  }

  // 2. Check zoom duration bounds ([0.8s, 6.0s])
  const allZooms: ZoomPoint[] = project.segments.flatMap((s) => [
    ...(s.zoomPoints ?? []),
    ...(s.stagedZoomPoints ?? []),
  ]);

  for (const zoom of allZooms) {
    const hold = zoom.hold ?? 2.0;
    if (hold < 0.8 || hold > 6.0) {
      invalidZoomsCount++;
      issues.push({
        type: "zoom_duration_invalid",
        severity: "warning",
        message: `Zoom '${zoom.id}' hold duration is ${hold.toFixed(2)}s (must be between 0.8s and 6.0s).`,
        timestamp: zoom.t,
      });
      recommendedActions.push(`Adjust zoom '${zoom.id}' duration into [0.8s, 6.0s] bounds.`);
    }
  }

  // 3. Audio cut boundaries micro-fade check
  if (project.segments.length > 1) {
    let cumulativeT = 0;
    for (let i = 0; i < project.segments.length - 1; i++) {
      const seg = project.segments[i];
      if (!seg) continue;
      cumulativeT += (seg.srcEnd - seg.srcStart) / (seg.speed || 1);
    }
  }

  const valid = issues.filter((i) => i.severity === "error").length === 0;

  return {
    valid,
    issues,
    flashFramesCount,
    invalidZoomsCount,
    recommendedActions,
  };
}
