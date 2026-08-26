/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.3.
 * Timeline strip: ruler, playhead, zoom diamonds — Vercel showcase-band-light style.
 * Hairline #ebebeb, mono ticks, stacked shadow, pill diamonds with blue hover.
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
const DIAMOND_SIZE = 10;

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function Playhead({ duration }: { duration: number }) {
  const currentTime = useProjectStore((s) => s.currentTime);
  return (
    <div className="absolute top-0 z-20 h-full w-0.5" style={{ left: `${(currentTime / duration) * 100}%`, background: "#0070f3" }}>
      <div className="absolute -top-0.5 left-1/2 h-0 w-0 -translate-x-1/2 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent" style={{ borderTopColor: "#0070f3" }} />
    </div>
  );
}

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingDiamond, setDraggingDiamond] = useState<{ id: string; committed: boolean } | null>(null);
  const [hoveredDiamond, setHoveredDiamond] = useState<string | null>(null);

  const project = useProjectStore((s) => s.project);
  const seek = useProjectStore((s) => s.seek);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);

  const duration = project?.clip.duration ?? 10;

  const timeToX = useCallback((t: number, width: number) => (t / duration) * width, [duration]);
  const xToTime = useCallback((x: number, width: number) => Math.max(0, Math.min(duration, (x / width) * duration)), [duration]);

  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    seek(xToTime(e.clientX - rect.left, rect.width));
  }, [seek, xToTime]);

  const handleDiamondPointerDown = useCallback((e: React.PointerEvent, id: string, committed: boolean) => {
    e.stopPropagation(); e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingDiamond({ id, committed }); setSelectedZoom(id);
  }, [setSelectedZoom]);

  const handleDiamondPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingDiamond || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    updateZoomPoint(draggingDiamond.id, { t: xToTime(e.clientX - rect.left, rect.width) });
  }, [draggingDiamond, updateZoomPoint, xToTime]);

  const handleDiamondPointerUp = useCallback(() => setDraggingDiamond(null), []);

  const ticks: { time: number; major: boolean }[] = [];
  const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
  for (let t = 0; t <= duration; t += interval) ticks.push({ time: t, major: t % (interval * 5) === 0 || t === 0 });
  if (ticks[ticks.length - 1]?.time !== duration) ticks.push({ time: duration, major: true });

  if (!project) {
    return (
      <div ref={containerRef} className="flex h-[64px] items-center border-t bg-[#fafafa] px-4" style={{ borderColor: "#ebebeb" }}>
        <span className="font-mono text-xs" style={{ color: "#888" }}>Timeline — load a clip to begin</span>
      </div>
    );
  }

  const committedZooms = project.zoomPoints;
  const stagedZooms = project.stagedZoomPoints;

  return (
    <div ref={containerRef} className="relative cursor-pointer select-none border-t bg-white" style={{ borderColor: "#ebebeb" }} onPointerMove={handleDiamondPointerMove} onPointerUp={handleDiamondPointerUp}>
      {/* Ruler — mono ticks */}
      <div className="relative bg-white" style={{ height: RULER_HEIGHT, borderBottom: "1px solid #ebebeb" }} onClick={handleRulerClick}>
        {ticks.map((tick) => (
          <div key={tick.time} className="absolute top-0 flex flex-col items-center" style={{ left: `${timeToX(tick.time, 100)}%` }}>
            <div className="w-px" style={{ height: tick.major ? 10 : 6, background: tick.major ? "#a1a1a1" : "#ebebeb" }} />
            {tick.major && <span className="mt-0.5 font-mono text-[10px]" style={{ color: "#888" }}>{formatTime(tick.time)}</span>}
          </div>
        ))}
        <Playhead duration={duration} />
      </div>

      {/* Track — card-soft inset */}
      <div className="relative mx-3 my-2 rounded-lg border bg-[#fafafa]" style={{ height: TRACK_HEIGHT, borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.02) inset" }}>
        {project.captions.map((cap, i) => (
          <div key={`cap-${i}`} className="absolute top-1 h-1.5 rounded-full" style={{ left: `${timeToX(cap.start, 100)}%`, width: `${((cap.end - cap.start) / duration) * 100}%`, background: "#d3e5ff", border: "1px solid #0070f3" }} />
        ))}

        {committedZooms.map((zp) => (
          <div
            key={zp.id}
            className={`absolute z-10 cursor-grab ${selectedZoomId === zp.id ? "ring-2" : ""}`}
            style={{ left: `${timeToX(zp.t, 100)}%`, top: TRACK_HEIGHT / 2 - DIAMOND_SIZE, width: DIAMOND_SIZE * 2, height: DIAMOND_SIZE * 2, transform: "translateX(-50%) rotate(45deg)", borderColor: selectedZoomId === zp.id ? "#0070f3" : undefined }}
            onPointerDown={(e) => handleDiamondPointerDown(e, zp.id, true)}
            onMouseEnter={() => setHoveredDiamond(zp.id)}
            onMouseLeave={() => setHoveredDiamond(null)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-[3px] border bg-[#0070f3]" style={{ borderColor: "#0761d1", boxShadow: "0 1px 4px rgba(0,112,243,0.25)" }} />
            {hoveredDiamond === zp.id && !draggingDiamond && (
              <button className="absolute -right-3 -top-3 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white hover:bg-[#c50000]" style={{ transform: "rotate(-45deg)" }} onClick={(e) => { e.stopPropagation(); removeZoomPoint(zp.id); }}>×</button>
            )}
          </div>
        ))}

        {stagedZooms.map((zp) => (
          <div
            key={zp.id}
            className={`absolute z-10 cursor-grab ${selectedZoomId === zp.id ? "ring-2" : ""}`}
            style={{ left: `${timeToX(zp.t, 100)}%`, top: TRACK_HEIGHT / 2 - DIAMOND_SIZE, width: DIAMOND_SIZE * 2, height: DIAMOND_SIZE * 2, transform: "translateX(-50%) rotate(45deg)", borderColor: selectedZoomId === zp.id ? "#0070f3" : undefined }}
            onPointerDown={(e) => handleDiamondPointerDown(e, zp.id, false)}
            onMouseEnter={() => setHoveredDiamond(zp.id)}
            onMouseLeave={() => setHoveredDiamond(null)}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-full w-full rounded-[3px] border-2 border-dashed bg-[#ffefcf]" style={{ borderColor: "#f5a623" }} />
            {hoveredDiamond === zp.id && !draggingDiamond && (
              <button className="absolute -right-3 -top-3 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white hover:bg-[#c50000]" style={{ transform: "rotate(-45deg)" }} onClick={(e) => { e.stopPropagation(); removeStagedZoom(zp.id); }}>×</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
