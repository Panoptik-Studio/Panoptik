/**
 * Canvas drawing + geometry for multi-row Text Overlay tracks in the timeline.
 * Supports overlapping text overlays by automatically packing them into
 * sub-lanes (greedy interval scheduling) so they sit cleanly below each other.
 */
import type { TextOverlay } from "@panoptik/schema";

export const TEXT_TRACK_BASE_Y = 180;
export const TEXT_ROW_HEIGHT = 22;
export const TEXT_ROW_GAP = 3;

export interface PackedTextOverlay {
  overlay: TextOverlay;
  laneIndex: number;
  startT: number;
  endT: number;
  duration: number;
}

/**
 * Packs text overlays into non-overlapping sub-lanes.
 * Uses greedy interval scheduling sorted by start timestamp.
 */
export function packTextLanes(overlays: TextOverlay[]): {
  packed: PackedTextOverlay[];
  totalLanes: number;
} {
  if (!overlays || overlays.length === 0) {
    return { packed: [], totalLanes: 1 };
  }

  // Sort by start timestamp
  const sorted = [...overlays].sort((a, b) => a.timestamp - b.timestamp);

  // Track the end time of the last item placed in each lane
  const laneEndTimes: number[] = [];
  const packed: PackedTextOverlay[] = [];

  for (const overlay of sorted) {
    const startT = overlay.timestamp;
    const duration = overlay.duration != null && overlay.duration > 0 ? overlay.duration : 3;
    const endT = startT + duration;

    // Find the first lane where this item fits (end time <= startT)
    let assignedLane = -1;
    for (let l = 0; l < laneEndTimes.length; l++) {
      if (laneEndTimes[l]! <= startT + 0.001) {
        assignedLane = l;
        laneEndTimes[l] = endT;
        break;
      }
    }

    // If no existing lane is free, allocate a new sub-lane
    if (assignedLane === -1) {
      assignedLane = laneEndTimes.length;
      laneEndTimes.push(endT);
    }

    packed.push({
      overlay,
      laneIndex: assignedLane,
      startT,
      endT,
      duration,
    });
  }

  return {
    packed,
    totalLanes: Math.max(1, laneEndTimes.length),
  };
}

/** Pixel box for a text overlay block in the timeline */
export function textBlockGeometry(
  item: PackedTextOverlay,
  timeToX: (t: number) => number,
  baseY = TEXT_TRACK_BASE_Y,
  rowHeight = TEXT_ROW_HEIGHT,
  rowGap = TEXT_ROW_GAP,
): { left: number; top: number; width: number; height: number } {
  const left = timeToX(item.startT);
  const right = timeToX(item.endT);
  const width = Math.max(18, right - left);
  const top = baseY + item.laneIndex * (rowHeight + rowGap);
  return { left, top, width, height: rowHeight };
}

/** Draw all text overlays on the timeline canvas */
export function drawTextTracks(
  ctx: CanvasRenderingContext2D,
  packed: PackedTextOverlay[],
  timeToX: (t: number) => number,
  selectedId: string | null = null,
  baseY = TEXT_TRACK_BASE_Y,
  rowHeight = TEXT_ROW_HEIGHT,
  rowGap = TEXT_ROW_GAP,
): void {
  for (const item of packed) {
    const { overlay, laneIndex } = item;
    const { left, top, width, height } = textBlockGeometry(
      item,
      timeToX,
      baseY,
      rowHeight,
      rowGap,
    );

    if (left + width < 0 || left > ctx.canvas.width) continue;

    const isSelected = overlay.id === selectedId;
    const isStaged = !!overlay.staged;

    ctx.save();
    roundRectPath(ctx, left, top, width, height, 5);

    // Background fill
    if (isSelected) {
      ctx.fillStyle = "rgba(0, 112, 243, 0.22)";
    } else if (isStaged) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
    } else {
      ctx.fillStyle = "rgba(139, 92, 246, 0.16)"; // soft purple for text
    }
    ctx.fill();

    // Border stroke
    ctx.lineWidth = isSelected ? 1.5 : 1;
    if (isSelected) {
      ctx.strokeStyle = "#0070f3";
    } else if (isStaged) {
      ctx.strokeStyle = "#f59e0b";
      ctx.setLineDash([3, 2]);
    } else {
      ctx.strokeStyle = "#8b5cf6";
    }
    ctx.stroke();

    // Text content clipping & label
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(left + 3, top, Math.max(0, width - 6), height);
    ctx.clip();

    ctx.fillStyle = isSelected ? "#0070f3" : isStaged ? "#d97706" : "#7c3aed";
    ctx.font = "bold 10px ui-sans-serif, system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "middle";

    const label = overlay.text ? overlay.text.replace(/\n/g, " ") : "Text";
    ctx.fillText(`T  ${label}`, left + 6, top + height / 2);

    ctx.restore();
  }
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
