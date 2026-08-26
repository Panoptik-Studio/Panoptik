/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.3.
 * Timeline strip: ruler, playhead, zoom diamonds (solid/dashed),
 * drag-to-seek, drag diamonds, selection, caption bars.
 */
"use client";

import {
  useCallback,
  useRef,
  useState,
} from "react";
import { useProjectStore } from "@/stores/projectStore";

const RULER_HEIGHT = 28;
const TRACK_HEIGHT = 48;
const TOTAL_HEIGHT = RULER_HEIGHT + TRACK_HEIGHT;
const DIAMOND_SIZE = 10;

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

/** Own subscription to currentTime so playback repaints one element, not the strip. */
function Playhead({ duration }: { duration: number }) {
  const currentTime = useProjectStore((s) => s.currentTime);
  return (
    <div
      className="absolute top-0 z-20 h-full w-0.5 bg-white"
      style={{ left: `${(currentTime / duration) * 100}%` }}
    >
      <div className="absolute -top-0.5 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-white" />
    </div>
  );
}

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingDiamond, setDraggingDiamond] = useState<{
    id: string;
    committed: boolean;
  } | null>(null);
  const [hoveredDiamond, setHoveredDiamond] = useState<string | null>(null);

  // Selectors only — currentTime lives in <Playhead> so its 60fps updates don't
  // re-render the ruler and every diamond.
  const project = useProjectStore((s) => s.project);
  const seek = useProjectStore((s) => s.seek);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);

  const duration = project?.clip.duration ?? 10;

  const timeToX = useCallback(
    (t: number, width: number) => {
      return (t / duration) * width;
    },
    [duration],
  );

  const xToTime = useCallback(
    (x: number, width: number) => {
      return Math.max(0, Math.min(duration, (x / width) * duration));
    },
    [duration],
  );

  // ── Click to seek ──
  const handleRulerClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      seek(xToTime(x, rect.width));
    },
    [seek, xToTime],
  );

  // ── Diamond drag ──
  const handleDiamondPointerDown = useCallback(
    (
      e: React.PointerEvent,
      id: string,
      committed: boolean,
    ) => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      setDraggingDiamond({ id, committed });
      setSelectedZoom(id);
    },
    [setSelectedZoom],
  );

  const handleDiamondPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingDiamond || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newT = xToTime(x, rect.width);
      updateZoomPoint(draggingDiamond.id, { t: newT });
    },
    [draggingDiamond, updateZoomPoint, xToTime],
  );

  const handleDiamondPointerUp = useCallback(() => {
    setDraggingDiamond(null);
  }, []);

  // ── Generate ruler ticks ──
  const ticks: { time: number; major: boolean }[] = [];
  const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
  for (let t = 0; t <= duration; t += interval) {
    ticks.push({ time: t, major: t % (interval * 5) === 0 || t === 0 });
  }
  if (ticks[ticks.length - 1]?.time !== duration) {
    ticks.push({ time: duration, major: true });
  }

  if (!project) {
    return (
      <div
        className="flex h-16 items-center border-t border-gray-800 bg-gray-950 px-4"
        ref={containerRef}
      >
        <span className="text-xs text-gray-600">
          Timeline — load a clip to begin
        </span>
      </div>
    );
  }

  const committedZooms = project.zoomPoints;
  const stagedZooms = project.stagedZoomPoints;

  return (
    <div
      ref={containerRef}
      className="relative h-16 cursor-pointer select-none border-t border-gray-800 bg-gray-950"
      onPointerMove={handleDiamondPointerMove}
      onPointerUp={handleDiamondPointerUp}
    >
      {/* Ruler */}
      <div
        className="relative border-b border-gray-800"
        style={{ height: RULER_HEIGHT }}
        onClick={handleRulerClick}
      >
        {ticks.map((tick) => (
          <div
            key={tick.time}
            className="absolute top-0 flex flex-col items-center"
            style={{
              left: `${timeToX(tick.time, 100)}%`,
            }}
          >
            <div
              className={`w-px ${tick.major ? "h-3 bg-gray-500" : "h-2 bg-gray-700"}`}
            />
            {tick.major && (
              <span className="mt-0.5 text-[10px] text-gray-500">
                {formatTime(tick.time)}
              </span>
            )}
          </div>
        ))}

        <Playhead duration={duration} />
      </div>

      {/* Diamond track */}
      <div
        className="relative"
        style={{ height: TRACK_HEIGHT }}
      >
        {/* Caption bars */}
        {project.captions.map((cap, i) => (
          <div
            key={`cap-${i}`}
            className="absolute top-1 h-2 rounded bg-blue-500/30"
            style={{
              left: `${timeToX(cap.start, 100)}%`,
              width: `${((cap.end - cap.start) / duration) * 100}%`,
            }}
          />
        ))}

        {/* Committed zoom diamonds (solid emerald) */}
        {committedZooms.map((zp) => (
          <div
            key={zp.id}
            className={`absolute z-10 cursor-grab ${
              selectedZoomId === zp.id
                ? "ring-2 ring-white"
                : ""
            }`}
            style={{
              left: `${timeToX(zp.t, 100)}%`,
              top: TRACK_HEIGHT / 2 - DIAMOND_SIZE,
              width: DIAMOND_SIZE * 2,
              height: DIAMOND_SIZE * 2,
              transform: "translateX(-50%) rotate(45deg)",
            }}
            onPointerDown={(e) =>
              handleDiamondPointerDown(e, zp.id, true)
            }
            onMouseEnter={() => setHoveredDiamond(zp.id)}
            onMouseLeave={() => setHoveredDiamond(null)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-sm border border-emerald-400 bg-emerald-500/80" />
            {hoveredDiamond === zp.id && !draggingDiamond && (
              <button
                className="absolute -right-3 -top-3 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[8px] text-white hover:bg-red-500"
                style={{ transform: "rotate(-45deg)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeZoomPoint(zp.id);
                }}
              >
                x
              </button>
            )}
          </div>
        ))}

        {/* Staged zoom diamonds (dashed amber) */}
        {stagedZooms.map((zp) => (
          <div
            key={zp.id}
            className={`absolute z-10 cursor-grab ${
              selectedZoomId === zp.id
                ? "ring-2 ring-white"
                : ""
            }`}
            style={{
              left: `${timeToX(zp.t, 100)}%`,
              top: TRACK_HEIGHT / 2 - DIAMOND_SIZE,
              width: DIAMOND_SIZE * 2,
              height: DIAMOND_SIZE * 2,
              transform: "translateX(-50%) rotate(45deg)",
            }}
            onPointerDown={(e) =>
              handleDiamondPointerDown(e, zp.id, false)
            }
            onMouseEnter={() => setHoveredDiamond(zp.id)}
            onMouseLeave={() => setHoveredDiamond(null)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-sm border-2 border-dashed border-amber-400 bg-amber-500/30" />
            {hoveredDiamond === zp.id && !draggingDiamond && (
              <button
                className="absolute -right-3 -top-3 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[8px] text-white hover:bg-red-500"
                style={{ transform: "rotate(-45deg)" }}
                onClick={(e) => {
                  e.stopPropagation();
                  removeStagedZoom(zp.id);
                }}
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
