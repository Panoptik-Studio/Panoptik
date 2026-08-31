/**
 * Atomic batch operation executor for Panoptik WebMCP.
 * Takes snapped, rebased operations and stages them atomically into useProjectStore.
 */

import { useProjectStore } from "../stores/projectStore";
import type { Background, TextOverlay, ZoomPoint } from "@panoptik/schema";
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

/**
 * Executes a pre-snapped and rebased batch of operations against the project store.
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

  const newZoomProposals: ZoomPoint[] = [];

  for (const op of batch.snappedOps) {
    if (op.op === "zoom") {
      const t0 = op.rebasedT0 ?? op.t0;
      const t1 = op.rebasedT1 ?? op.t1;
      newZoomProposals.push({
        id: nextId("z"),
        t: t0,
        to: {
          scale: op.scale ?? 2.2,
          x: op.cx ?? 0.5,
          y: op.cy ?? 0.5,
        },
        dur: 0.35,
        hold: Math.max(0.8, t1 - t0),
        ease: op.ease ?? "easeInOutCubic",
        staged: true,
      });
      zoomsCount++;
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
      store.stageBackground(bg);
      backgroundsCount++;
    } else if (op.op === "text") {
      const t = op.rebasedT ?? op.t;
      const overlay: TextOverlay = {
        id: nextId("txt"),
        timestamp: t,
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
        staged: true,
      };
      store.stageTextOverlay(overlay);
      textCount++;
    } else if (op.op === "cam") {
      const cornerCoords: Record<string, { x: number; y: number }> = {
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.1 },
        bl: { x: 0.1, y: 0.9 },
        br: { x: 0.9, y: 0.9 },
      };
      const pos = cornerCoords[op.corner] ?? { x: 0.9, y: 0.9 };
      const currentSegments = store.project?.segments ?? [];
      for (const seg of currentSegments) {
        if (seg.facecam) {
          seg.facecam.x = pos.x;
          seg.facecam.y = pos.y;
          if (op.size) seg.facecam.size = op.size;
          if (op.shape) seg.facecam.shape = op.shape;
        }
      }
      facecamCount++;
    } else if (op.op === "trans") {
      store.updateSelectedSegments({
        transition: op.kind,
        transitionDuration: op.dur ?? 0.45,
      });
      transitionsCount++;
    } else if (op.op === "speed") {
      store.updateSelectedSegments({
        speed: op.mult,
      });
      speedCount++;
    } else if (op.op === "cut") {
      cutsCount++;
    }
  }

  if (newZoomProposals.length > 0) {
    store.stageZoomProposals(newZoomProposals);
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
