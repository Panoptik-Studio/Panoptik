/**
 * Atomic batch operation executor for Panoptik WebMCP.
 * Takes snapped, rebased operations and applies them atomically to useProjectStore.
 *
 * Time spaces: agent ops arrive in TIMELINE seconds. `batch.timelineCutMap`
 * (timeline space) is what op times were rebased against; `batch.cutMap`
 * (source-media seconds) is applied to the segments below, because segments
 * store source ranges. After cuts, zoom/text placement resolves rebased
 * timeline times against the POST-cut segments.
 */

import { useProjectStore } from "../stores/projectStore";
import { DEFAULT_CORNER_RADIUS_UNITS, projectDuration, segmentDuration } from "@panoptik/engine";
import type { Background, Segment, ZoomPoint, TextOverlay } from "@panoptik/schema";
import type { CutInterval, EditOp, SnappedBatchResult, SnappedOp } from "./snapping";

/**
 * The polished stage look, applied to EVERY agent edit unless the batch styles
 * the stage itself ({op:'bg'}). This is unconditional by product decision —
 * the gradient backdrop + rounded frame corners are the app's signature style.
 * Note a gradient alone is invisible on a 16:9 recording (no letterbox), so
 * stage padding is forced too: the frame shrinks inside the canvas and the
 * backdrop shows around it.
 */
export const EDITORIAL_BASELINE = {
  stagePadding: 28,
  cornerRadius: DEFAULT_CORNER_RADIUS_UNITS,
  gradient: ["#0f172a", "#1e293b"] as [string, string],
};

/** Applies the baseline; returns how many segments changed. */
export function applyEditorialBaseline(segments: Segment[], hasBgOp: boolean): number {
  let applied = 0;
  for (const seg of segments) {
    let changed = false;
    // The untouched default stage is solid black in either hex notation.
    const isUntouchedBlack =
      seg.background.kind === "solid" && /^#000(000)?$/i.test(seg.background.color);
    if (!hasBgOp && isUntouchedBlack) {
      seg.background = { kind: "gradient", stops: [...EDITORIAL_BASELINE.gradient] };
      changed = true;
    }
    if (seg.aspectPreset === "source") {
      seg.aspectPreset = "16:9";
      changed = true;
    }
    if ((seg.stagePadding ?? 0) < 12) {
      seg.stagePadding = EDITORIAL_BASELINE.stagePadding;
      changed = true;
    }
    if (!seg.cornerRadius) {
      seg.cornerRadius = EDITORIAL_BASELINE.cornerRadius;
      changed = true;
    }
    if (changed) applied++;
  }
  return applied;
}

export interface BatchExecutionResult {
  success: boolean;
  stagedCount: number;
  diffSummary: string;
  diff: {
    cuts: number;
    zooms: number;
    facecam: number;
    transitions: number;
    backgrounds: number;
    textOverlays: number;
    speedRamps: number;
  };
  rejectedCount: number;
  rejectedOps: Array<{ op: EditOp; reason: string }>;
  cutsApplied: {
    count: number;
    droppedSeconds: number;
    intervals: Array<{ start: number; end: number }>;
  };
  newDurationSeconds: number | null;
  appliedToTimeline: boolean;
  stageBaseline: { appliedSegments: number };
}

let idCounter = 1;
function nextId(prefix: string): string {
  return `${prefix}-${Date.now()}-${idCounter++}`;
}

function resolveSegmentAndSourceTime(
  segments: Segment[],
  timelineT: number,
): { segId: string; srcT: number } | null {
  let acc = 0;
  for (const seg of segments) {
    const dur = segmentDuration(seg);
    if (timelineT >= acc && timelineT <= acc + dur + 0.001) {
      const srcT = seg.srcStart + (timelineT - acc) * Math.max(0.1, seg.speed);
      return { segId: seg.id, srcT };
    }
    acc += dur;
  }
  if (segments.length > 0) {
    const last = segments[segments.length - 1]!;
    return { segId: last.id, srcT: last.srcEnd };
  }
  return null;
}

const keepZooms = (zooms: ZoomPoint[], pred: (t: number) => boolean): ZoomPoint[] =>
  (zooms ?? []).filter((z) => pred(z.t)).map((z) => ({ ...z }));

const keepOverlays = (overlays: TextOverlay[], pred: (t: number) => boolean): TextOverlay[] =>
  (overlays ?? []).filter((o) => pred(o.timestamp)).map((o) => ({ ...o }));

/**
 * Applies source-space cut drops to the segment list: each drop splits and
 * removes the covered source range. Annotations are stored at absolute source
 * time, so surviving pieces keep the items inside their (unchanged) source
 * bounds — no rebasing of stored data is needed.
 */
export function applyCutDrops(
  input: Segment[],
  drops: CutInterval[],
  mediaId: string | undefined,
): { segments: Segment[]; cutCount: number; droppedSeconds: number; intervals: Array<{ start: number; end: number }> } {
  let working = input;
  let cutCount = 0;
  let droppedSeconds = 0;
  const intervals: Array<{ start: number; end: number }> = [];

  for (const drop of drops) {
    if (drop.end - drop.start <= 0.05) continue;
    const next: Segment[] = [];

    for (const seg of working) {
      if (mediaId && seg.mediaId !== mediaId) {
        next.push(seg);
        continue;
      }
      const d0 = drop.start;
      const d1 = drop.end;
      if (d1 <= seg.srcStart + 0.001 || d0 >= seg.srcEnd - 0.001) {
        next.push(seg);
        continue;
      }

      // Snap drop edges that graze the segment bounds, so a cut starting at
      // 0.01s is a clean head drop instead of a 10ms sliver segment.
      const EDGE_SNAP = 0.05;
      const left = d0 - seg.srcStart <= EDGE_SNAP ? seg.srcStart : Math.max(seg.srcStart, d0);
      const right = seg.srcEnd - d1 <= EDGE_SNAP ? seg.srcEnd : Math.min(seg.srcEnd, d1);
      cutCount++;
      droppedSeconds += right - left;
      intervals.push({ start: Number(left.toFixed(2)), end: Number(right.toFixed(2)) });

      if (left <= seg.srcStart + 0.001 && right >= seg.srcEnd - 0.001) {
        // Whole segment dropped.
        continue;
      }

      const head = { ...seg, facecam: { ...seg.facecam } };
      if (left <= seg.srcStart + 0.001) {
        // Drop covers the head.
        next.push({
          ...head,
          id: nextId("seg"),
          srcStart: right,
          zoomPoints: keepZooms(seg.zoomPoints, (t) => t >= right),
          stagedZoomPoints: keepZooms(seg.stagedZoomPoints, (t) => t >= right),
          textOverlays: keepOverlays(seg.textOverlays, (t) => t >= right),
          stagedTextOverlays: keepOverlays(seg.stagedTextOverlays, (t) => t >= right),
        });
      } else if (right >= seg.srcEnd - 0.001) {
        // Drop covers the tail.
        next.push({
          ...head,
          id: nextId("seg"),
          srcEnd: left,
          zoomPoints: keepZooms(seg.zoomPoints, (t) => t < left),
          stagedZoomPoints: keepZooms(seg.stagedZoomPoints, (t) => t < left),
          textOverlays: keepOverlays(seg.textOverlays, (t) => t < left),
          stagedTextOverlays: keepOverlays(seg.stagedTextOverlays, (t) => t < left),
        });
      } else {
        // Hole in the middle: split around it.
        next.push(
          {
            ...head,
            id: nextId("seg"),
            srcEnd: left,
            zoomPoints: keepZooms(seg.zoomPoints, (t) => t < left),
            stagedZoomPoints: keepZooms(seg.stagedZoomPoints, (t) => t < left),
            textOverlays: keepOverlays(seg.textOverlays, (t) => t < left),
            stagedTextOverlays: keepOverlays(seg.stagedTextOverlays, (t) => t < left),
          },
          {
            ...head,
            id: nextId("seg"),
            srcStart: right,
            zoomPoints: keepZooms(seg.zoomPoints, (t) => t >= right),
            stagedZoomPoints: keepZooms(seg.stagedZoomPoints, (t) => t >= right),
            textOverlays: keepOverlays(seg.textOverlays, (t) => t >= right),
            stagedTextOverlays: keepOverlays(seg.stagedTextOverlays, (t) => t >= right),
          },
        );
      }
    }
    working = next;
  }

  return { segments: working, cutCount, droppedSeconds, intervals };
}

/**
 * Executes a pre-snapped and rebased batch of operations against the project store.
 * Cuts are applied for real (segments split + dropped); zooms and text overlays are
 * distributed into their respective segment with segment-relative source times.
 * @param batch SnappedBatchResult from snapAndRebaseEditOps
 * @param mode "replace" (default) clears prior staged proposals; "append" adds to them
 */
export function executeBatchOps(
  batch: SnappedBatchResult,
  mode: "replace" | "append" = "replace",
): BatchExecutionResult {
  const store = useProjectStore.getState();

  if (mode === "replace") {
    store.clearStaged();
  }

  let zoomsCount = 0;
  let facecamCount = 0;
  let transitionsCount = 0;
  let backgroundsCount = 0;
  let textCount = 0;
  let speedCount = 0;

  const rawSegments = store.project?.segments ?? [];
  let segments: Segment[] = rawSegments.map((s) => ({
    ...s,
    zoomPoints: mode === "replace" ? [] : [...s.zoomPoints],
    stagedZoomPoints: mode === "replace" ? [] : [...(s.stagedZoomPoints ?? [])],
    textOverlays:
      mode === "replace"
        ? (s.textOverlays ?? []).filter((t) => t.kind === "caption")
        : [...s.textOverlays],
    stagedTextOverlays:
      mode === "replace"
        ? (s.stagedTextOverlays ?? []).filter((t) => t.kind === "caption")
        : [...(s.stagedTextOverlays ?? [])],
    facecam: { ...s.facecam },
  }));

  // Cuts first, so zoom/text placement below resolves against post-cut segments.
  const firstMediaId = store.project?.media[0]?.id;
  const cutResult = applyCutDrops(segments, batch.cutMap, firstMediaId);
  segments = cutResult.segments;
  const cutsCount = cutResult.cutCount;

  for (const op of batch.snappedOps) {
    if (op.op === "zoom") {
      const t0 = op.rebasedT0 ?? op.t0;
      const t1 = op.rebasedT1 ?? op.t1;
      const resolved = resolveSegmentAndSourceTime(segments, t0);
      if (resolved) {
        const targetSeg = segments.find((s) => s.id === resolved.segId);
        if (targetSeg) {
          targetSeg.zoomPoints.push({
            id: nextId("z"),
            t: Number(resolved.srcT.toFixed(2)),
            to: {
              scale: op.scale ?? 2.2,
              x: op.cx ?? 0.5,
              y: op.cy ?? 0.5,
            },
            dur: 0.35,
            hold: Math.max(0.8, t1 - t0),
            ease: op.ease ?? "easeInOutCubic",
            staged: false,
          });
          zoomsCount++;
        }
      }
    } else if (op.op === "bg") {
      let bg: Background;
      if (op.kind === "gradient" && op.c0 && op.c1) {
        bg = {
          kind: "gradient",
          stops: [op.c0, op.c1],
        };
      } else {
        bg = {
          kind: "solid",
          color: op.c0,
        };
      }
      for (const seg of segments) {
        seg.background = bg;
        // A backdrop is invisible while the frame fills the canvas ('source'
        // aspect leaves no stage padding to show it through) — enable the
        // 16:9 padding so the background actually renders.
        if (seg.aspectPreset === "source") {
          seg.aspectPreset = "16:9";
        }
      }
      backgroundsCount++;
    } else if (op.op === "text") {
      const t = op.rebasedT ?? op.t;
      const resolved = resolveSegmentAndSourceTime(segments, t);
      if (resolved) {
        const targetSeg = segments.find((s) => s.id === resolved.segId);
        if (targetSeg) {
          targetSeg.textOverlays.push({
            id: nextId("txt"),
            timestamp: Number(resolved.srcT.toFixed(2)),
            text: op.text,
            position: op.pos ?? "top",
            duration: op.dur ?? 3.0,
            fontSize: op.fontSize,
            fontFamily: op.fontFamily,
            fontWeight: op.fontWeight,
            fontStyle: op.fontStyle,
            color: op.color,
            backgroundColor: op.backgroundColor,
            backgroundPadding: op.backgroundPadding,
            borderRadius: op.borderRadius,
            borderWidth: op.borderWidth,
            borderColor: op.borderColor,
            shadowColor: op.shadowColor,
            shadowBlur: op.shadowBlur,
            textAlign: op.textAlign,
            animation: op.animation,
            animationDuration: op.animationDuration,
            staged: false,
          });
          textCount++;
        }
      }
    } else if (op.op === "cam") {
      const cornerCoords: Record<string, { x: number; y: number }> = {
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.1 },
        bl: { x: 0.1, y: 0.9 },
        br: { x: 0.9, y: 0.9 },
      };
      const pos = cornerCoords[op.corner] ?? { x: 0.9, y: 0.9 };
      for (const seg of segments) {
        if (seg.facecam) {
          seg.facecam.x = pos.x;
          seg.facecam.y = pos.y;
          if (op.size) seg.facecam.size = op.size;
          if (op.shape) seg.facecam.shape = op.shape;
        }
      }
      facecamCount++;
    } else if (op.op === "trans") {
      for (let i = 1; i < segments.length; i++) {
        segments[i]!.transition = op.kind as any;
        segments[i]!.transitionDuration = op.dur ?? 0.45;
      }
      transitionsCount++;
    } else if (op.op === "speed") {
      for (const seg of segments) {
        seg.speed = op.mult;
      }
      speedCount++;
    }
  }

  // Editorial baseline: gradient backdrop, visible stage padding, rounded
  // corners — every agent edit ships the polished stage look.
  const stageBaselineCount = applyEditorialBaseline(
    segments,
    batch.snappedOps.some((o) => o.op === "bg"),
  );

  if (store.project) {
    useProjectStore.setState({
      project: {
        ...store.project,
        segments,
      },
    });
  }

  const stagedCount =
    zoomsCount +
    facecamCount +
    transitionsCount +
    backgroundsCount +
    textCount +
    speedCount +
    cutsCount;

  return {
    success: true,
    stagedCount,
    diffSummary: batch.diffSummary,
    diff: {
      cuts: cutsCount,
      zooms: zoomsCount,
      facecam: facecamCount,
      transitions: transitionsCount,
      backgrounds: backgroundsCount,
      textOverlays: textCount,
      speedRamps: speedCount,
    },
    rejectedCount: batch.rejectedOps.length,
    rejectedOps: batch.rejectedOps,
    cutsApplied: {
      count: cutResult.cutCount,
      droppedSeconds: Number(cutResult.droppedSeconds.toFixed(2)),
      intervals: cutResult.intervals,
    },
    newDurationSeconds: store.project
      ? Number(projectDuration({ ...store.project, segments }).toFixed(2))
      : null,
    appliedToTimeline: true,
    stageBaseline: { appliedSegments: stageBaselineCount },
  };
}
