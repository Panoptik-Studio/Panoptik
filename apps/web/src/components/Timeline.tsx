/**
 * OWNER: DEV B — ROADMAP-B.md Task 2.3.
 * Timeline strip: header, detailed ruler with frames, playhead, zoom diamonds, caption bars.
 * Vercel light, mono, hairline, with time-frames and more functionality.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

const RULER_HEIGHT = 32;
const TRACK_HEIGHT = 56;
const DIAMOND_SIZE = 10;

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

function formatTimeWithFrames(t: number, fps = 30): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * fps);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const ff = String(f).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}

function Playhead({ duration }: { duration: number }) {
  const currentTime = useProjectStore((s) => s.currentTime);
  return (
    <div className="absolute top-0 z-20 h-full w-0.5" style={{ left: `${(currentTime / duration) * 100}%`, background: "#0070f3" }}>
      <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border bg-[#0070f3]" style={{ borderColor: "#0070f3" }} />
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#171717] px-1.5 py-0.5 font-mono text-[10px] font-medium text-white shadow-md">
        {formatTimeWithFrames(currentTime)}
      </div>
    </div>
  );
}

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [draggingDiamond, setDraggingDiamond] = useState<{ id: string; committed: boolean } | null>(null);
  const [hoveredDiamond, setHoveredDiamond] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const seek = useProjectStore((s) => s.seek);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const addZoomPoint = useProjectStore((s) => s.addZoomPoint);

  const duration = project?.clip.duration ?? 10;

  const timeToX = useCallback((t: number, width: number) => (t / duration) * width, [duration]);
  const xToTime = useCallback((x: number, width: number) => Math.max(0, Math.min(duration, (x / width) * duration)), [duration]);

  const handleRulerClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    seek(xToTime(e.clientX - rect.left, rect.width));
  }, [seek, xToTime]);

  const handleDiamondPointerDown = useCallback((e: React.PointerEvent, id: string, committed: boolean) => {
    e.stopPropagation(); e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingDiamond({ id, committed }); setSelectedZoom(id);
  }, [setSelectedZoom]);

  const handleDiamondPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingDiamond || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    updateZoomPoint(draggingDiamond.id, { t: xToTime(e.clientX - rect.left, rect.width) });
    setHoverTime(xToTime(e.clientX - rect.left, rect.width));
  }, [draggingDiamond, updateZoomPoint, xToTime]);

  const handleDiamondPointerUp = useCallback(() => { setDraggingDiamond(null); setHoverTime(null); }, []);

  const handleMouseMove = useCallback((e: React.PointerEvent) => {
    if (draggingDiamond || !rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    setHoverTime(xToTime(e.clientX - rect.left, rect.width));
  }, [draggingDiamond, xToTime]);

  const handleMouseLeave = useCallback(() => setHoverTime(null), []);

  const handleAddZoom = useCallback(() => {
    addZoomPoint({ t: currentTime, to: { scale: 2, x: 0.5, y: 0.5 }, dur: 0.45, ease: "easeInOutCubic" });
  }, [addZoomPoint, currentTime]);

  const ticks: { time: number; major: boolean }[] = [];
  const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
  for (let t = 0; t <= duration; t += interval) ticks.push({ time: t, major: t % (interval * 5) === 0 || t === 0 });
  if (ticks[ticks.length - 1]?.time !== duration) ticks.push({ time: duration, major: true });

  if (!project) {
    return (
      <div ref={containerRef} className="flex h-[72px] items-center justify-between border-t bg-[#fafafa] px-4" style={{ borderColor: "#ebebeb" }}>
        <span className="font-mono text-xs" style={{ color: "#888" }}>Timeline — load a clip to begin</span>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 font-mono text-[10px]" style={{ borderColor: "#ebebeb", color: "#888" }}>00:00:00 / 00:00:00</span>
      </div>
    );
  }

  const committedZooms = project.zoomPoints;
  const stagedZooms = project.stagedZoomPoints;
  const totalZooms = committedZooms.length + stagedZooms.length;

  return (
    <div ref={containerRef} className="relative mx-6 select-none overflow-visible rounded-lg border bg-white" style={{ borderColor: "#ebebeb" }} onPointerMove={(e) => { handleDiamondPointerMove(e); handleMouseMove(e); }} onPointerUp={handleDiamondPointerUp} onPointerLeave={handleMouseLeave}>
      {/* Header — title + time + add button */}
      <div className="flex h-8 items-center justify-between border-b bg-[#fafafa] px-4" style={{ borderColor: "#ebebeb" }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[-0.01em]" style={{ color: "#171717" }}>Timeline</span>
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full border bg-white px-2 py-0.5 font-mono text-[10px]" style={{ borderColor: "#ebebeb", color: "#666" }}>
            {formatTimeWithFrames(currentTime)} / {formatTimeWithFrames(duration)}
          </span>
          <span className="hidden items-center gap-1 font-mono text-[10px] sm:inline-flex" style={{ color: "#888" }}>• {totalZooms} zoom{totalZooms===1?"":"s"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline-flex font-mono text-[10px]" style={{ color: "#888" }}>{duration.toFixed(1)}s • 30fps</span>
          <button onClick={handleAddZoom} className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>
            <span className="text-[12px] leading-none">＋</span> Zoom at playhead
          </button>
        </div>
      </div>

      {/* Ruler — mono ticks + playhead + hover time */}
      <div ref={rulerRef} className="relative mx-4 bg-white px-2" style={{ height: RULER_HEIGHT, borderBottom: "1px solid #ebebeb" }} onClick={handleRulerClick}>
        {/* Sub-ticks for frames when zoomed in (duration <= 30) */}
        {duration <= 30 && Array.from({ length: Math.floor(duration * 3) }).map((_, i) => {
          const t = i * (1/3);
          if (ticks.some((tk) => Math.abs(tk.time - t) < 0.01)) return null;
          return <div key={`sub-${i}`} className="absolute top-0 w-px" style={{ left: `${timeToX(t, 100)}%`, height: 4, background: "#f0f0f0" }} />;
        })}
        {ticks.map((tick) => (
          <div key={tick.time} className="absolute top-0 flex flex-col items-center" style={{ left: `${timeToX(tick.time, 100)}%` }}>
            <div className="w-px" style={{ height: tick.major ? 11 : 6, background: tick.major ? "#171717" : "#d4d4d4" }} />
            {tick.major && <span className="mt-0.5 font-mono text-[10px] font-medium" style={{ color: tick.major ? "#171717" : "#888" }}>{formatTime(tick.time)}</span>}
            {tick.major && <span className="font-mono text-[9px]" style={{ color: "#a3a3a3" }}>{String(Math.floor((tick.time % 60) * 30)).padStart(2, "0")}f</span>}
          </div>
        ))}
        {hoverTime !== null && !draggingDiamond && (
          <div className="absolute top-0 h-full w-px bg-[#0070f3]/30" style={{ left: `${timeToX(hoverTime, 100)}%` }}>
            <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[#0070f3] px-1 py-px font-mono text-[9px] font-medium text-white">{formatTimeWithFrames(hoverTime)}</span>
          </div>
        )}
        <Playhead duration={duration} />
      </div>

      {/* Zoom track — inset to avoid right-cut */}
      <div className="relative mx-4 my-2 px-2">
        <div ref={trackRef} className="relative flex items-center rounded-lg border bg-[#fafafa]" style={{ height: 36, borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.02) inset" }}>
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 rounded bg-white px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide shadow-sm" style={{ color: "#171717", border: "1px solid #ebebeb" }}>ZOOM</span>
          {committedZooms.map((zp) => (
            <div
              key={zp.id}
              className={`absolute z-10 cursor-grab ${selectedZoomId === zp.id ? "ring-2" : ""}`}
              style={{ left: `${timeToX(zp.t, 100)}%`, top: 36 / 2 - DIAMOND_SIZE, width: DIAMOND_SIZE * 2, height: DIAMOND_SIZE * 2, transform: "translateX(-50%) rotate(45deg)", borderColor: selectedZoomId === zp.id ? "#0070f3" : undefined }}
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
              style={{ left: `${timeToX(zp.t, 100)}%`, top: 36 / 2 - DIAMOND_SIZE, width: DIAMOND_SIZE * 2, height: DIAMOND_SIZE * 2, transform: "translateX(-50%) rotate(45deg)", borderColor: selectedZoomId === zp.id ? "#0070f3" : undefined }}
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
    </div>
  );
}
