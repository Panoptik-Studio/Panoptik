/**
 * Dual-space time mapping for the WebMCP layer.
 *
 * Panoptik stores edits at ABSOLUTE SOURCE-media seconds (zoom t, overlay
 * timestamp, click t, analysis cache words/phrases/silences/scenes), while
 * agents reason in CURRENT TIMELINE seconds (what propose_edits, split_clip
 * and probe_frames accept and what the playhead shows). Trims, deletes and
 * speed changes make the two spaces diverge; these helpers keep every tool
 * boundary honest: agents read timeline seconds, storage keeps source seconds.
 *
 * Internal rule: `currentAnalysisCache` stays in SOURCE space (snapping needs
 * it there for silence/word matching). Mapping happens only at the read-tool
 * boundary, so cached data never goes stale after a cut.
 */

import {
  projectDuration,
  resolveSegment,
  sourceToTimeline,
  type FullMediaAnalysis,
} from "@panoptik/engine";
import type { Project, Segment } from "@panoptik/schema";

export interface SourceTimeRef {
  segId: string;
  srcT: number;
}

/** Timeline seconds → absolute source seconds on the covering segment. Null past the end. */
export function timelineToSource(project: Project, t: number): SourceTimeRef | null {
  const r = resolveSegment(project, t);
  if (!r) return null;
  return { segId: r.segment.id, srcT: r.srcT };
}

/**
 * Absolute source seconds → current timeline seconds. Null when the moment was
 * trimmed out of the timeline (no surviving segment covers it).
 */
export function sourceToTimelineT(
  project: Project,
  srcT: number,
  mediaId?: string,
): number | null {
  const seg = project.segments.find(
    (s) => (mediaId == null || s.mediaId === mediaId) && srcT >= s.srcStart && srcT <= s.srcEnd,
  );
  if (!seg) return null;
  return sourceToTimeline(project, seg.id, srcT);
}

/** Map a source-space [start, end] interval to timeline space; null if either end was trimmed. */
export function mapIntervalToTimeline(
  project: Project,
  start: number,
  end: number,
  mediaId?: string,
): { start: number; end: number } | null {
  const s = sourceToTimelineT(project, start, mediaId);
  const e = sourceToTimelineT(project, end, mediaId);
  if (s == null || e == null) return null;
  return { start: Math.min(s, e), end: Math.max(s, e) };
}

/** Timeline seconds → source seconds WITHIN a specific segment (for tools that write to the selected segment). */
export function timelineToSegmentSource(
  project: Project,
  seg: Segment,
  timelineT: number,
): number {
  const segStartT = sourceToTimeline(project, seg.id, seg.srcStart) ?? 0;
  const segEndT = segStartT + (seg.srcEnd - seg.srcStart) / Math.max(0.1, seg.speed);
  const clamped = Math.min(segEndT, Math.max(segStartT, timelineT));
  return seg.srcStart + (clamped - segStartT) * Math.max(0.1, seg.speed);
}

/**
 * Clone an analysis with every timestamp mapped from source space to CURRENT
 * timeline space, dropping moments that were trimmed away. Read tools use this
 * so agents always see the timeline as it exists right now.
 */
export function mapAnalysisToTimeline(
  project: Project,
  analysis: FullMediaAnalysis,
): FullMediaAnalysis {
  const mediaId = analysis.mediaId;
  const point = (t: number): number | null => sourceToTimelineT(project, t, mediaId);
  const interval = (start: number, end: number) => mapIntervalToTimeline(project, start, end, mediaId);

  const scenes = analysis.scenes.flatMap((sc) => {
    const w = interval(sc.t0, sc.t1);
    if (!w) return [];
    return [
      {
        ...sc,
        t0: Number(w.start.toFixed(2)),
        t1: Number(w.end.toFixed(2)),
        keyframeTime: Number((point(sc.keyframeTime) ?? (w.start + w.end) / 2).toFixed(2)),
      },
    ];
  });

  const audio = {
    ...analysis.audio,
    duration: Number(projectDuration(project).toFixed(2)),
    silences: analysis.audio.silences.flatMap((s) => {
      const w = interval(s.start, s.end);
      return w ? [{ ...s, start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)), duration: Number((w.end - w.start).toFixed(2)) }] : [];
    }),
    minorPauses: analysis.audio.minorPauses.flatMap((s) => {
      const w = interval(s.start, s.end);
      return w ? [{ ...s, start: Number(w.start.toFixed(2)), end: Number(w.end.toFixed(2)), duration: Number((w.end - w.start).toFixed(2)) }] : [];
    }),
    loudPeaks: analysis.audio.loudPeaks.flatMap((p) => {
      const t = point(p.t);
      const w = interval(p.keepoutStart, p.keepoutEnd);
      return t != null && w
        ? [{ ...p, t: Number(t.toFixed(2)), keepoutStart: Number(w.start.toFixed(2)), keepoutEnd: Number(w.end.toFixed(2)) }]
        : [];
    }),
  };

  const words = analysis.words.flatMap((w) => {
    const iv = interval(w.start, w.end);
    return iv ? [{ ...w, start: Number(iv.start.toFixed(2)), end: Number(iv.end.toFixed(2)) }] : [];
  });

  const phrases = analysis.phrases.flatMap((p) => {
    const iv = interval(p.start, p.end);
    return iv ? [{ ...p, start: Number(iv.start.toFixed(2)), end: Number(iv.end.toFixed(2)) }] : [];
  });

  const interactions = analysis.interactions.map((i) => ({
    ...i,
    bursts: i.bursts.flatMap((b) => {
      const iv = interval(b.startT, b.endT);
      return iv ? [{ ...b, startT: Number(iv.start.toFixed(2)), endT: Number(iv.end.toFixed(2)) }] : [];
    }),
  }));

  return {
    ...analysis,
    scenes,
    audio,
    words,
    phrases,
    interactions,
    duration: Number(projectDuration(project).toFixed(2)),
  };
}
