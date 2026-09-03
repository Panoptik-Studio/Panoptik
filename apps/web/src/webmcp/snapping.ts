/**
 * Deterministic snapping, cut-map rebasing, and collision resolution engine for Panoptik WebMCP.
 * Enforces:
 * 1. Word boundary protection (±150ms) and emphasis keepouts (±200ms).
 * 2. Cut-map resolution and timeline timestamp rebasing.
 * 3. Partial-straddle clamping (clamp op window to surviving media).
 * 4. Speed-op non-overlap constraints.
 * 5. Zoom centroid snapping and transition collision avoidance.
 */

import { projectDuration, resolveSegment, type FullMediaAnalysis } from "@panoptik/engine";
import type { Project, TextAnimation } from "@panoptik/schema";
import { sourceToTimelineT } from "./timeSpace";

export type EditOp =
  | {
      op: "cut";
      t: number; // Timeline seconds — window start
      /**
       * Optional explicit window end (timeline seconds): {op:'cut', t0, t1}
       * removes exactly [t0, t1] — the deterministic form, e.g. an interval
       * read from get_silence_intervals. Without t1, dropSilence:true expands
       * `t` to the matching silence interval from the media analysis.
       */
      t1?: number;
      dropSilence?: boolean;
      padLeftMs?: number; // default 50ms (silence expansion only)
      padRightMs?: number; // default 80ms (silence expansion only)
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
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: "normal" | "bold" | "600" | "800" | "900";
      fontStyle?: "normal" | "italic";
      color?: string;
      backgroundColor?: string;
      backgroundPadding?: number;
      borderRadius?: number;
      borderWidth?: number;
      borderColor?: string;
      shadowColor?: string;
      shadowBlur?: number;
      textAlign?: "left" | "center" | "right";
      animation?: TextAnimation;
      animationDuration?: number;
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
  /** How the zoom focal point was chosen. */
  focalSource?: "explicit" | "cursor" | "scene" | "center";
  /** True when a long vertical read was auto-split into a sequential pan. */
  splitPan?: boolean;
};

export interface SnappedBatchResult {
  cutMap: CutInterval[];
  /**
   * The same drops expressed in CURRENT TIMELINE seconds. Agents hand us op
   * times in timeline space, so rebasing must subtract timeline-shifted
   * durations; `cutMap` (source-media seconds) is what actually gets applied
   * to segments. Identical to `cutMap` when no project is available.
   */
  timelineCutMap: CutInterval[];
  snappedOps: SnappedOp[];
  rejectedOps: Array<{ op: EditOp; reason: string }>;
  diffSummary: string;
}

/**
 * Normalizes user / LLM input op objects with common aliases (e.g. kind vs op, x/y vs cx/cy, t/dur vs t0/t1).
 */
export function normalizeEditOp(raw: any): EditOp | null {
  if (!raw || typeof raw !== "object") return null;

  const opType = raw.op || raw.kind;
  if (!opType || typeof opType !== "string") return null;

  if (opType === "zoom") {
    const t0 = typeof raw.t0 === "number" ? raw.t0 : typeof raw.t === "number" ? raw.t : 0;
    const dur = typeof raw.dur === "number" ? raw.dur : typeof raw.duration === "number" ? raw.duration : 2.5;
    const t1 = typeof raw.t1 === "number" ? raw.t1 : t0 + dur;
    // Keep omitted cx/cy undefined: the zoom branch grounds the focal from
    // cursor telemetry when the agent does not pin it explicitly.
    const cx = typeof raw.cx === "number" ? raw.cx : typeof raw.x === "number" ? raw.x : undefined;
    const cy = typeof raw.cy === "number" ? raw.cy : typeof raw.y === "number" ? raw.y : undefined;
    const scale = typeof raw.scale === "number" ? raw.scale : 2.2;
    const ease = raw.ease === "out3" || raw.ease === "linear" ? raw.ease : "io3";
    return { op: "zoom", t0, t1: Math.max(t0 + 0.5, t1), cx, cy, scale, ease };
  }

  if (opType === "cut") {
    const t =
      typeof raw.t === "number"
        ? raw.t
        : typeof raw.t0 === "number"
          ? raw.t0
          : typeof raw.start === "number"
            ? raw.start
            : 0;
    const t1 =
      typeof raw.t1 === "number"
        ? raw.t1
        : typeof raw.end === "number"
          ? raw.end
          : typeof raw.dur === "number"
            ? t + raw.dur
            : undefined;
    return {
      op: "cut",
      t,
      t1: typeof t1 === "number" && t1 > t ? t1 : undefined,
      dropSilence: Boolean(raw.dropSilence),
      padLeftMs: raw.padLeftMs,
      padRightMs: raw.padRightMs,
    };
  }

  if (opType === "cam" || opType === "facecam") {
    let corner = raw.corner;
    if (corner === "bottom-right" || corner === "bottomRight") corner = "br";
    if (corner === "bottom-left" || corner === "bottomLeft") corner = "bl";
    if (corner === "top-right" || corner === "topRight") corner = "tr";
    if (corner === "top-left" || corner === "topLeft") corner = "tl";
    if (!["tl", "tr", "bl", "br"].includes(corner)) corner = "br";
    return {
      op: "cam",
      t0: typeof raw.t0 === "number" ? raw.t0 : typeof raw.t === "number" ? raw.t : 0,
      t1: typeof raw.t1 === "number" ? raw.t1 : undefined,
      corner: corner as "tl" | "tr" | "bl" | "br",
      shape: raw.shape === "square" ? "square" : "circle",
      size: typeof raw.size === "number" ? raw.size : 0.22,
    };
  }

  if (opType === "bg" || opType === "background") {
    const kind = raw.kind || raw.style?.kind || (raw.style?.stops || raw.stops || raw.c1 ? "gradient" : "solid");
    let c0 = raw.c0 || raw.color || raw.style?.color || raw.style?.stops?.[0] || raw.stops?.[0] || "#0f172a";
    let c1 = raw.c1 || raw.style?.stops?.[1] || raw.stops?.[1] || undefined;
    return {
      op: "bg",
      t0: typeof raw.t0 === "number" ? raw.t0 : typeof raw.t === "number" ? raw.t : 0,
      t1: typeof raw.t1 === "number" ? raw.t1 : undefined,
      kind: kind === "gradient" ? "gradient" : "solid",
      c0,
      c1,
    };
  }

  if (opType === "text" || opType === "title") {
    let pos = raw.pos || raw.position;
    if (pos === "top-center" || pos === "topCenter") pos = "top";
    if (pos === "bottom-center" || pos === "bottomCenter") pos = "bottom";
    if (!["top", "bottom", "center"].includes(pos)) pos = "top";
    return {
      op: "text",
      t: typeof raw.t === "number" ? raw.t : typeof raw.timestamp === "number" ? raw.timestamp : 0,
      text: String(raw.text ?? ""),
      pos: pos as "top" | "bottom" | "center",
      dur: typeof raw.dur === "number" ? raw.dur : typeof raw.duration === "number" ? raw.duration : 3.0,
    };
  }

  if (opType === "trans" || opType === "transition") {
    return {
      op: "trans",
      at: typeof raw.at === "number" ? raw.at : typeof raw.t === "number" ? raw.t : 0,
      kind: raw.kind || "fade",
      dur: typeof raw.dur === "number" ? raw.dur : 0.45,
    };
  }

  if (opType === "speed") {
    return {
      op: "speed",
      t0: typeof raw.t0 === "number" ? raw.t0 : 0,
      t1: typeof raw.t1 === "number" ? raw.t1 : 1,
      mult: raw.mult || raw.speed || 1.5,
    };
  }

  if (opType === "music") {
    return {
      op: "music",
      trackId: raw.trackId || "music-default",
      startT: typeof raw.startT === "number" ? raw.startT : typeof raw.t === "number" ? raw.t : 0,
      ducking: raw.ducking,
    };
  }

  return raw as EditOp;
}

/**
 * Click-log points mapped to timeline space with parked corner positions
 * filtered out. Parked = hugging the frame edges (browser chrome, window
 * borders) — the Director Playbook's parked-cursor heuristic, made
 * deterministic so agents never zoom onto an empty corner.
 */
function timelineCursorPoints(project: Project | null | undefined): Array<{ t: number; x: number; y: number }> {
  if (!project) return [];
  const points: Array<{ t: number; x: number; y: number }> = [];
  for (const c of project.clickLog ?? []) {
    if (c.x < 0.08 || c.x > 0.92 || c.y < 0.08 || c.y > 0.92) continue;
    const t = sourceToTimelineT(project, c.t);
    if (t == null) continue;
    points.push({ t, x: c.x, y: c.y });
  }
  return points.sort((a, b) => a.t - b.t);
}

function centroidOf(points: Array<{ x: number; y: number }>): { x: number; y: number } | null {
  if (points.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** First time after `after` that the cursor leaves the focal region (sustained: the next point agrees). */
function findRegionLeave(
  points: Array<{ t: number; x: number; y: number }>,
  after: number,
  fx: number,
  fy: number,
): number | null {
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.t <= after) continue;
    if (Math.hypot(p.x - fx, p.y - fy) > 0.2) {
      const next = points[i + 1];
      if (!next || Math.hypot(next.x - fx, next.y - fy) > 0.15) return p.t;
    }
  }
  return null;
}

/**
 * Nearest interior scene boundary (timeline seconds) after `after`. The final
 * boundary is excluded — the last scene's end is the video end, not a change.
 */
function findNextSceneEnd(
  analysis: FullMediaAnalysis | null | undefined,
  project: Project | null | undefined,
  after: number,
  timelineEnd: number,
): number | null {
  if (!analysis?.scenes?.length || !project) return null;
  let best: number | null = null;
  for (const s of analysis.scenes) {
    const endT = sourceToTimelineT(project, s.t1, analysis.mediaId);
    if (endT != null && endT > after && endT < timelineEnd - 0.25 && (best == null || endT < best)) {
      best = endT;
    }
  }
  return best;
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

  // 1. Validate and normalize parameter bounds and types
  for (const raw of ops) {
    const op = normalizeEditOp(raw);
    if (!op || typeof op.op !== "string") {
      rejectedOps.push({ op: raw, reason: "Malformed operation object" });
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
  // Cuts that resolved to an empty window are REJECTED with an actionable
  // reason — never silently dropped (that made agents believe dead air was
  // removed when nothing happened).
  const rejectedCutOps = new Set<Extract<EditOp, { op: "cut" }>>();

  for (const cut of cutOps) {
    // Agent ops arrive in TIMELINE seconds; silences/words/peaks are indexed in
    // SOURCE-media seconds. Map the cut into source space first (identity when
    // no project is available, e.g. in unit tests).
    const srcT0 = project ? (resolveSegment(project, cut.t)?.srcT ?? cut.t) : cut.t;
    const srcT1 =
      typeof cut.t1 === "number"
        ? project
          ? (resolveSegment(project, cut.t1)?.srcT ?? cut.t1)
          : cut.t1
        : srcT0;
    const explicitWindow = typeof cut.t1 === "number" && srcT1 > srcT0 + 0.05;

    let dropStart = srcT0;
    let dropEnd = srcT1;

    if (!explicitWindow && cut.dropSilence) {
      // Expand the cut point to the silence interval containing or nearest it
      const matchingSilence = analysis?.audio?.silences?.find(
        (s) => srcT0 >= s.start - 0.2 && srcT0 <= s.end + 0.2,
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

    if (dropEnd <= dropStart + 0.05) {
      rejectedCutOps.add(cut);
      rejectedOps.push({
        op: cut,
        reason: explicitWindow
          ? `Cut window [${cut.t}s, ${cut.t1}s] is empty (< 50ms) after mapping to the timeline.`
          : `No silence interval found near ${cut.t}s${
              cut.dropSilence ? "" : " (dropSilence was not set)"
            }. Cut ops need either an explicit window {op:'cut', t0, t1} — e.g. an interval from get_silence_intervals — or dropSilence:true with a matching silence in the media analysis (run generate_captions if the transcript is missing).`,
      });
      continue;
    }

    rawDrops.push({
      start: Number(dropStart.toFixed(3)),
      end: Number(dropEnd.toFixed(3)),
    });
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

  // Timeline-space view of the same drops: what agents' op times must be
  // rebased by. Identity when no project is available.
  const timelineCutMap: CutInterval[] = project
    ? cutMap.flatMap((drop) => {
        const start = sourceToTimelineT(project, drop.start);
        const end = sourceToTimelineT(project, drop.end);
        if (start == null || end == null) return [];
        return [
          {
            start: Number(start.toFixed(3)),
            end: Number(end.toFixed(3)),
            droppedDur: Number(Math.max(0, end - start).toFixed(3)),
          },
        ];
      })
    : cutMap;

  // 3 & 4. Process non-cut ops: Straddle Clamping & Timestamp Rebasing
  const nonCutOps = validOps.filter((o) => o.op !== "cut");
  const snappedOps: SnappedOp[] = [];

  const rebaseTime = (t: number): number => {
    let droppedBefore = 0;
    for (const drop of timelineCutMap) {
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

  const allCursorPoints = timelineCursorPoints(project);
  const timelineEnd = project ? projectDuration(project) : Infinity;
  // Zoom persistence: a zoom holds until the CONTENT changes — the next scene
  // boundary or the cursor moving to a different region — with a minimum hold.
  // Twitchy 1-2s zooms read as jitter; users asked for this to be forced.
  const MIN_ZOOM_HOLD = 4;
  const MAX_ZOOM_EXTRA = 20;
  const extendZoomEnd = (start: number, end: number, fx: number, fy: number): number => {
    const leaveAt = findRegionLeave(allCursorPoints, end, fx, fy);
    const sceneEnd = findNextSceneEnd(analysis, project, end, timelineEnd);
    const candidates = [leaveAt, sceneEnd].filter((v): v is number => v != null && v > end);
    let target: number;
    if (candidates.length > 0) {
      // A content change governs the end — never truncated by the safety cap.
      target = Math.min(...candidates);
    } else if (end - start < MIN_ZOOM_HOLD) {
      // No telemetry to justify a longer hold: extend to the minimum, capped.
      target = Math.min(start + MIN_ZOOM_HOLD, end + MAX_ZOOM_EXTRA);
    } else {
      target = end;
    }
    return Math.min(Math.max(target, end), timelineEnd);
  };

  for (const op of nonCutOps) {
    if (op.op === "zoom") {
      let t0 = op.t0;
      let t1 = op.t1;
      let clamped = false;

      // Check straddle against cutMap (timeline space, same space as op times)
      for (const drop of timelineCutMap) {
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

      // Focal grounding chain — deterministic, because the host may not be able
      // to view probe snapshots at all (base64 tool results arrive as text):
      //   1. explicit cx/cy from the agent
      //   2. cursor attention centroid inside the zoom window (parked corners filtered)
      //   3. scene interaction centroid
      //   4. frame center
      const windowPoints = allCursorPoints.filter((p) => p.t >= t0 && p.t <= t1);
      let cx = op.cx;
      let cy = op.cy;
      let focalSource: SnappedOp["focalSource"] = "explicit";
      if (cx == null || cy == null) {
        const c = centroidOf(windowPoints);
        if (c) {
          cx = c.x;
          cy = c.y;
          focalSource = "cursor";
        }
      }
      if (cx == null || cy == null) {
        const matchingScene = analysis?.interactions?.find(
          (sc) => sc.sceneId === analysis.scenes.find((s) => t0 >= s.t0 && t0 <= s.t1)?.id,
        );
        if (matchingScene?.centroid) {
          cx = matchingScene.centroid.x;
          cy = matchingScene.centroid.y;
          focalSource = "scene";
        }
      }
      if (cx == null || cy == null) {
        cx = 0.5;
        cy = 0.5;
        focalSource = "center";
      }

      const pushZoom = (a: number, b: number, focalY: number, split: boolean) => {
        snappedOps.push({
          ...op,
          cx: Number(cx!.toFixed(3)),
          cy: Number(focalY.toFixed(3)),
          originalT0: op.t0,
          originalT1: op.t1,
          rebasedT0: rebaseTime(a),
          rebasedT1: rebaseTime(b),
          clamped,
          focalSource,
          splitPan: split,
        });
        otherSpans.push({ start: a, end: b, op: "zoom" });
      };

      // A vertical read that exceeds one viewport height clips the lines at the
      // edges (visible height is 1/scale). When cursor telemetry shows that
      // traversal and the focal was grounded from data, split into a sequential
      // top→bottom pan instead of one static zoom (Director Playbook rule 2).
      const zoomScale = op.scale ?? 2.2;
      const ys = windowPoints.map((p) => p.y);
      const ySpan = ys.length >= 5 ? Math.max(...ys) - Math.min(...ys) : 0;
      const mid = (t0 + t1) / 2;
      if (focalSource === "cursor" && ySpan * zoomScale > 0.85 && t1 - t0 >= 5) {
        const firstHalf = centroidOf(windowPoints.filter((p) => p.t < mid));
        const secondHalf = centroidOf(windowPoints.filter((p) => p.t >= mid));
        if (firstHalf && secondHalf && Math.abs(firstHalf.y - secondHalf.y) > 0.08) {
          pushZoom(t0, mid, firstHalf.y, true);
          pushZoom(mid, extendZoomEnd(mid, t1, cx!, secondHalf.y), secondHalf.y, true);
          continue;
        }
      }

      pushZoom(t0, extendZoomEnd(t0, t1, cx!, cy!), cy!, false);
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

  // Include resolved cuts in snappedOps (rejected ones stay in rejectedOps only)
  for (const cut of cutOps) {
    if (rejectedCutOps.has(cut)) continue;
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
    summaryParts.push(`${cutMap.length} cut(s) dropping ${totalDropped.toFixed(1)}s`);
  }
  const zoomCount = snappedOps.filter((o) => o.op === "zoom").length;
  if (zoomCount > 0) summaryParts.push(`${zoomCount} zoom(s)`);
  const textCount = snappedOps.filter((o) => o.op === "text").length;
  if (textCount > 0) summaryParts.push(`${textCount} text overlay(s)`);
  const camCount = snappedOps.filter((o) => o.op === "cam").length;
  if (camCount > 0) summaryParts.push(`${camCount} facecam reposition(s)`);
  const bgCount = snappedOps.filter((o) => o.op === "bg").length;
  if (bgCount > 0) summaryParts.push(`${bgCount} background change(s)`);
  const transCount = snappedOps.filter((o) => o.op === "trans").length;
  if (transCount > 0) summaryParts.push(`${transCount} transition(s)`);
  const speedCount = snappedOps.filter((o) => o.op === "speed").length;
  if (speedCount > 0) summaryParts.push(`${speedCount} speed ramp(s)`);

  const diffSummary = summaryParts.length > 0
    ? `Staged: ${summaryParts.join(", ")}.`
    : "No operations staged.";

  return {
    cutMap,
    timelineCutMap,
    snappedOps,
    rejectedOps,
    diffSummary,
  };
}
