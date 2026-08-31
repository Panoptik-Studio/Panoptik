/**
 * Atomic batch operation executor for Panoptik WebMCP.
 * Takes snapped, rebased operations and stages them atomically into useProjectStore.
 */

import { useProjectStore } from "../stores/projectStore";
import { segmentDuration } from "@panoptik/engine";
import type { Background, Segment, TextOverlay, ZoomPoint } from "@panoptik/schema";
import type { EditOp, SnappedBatchResult, SnappedOp } from "./snapping";

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

/**
 * Executes a pre-snapped and rebased batch of operations against the project store.
 * Accurately distributes zooms and text overlays into their respective segment with segment-relative source times.
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

  let cutsCount = 0;
  let zoomsCount = 0;
  let facecamCount = 0;
  let transitionsCount = 0;
  let backgroundsCount = 0;
  let textCount = 0;
  let speedCount = 0;

  const rawSegments = store.project?.segments ?? [];
  const segments: Segment[] = rawSegments.map((s) => ({
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
    } else if (op.op === "cut") {
      cutsCount++;
    }
  }

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
  };
}
