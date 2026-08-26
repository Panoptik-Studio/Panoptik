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

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingDiamond, setDraggingDiamond] = useState<{
    id: string;
    committed: boolean;
  } | null>(null);

  const {
    project,
    currentTime,
    seek,
    selectedZoomId,
    setSelectedZoom,
    updateZoomPoint,
  } = useProjectStore();

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
        className="h-16 border-t border-gray-800 bg-gray-950"
        ref={containerRef}
      />
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

        {/* Playhead */}
        <div
          className="absolute top-0 z-20 h-full w-0.5 bg-white"
          style={{
            left: `${timeToX(currentTime, 100)}%`,
          }}
        >
          <div className="absolute -top-0.5 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-white" />
        </div>
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-sm border border-emerald-400 bg-emerald-500/80" />
          </div>
        ))}

        {/* Staged zoom diamonds (dashed amber) */}
        {stagedZooms.map((zp) => (
          <div
            key={zp.id}
            className="absolute z-10 cursor-grab"
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
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-sm border-2 border-dashed border-amber-400 bg-amber-500/30" />
          </div>
        ))}
      </div>
    </div>
  );
}
