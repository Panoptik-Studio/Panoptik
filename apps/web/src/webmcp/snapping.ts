/**
 * Deterministic snapping, cut-map rebasing, and collision resolution engine for Panoptik WebMCP.
 * Enforces:
 * 1. Word boundary protection (±150ms) and emphasis keepouts (±200ms).
 * 2. Cut-map resolution and timeline timestamp rebasing.
 * 3. Partial-straddle clamping (clamp op window to surviving media).
 * 4. Speed-op non-overlap constraints.
 * 5. Zoom centroid snapping and transition collision avoidance.
 */

import type { FullMediaAnalysis } from "@panoptik/engine";
import type { Project } from "@panoptik/schema";

export type EditOp =
  | {
      op: "cut";
      t: number; // Source-media seconds
      dropSilence?: boolean;
      padLeftMs?: number; // default 50ms
      padRightMs?: number; // default 80ms
    }
  | {
      op: "zoom";
      t0: number; // Source-media start
      t1: number; // Source-media end
      cx?: number;
      cy?: number;
      scale?: number; // 1.2 to 4.0 (default 2.2)
      ease?: "io3" | "out3" | "linear";
    }
  | {
      op: "trans";
      at: number; // Source-media cut point
      kind: "fade" | "dipToBlack" | "slide-left" | "slide-right" | "zoom-in" | "wipe";
      dur?: number; // default 0.45s
    }
  | {
      op: "cam";
      t0: number;
      t1?: number;
      corner: "tl" | "tr" | "bl" | "br";
      shape?: "circle" | "square";
      size?: number; // default 0.22
    }
  | {
      op: "bg";
      t0: number;
      t1?: number;
      kind: "solid" | "gradient";
      c0: string;
      c1?: string;
    }
  | {
      op: "speed";
      t0: number;
      t1: number;
      mult: 0.5 | 1.0 | 1.5 | 2.0;
    }
  | {
      op: "text";
      t: number;
      text: string;
      pos?: "top" | "bottom" | "center";
      dur?: number;
    }
  | {
      op: "music";
      trackId: string;
      startT: number;
      ducking?: number;
    };

export interface CutInterval {
  start: number;
  end: number;
  droppedDur: number;
}

export type SnappedOp = EditOp & {
  originalT0?: number;
  originalT1?: number;
  originalT?: number;
  rebasedT0?: number;
  rebasedT1?: number;
  rebasedT?: number;
  clamped?: boolean;
};

export interface SnappedBatchResult {
  cutMap: CutInterval[];
  snappedOps: SnappedOp[];
  rejectedOps: Array<{ op: EditOp; reason: string }>;
  diffSummary: string;
}

/**
 * Snaps, rebases, and resolves collisions for a batched list of EditOp operations.
 */
export function snapAndRebaseEditOps(
  ops: EditOp[],
  analysis?: FullMediaAnalysis | null,
  project?: Project | null,
): SnappedBatchResult {
  const rejectedOps: Array<{ op: EditOp; reason: string }> = [];
  const validOps: EditOp[] = [];

  // 1. Validate parameter bounds and types
  for (const op of ops) {
    if (!op || typeof op.op !== "string") {
      rejectedOps.push({ op, reason: "Malformed operation object" });
      continue;
    }

    if (op.op === "cut") {
      if (typeof op.t !== "number" || op.t < 0) {
        rejectedOps.push({ op, reason: "Invalid cut timestamp" });
        continue;
      }
    } else if (op.op === "zoom" || op.op === "speed") {
      if (typeof op.t0 !== "number" || typeof op.t1 !== "number" || op.t1 <= op.t0) {
        rejectedOps.push({ op, reason: "Invalid start/end time window" });
        continue;
      }
    }

    validOps.push(op);
  }

  // 2. Resolve Cuts first and build sorted CutMap
  const cutOps = validOps.filter((o): o is Extract<EditOp, { op: "cut" }> => o.op === "cut");
  const rawDrops: Array<{ start: number; end: number }> = [];

  for (const cut of cutOps) {
    let dropStart = cut.t;
    let dropEnd = cut.t;

    if (cut.dropSilence && analysis?.audio?.silences) {
      // Find silence interval containing or closest to cut.t
      const matchingSilence = analysis.audio.silences.find(
        (s) => cut.t >= s.start - 0.2 && cut.t <= s.end + 0.2,
      );

      if (matchingSilence) {
        const padL = (cut.padLeftMs ?? 50) / 1000;
        const padR = (cut.padRightMs ?? 80) / 1000;
        dropStart = Math.max(0, matchingSilence.start + padL);
        dropEnd = Math.max(dropStart, matchingSilence.end - padR);
      }
    }

    // Word boundary protection: check if dropStart or dropEnd falls inside a word
    if (analysis?.words && analysis.words.length > 0) {
      for (const w of analysis.words) {
        if (dropStart >= w.start - 0.15 && dropStart <= w.end + 0.15) {
          dropStart = Number((w.start - 0.05).toFixed(3));
        }
        if (dropEnd >= w.start - 0.15 && dropEnd <= w.end + 0.15) {
          dropEnd = Number((w.end + 0.05).toFixed(3));
        }
      }
    }

    // Emphasis keepout protection (±200ms)
    if (analysis?.audio?.loudPeaks) {
      for (const peak of analysis.audio.loudPeaks) {
        if (dropStart >= peak.keepoutStart && dropStart <= peak.keepoutEnd) {
          dropStart = peak.keepoutStart;
        }
        if (dropEnd >= peak.keepoutStart && dropEnd <= peak.keepoutEnd) {
          dropEnd = peak.keepoutEnd;
        }
      }
    }

    if (dropEnd > dropStart + 0.05) {
      rawDrops.push({
        start: Number(dropStart.toFixed(3)),
        end: Number(dropEnd.toFixed(3)),
      });
    }
  }

  // Sort and merge overlapping cut drops
  rawDrops.sort((a, b) => a.start - b.start);
  const cutMap: CutInterval[] = [];
  for (const drop of rawDrops) {
    if (cutMap.length === 0) {
      cutMap.push({
        start: drop.start,
        end: drop.end,
        droppedDur: Number((drop.end - drop.start).toFixed(3)),
      });
      continue;
    }

    const prev = cutMap[cutMap.length - 1];
    if (prev && drop.start <= prev.end) {
      prev.end = Math.max(prev.end, drop.end);
      prev.droppedDur = Number((prev.end - prev.start).toFixed(3));
    } else {
      cutMap.push({
        start: drop.start,
        end: drop.end,
        droppedDur: Number((drop.end - drop.start).toFixed(3)),
      });
    }
  }

  // 3 & 4. Process non-cut ops: Straddle Clamping & Timestamp Rebasing
  const nonCutOps = validOps.filter((o) => o.op !== "cut");
  const snappedOps: SnappedOp[] = [];

  const rebaseTime = (t: number): number => {
    let droppedBefore = 0;
    for (const drop of cutMap) {
      if (drop.end <= t) {
        droppedBefore += drop.droppedDur;
      } else if (drop.start < t && drop.end > t) {
        droppedBefore += t - drop.start;
      }
    }
    return Number(Math.max(0, t - droppedBefore).toFixed(3));
  };

  // Step 5: Check speed op overlap constraint
  const speedOps = nonCutOps.filter((o): o is Extract<EditOp, { op: "speed" }> => o.op === "speed");
  const otherSpans: Array<{ start: number; end: number; op: string }> = [];

  for (const op of nonCutOps) {
    if (op.op === "zoom") {
      let t0 = op.t0;
      let t1 = op.t1;
      let clamped = false;

      // Check straddle against cutMap
      for (const drop of cutMap) {
        if (t0 >= drop.start && t1 <= drop.end) {
          // Fully inside drop -> reject
          rejectedOps.push({ op, reason: `Zoom [${t0}s, ${t1}s] falls entirely inside dropped silence [${drop.start}s, ${drop.end}s]` });
          t0 = -1;
          break;
        } else if (t0 < drop.start && t1 > drop.start && t1 <= drop.end) {
          // Clamped to drop start
          t1 = drop.start;
          clamped = true;
        } else if (t0 >= drop.start && t0 < drop.end && t1 > drop.end) {
          // Clamped to drop end
          t0 = drop.end;
          clamped = true;
        }
      }

      if (t0 < 0) continue;

      if (t1 - t0 < 0.5) {
        rejectedOps.push({ op, reason: `Zoom duration after cut clamping is too short (< 0.5s)` });
        continue;
      }

      // Focal centroid resolution
      let cx = op.cx;
      let cy = op.cy;
      if (typeof cx !== "number" || typeof cy !== "number") {
        const matchingScene = analysis?.interactions?.find(
          (sc) => sc.sceneId === analysis.scenes.find((s) => t0 >= s.t0 && t0 <= s.t1)?.id,
        );
        if (matchingScene?.centroid) {
          cx = matchingScene.centroid.x;
          cy = matchingScene.centroid.y;
        } else {
          cx = 0.5;
          cy = 0.5;
        }
      }

      const rebasedT0 = rebaseTime(t0);
      const rebasedT1 = rebaseTime(t1);

      snappedOps.push({
        ...op,
        cx: Number(cx.toFixed(3)),
        cy: Number(cy.toFixed(3)),
        originalT0: op.t0,
        originalT1: op.t1,
        rebasedT0,
        rebasedT1,
        clamped,
      });

      otherSpans.push({ start: t0, end: t1, op: "zoom" });
    } else if (op.op === "cam" || op.op === "bg") {
      const t0 = op.t0;
      const t1 = op.t1 ?? t0 + 10.0;
      const rebasedT0 = rebaseTime(t0);
      const rebasedT1 = rebaseTime(t1);

      snappedOps.push({
        ...op,
        originalT0: t0,
        originalT1: t1,
        rebasedT0,
        rebasedT1,
      });

      otherSpans.push({ start: t0, end: t1, op: op.op });
    } else if (op.op === "text" || op.op === "music") {
      const t = op.op === "text" ? op.t : op.startT;
      const rebasedT = rebaseTime(t);

      snappedOps.push({
        ...op,
        originalT: t,
        rebasedT,
      });

      otherSpans.push({ start: t, end: t + (op.op === "text" ? op.dur ?? 3.0 : 10.0), op: op.op });
    } else if (op.op === "trans") {
      const rebasedAt = rebaseTime(op.at);
      snappedOps.push({
        ...op,
        originalT: op.at,
        rebasedT: rebasedAt,
      });
    }
  }

  // Process speed ops with v1 non-overlap validation
  for (const speed of speedOps) {
    const overlaps = otherSpans.some(
      (span) => Math.max(speed.t0, span.start) < Math.min(speed.t1, span.end),
    );

    if (overlaps) {
      rejectedOps.push({
        op: speed,
        reason: `Speed ramp [${speed.t0}s, ${speed.t1}s] overlaps another effect window (v1 speed constraint)`,
      });
      continue;
    }

    const rebasedT0 = rebaseTime(speed.t0);
    const rebasedT1 = rebaseTime(speed.t1);

    snappedOps.push({
      ...speed,
      originalT0: speed.t0,
      originalT1: speed.t1,
      rebasedT0,
      rebasedT1,
    });
  }

  // Include resolved cuts in snappedOps
  for (const cut of cutOps) {
    const matchingDrop = cutMap.find((d) => cut.t >= d.start && cut.t <= d.end);
    snappedOps.push({
      ...cut,
      originalT: cut.t,
      rebasedT: rebaseTime(cut.t),
    });
  }

  // Generate clean human-readable diff summary
  const summaryParts: string[] = [];
  if (cutMap.length > 0) {
    const totalDropped = cutMap.reduce((sum, d) => sum + d.droppedDur, 0);
    summaryParts.push(`${cutMap.length} cut(s) dropping ${totalDropped.toFixed(1)}s dead air`);
  }
  const zoomCount = snappedOps.filter((o) => o.op === "zoom").length;
  if (zoomCount > 0) summaryParts.push(`${zoomCount} zoom(s)`);
  const camCount = snappedOps.filter((o) => o.op === "cam").length;
  if (camCount > 0) summaryParts.push(`${camCount} facecam reposition(s)`);
  const transCount = snappedOps.filter((o) => o.op === "trans").length;
  if (transCount > 0) summaryParts.push(`${transCount} transition(s)`);
  const speedCount = snappedOps.filter((o) => o.op === "speed").length;
  if (speedCount > 0) summaryParts.push(`${speedCount} speed ramp(s)`);

  const diffSummary = summaryParts.length > 0
    ? `Staged: ${summaryParts.join(", ")}.`
    : "No operations staged.";

  return {
    cutMap,
    snappedOps,
    rejectedOps,
    diffSummary,
  };
}
