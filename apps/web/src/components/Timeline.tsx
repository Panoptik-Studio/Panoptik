/**
 * OWNER: DEV B — Poindeo-like timeline (shell-timeline 220px, resizable, with
 * canvas scroll area, playhead, and full controls bar). Keeps existing store
 * wiring (zoom diamonds, seeking, captions) inside the new shell.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

const RULER_HEIGHT = 28;
const TRACK_HEIGHT = 36;
const DIAMOND_SIZE = 10;
const SHELL_MIN_H = 140;
const SHELL_MAX_H = 420;
const SHELL_DEFAULT_H = 220;

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

export function Timeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shellH, setShellH] = useState(SHELL_DEFAULT_H);
  const [zoom, setZoom] = useState(0.52);
  const [draggingDiamond, setDraggingDiamond] = useState<{ id: string; committed: boolean } | null>(null);
  const [hoveredDiamond, setHoveredDiamond] = useState<string | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const seek = useProjectStore((s) => s.seek);
  const play = useProjectStore((s) => s.play);
  const pause = useProjectStore((s) => s.pause);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);

  const duration = project?.clip.duration ?? 28;

  // Canvas width scales with zoom: 0→0.5×, 1→2× base
  const baseW = 1387;
  const canvasW = Math.round(baseW * (0.5 + zoom * 1.5));
  const canvasH = 108;
  const timeToX = useCallback((t: number) => (t / duration) * canvasW, [duration, canvasW]);
  const xToTime = useCallback((x: number) => Math.max(0, Math.min(duration, (x / canvasW) * duration)), [duration, canvasW]);

  // Draw ruler + tracks onto canvas (lightweight, no DOM per tick)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = canvasW;
    c.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Ruler bg
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, canvasW, 28);
    ctx.fillStyle = "#ebebeb";
    ctx.fillRect(0, 27, canvasW, 1);

    // Ticks
    const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
    ctx.strokeStyle = "#d4d4d4";
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#666";
    for (let t = 0; t <= duration; t += interval) {
      const x = Math.round(timeToX(t));
      const major = t % (interval * 5) === 0 || t === 0;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, major ? 11 : 6);
      ctx.stroke();
      if (major) {
        const label = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
        ctx.fillText(label, x + 4, 20);
      }
    }

    // Zoom track bg
    ctx.fillStyle = "#f5f5f5";
    ctx.fillRect(8, 40, canvasW - 16, 36);
    ctx.strokeStyle = "#ebebeb";
    ctx.strokeRect(8 + 0.5, 40 + 0.5, canvasW - 16, 36);
    ctx.fillStyle = "#171717";
    ctx.font = "9px monospace";
    ctx.fillText("ZOOM", 14, 62);

    // Diamonds
    const diamonds = [...(project?.zoomPoints ?? []), ...(project?.stagedZoomPoints ?? [])];
    for (const zp of diamonds) {
      const x = timeToX(zp.t);
      const y = 40 + 18;
      const staged = !!(project?.stagedZoomPoints ?? []).find((s) => s.id === zp.id);
      const selected = zp.id === selectedZoomId;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = staged ? "#ffefcf" : "#0070f3";
      ctx.strokeStyle = staged ? "#f5a623" : selected ? "#004299" : "#0761d1";
      ctx.lineWidth = selected ? 2 : 1;
      if (staged) ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.rect(-DIAMOND_SIZE / 2, -DIAMOND_SIZE / 2, DIAMOND_SIZE, DIAMOND_SIZE);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [canvasW, canvasH, duration, project?.zoomPoints, project?.stagedZoomPoints, selectedZoomId, timeToX]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (isDraggingPlayhead || draggingDiamond) return;
    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    // Check diamond hit first
    const diamonds = [...(project?.zoomPoints ?? []), ...(project?.stagedZoomPoints ?? [])];
    for (const zp of diamonds) {
      const dx = timeToX(zp.t);
      if (Math.abs(x - dx) < 14) {
        setSelectedZoom(zp.id);
        return;
      }
    }
    seek(xToTime(x));
  }, [project?.zoomPoints, project?.stagedZoomPoints, seek, setSelectedZoom, timeToX, xToTime]);

  const handleDiamondDrag = useCallback((e: React.PointerEvent) => {
    if (!draggingDiamond || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    updateZoomPoint(draggingDiamond.id, { t: xToTime(x) });
  }, [draggingDiamond, updateZoomPoint, xToTime]);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent) => {
    if (!scrollRef.current || draggingDiamond) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const px = timeToX(currentTime);
    // If near playhead (20px), drag playhead; otherwise seek and start dragging
    if (Math.abs(x - px) < 20 || (e.target as HTMLElement).closest('.playhead, .timeline-canvas, .timeline-scroll-area')) {
      setIsDraggingPlayhead(true);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      seek(xToTime(x));
      e.preventDefault();
    }
  }, [currentTime, draggingDiamond, seek, timeToX, xToTime]);

  const handleTimelinePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingPlayhead || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    seek(xToTime(x));
  }, [isDraggingPlayhead, seek, xToTime]);

  // Resize handle
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shellH;
    const onMove = (ev: PointerEvent) => {
      const dy = startY - ev.clientY;
      setShellH(Math.max(SHELL_MIN_H, Math.min(SHELL_MAX_H, startH + dy)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [shellH]);

  if (!project) {
    return (
      <footer className="shell-timeline flex h-[72px] items-center justify-between border-t bg-[#fafafa] px-4" style={{ borderColor: "#ebebeb" }}>
        <span className="font-mono text-xs" style={{ color: "#888" }}>Timeline — load a clip to begin</span>
        <span className="pk-chip hidden font-mono sm:inline-flex">00:00.0 / 00:00.0</span>
      </footer>
    );
  }

  const playheadX = timeToX(currentTime);
  const endX = timeToX(duration);

  return (
    <footer className="shell-timeline flex flex-col border-t bg-white" style={{ height: shellH, borderColor: "#e5e5e5" }}>
      {/* Resize handle */}
      <div className="timeline-resize-handle flex h-[6px] cursor-ns-resize items-center justify-center bg-[#fafafa] hover:bg-[#f0f0f0]" style={{ borderBottom: "1px solid #ebebeb" }} onPointerDown={onResizeStart}>
        <div className="resize-handle-indicator h-[2px] w-8 rounded-full bg-[#d4d4d4]" />
      </div>

      {/* Controls bar — modern SVGs, no emoji */}
      <div className="timeline-bar flex h-[44px] shrink-0 items-center justify-between border-b bg-white px-3" style={{ borderColor: "#ebebeb" }}>
        <div className="controls-left flex items-center gap-1">
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Video"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Mic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Volume"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Split"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8"/><path d="M8 12h8"/></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Mosaic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Speed"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Eraser"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20 20H7L3 16l9-9 4 4-9 9z"/><path d="M6 11l8-8"/></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Undo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5A2.5 2.5 0 0 1 17 11.5v7"/></svg></button>
        </div>

        <div className="controls-center flex items-center gap-1.5">
          <button className="pk-icon-btn ctrl-btn ctrl-btn--round h-8 w-8 rounded-full" disabled title="Stop"><span className="h-2.5 w-2.5 bg-[#171717] rounded-[1px]" /></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" disabled title="Prev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg></button>
          <button className="ctrl-btn ctrl-btn--play flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors" style={{ background: "#1f1f1f" }} onMouseEnter={(e) => (e.currentTarget.style.background = "#0070f3")} onMouseLeave={(e) => (e.currentTarget.style.background = "#1f1f1f")} onClick={() => isPlaying ? pause() : play()} title={isPlaying ? "Pause" : "Play"}>
            {isPlaying ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
          </button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" disabled title="Next"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg></button>
          <div className="time-display ml-3 flex items-center gap-1.5 font-mono text-[13px] tabular-nums">
            <span className="time-current font-medium" style={{ color: "#1a1a1a" }}>{fmtTime(currentTime)}</span>
            <span className="time-separator" style={{ color: "#888" }}>/</span>
            <span className="time-total" style={{ color: "#888" }}>{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="controls-right flex items-center gap-1">
          <button className="pk-icon-btn ctrl-btn ctrl-btn--zoom h-8 w-8" onClick={() => setZoom((z) => Math.max(0, z - 0.1))} title="Zoom out"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg></button>
          <input type="range" className="pk-range w-24" min={0} max={1} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button className="pk-icon-btn ctrl-btn ctrl-btn--zoom h-8 w-8" onClick={() => setZoom((z) => Math.min(1, z + 0.1))} title="Zoom in"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="11" x2="17" y2="11"/><line x1="14" y1="8" x2="14" y2="14"/></svg></button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="pk-icon-btn ctrl-btn ctrl-btn--zoom h-8 w-8" onClick={() => setZoom(0.52)} title="Fit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg></button>
        </div>
      </div>

      {/* Scroll area + canvas + playhead — seekbar draggable with cursor */}
      <div ref={scrollRef} className="timeline-scroll-area relative flex-1 cursor-pointer overflow-auto" style={{ background: "#f8f8f8" }} onClick={handleCanvasClick} onPointerDown={handleTimelinePointerDown} onPointerMove={(e) => { handleDiamondDrag(e); handleTimelinePointerMove(e); }} onPointerUp={() => { setDraggingDiamond(null); setIsDraggingPlayhead(false); }} onPointerLeave={() => setIsDraggingPlayhead(false)}>
        <div className="relative" style={{ width: canvasW, height: canvasH }}>
          <canvas ref={canvasRef} className="timeline-canvas block" width={canvasW} height={canvasH} style={{ width: canvasW, height: canvasH }} />
          {/* Playhead — draggable with grab cursor */}
          <div className={`playhead absolute top-0 z-20 h-full ${isDraggingPlayhead ? "cursor-grabbing" : "cursor-grab"}`} style={{ transform: `translateX(${playheadX}px)` }} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setIsDraggingPlayhead(true); }}>
            <div className="pointer-events-none absolute left-1/2 h-full w-px -translate-x-1/2 bg-[#0070f3]" />
            <div className="playhead-marker pointer-events-none absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-[#0070f3] shadow-sm" />
            {/* Hit area */}
            <div className="absolute -left-3 top-0 h-full w-6" />
          </div>
          {/* End line */}
          <div className="end-line pointer-events-none absolute top-0 h-full w-px" style={{ transform: `translateX(${endX}px)`, borderLeft: "1px solid rgba(0,0,0,0.08)" }} />
          {/* Diamond hit areas (transparent, for dragging) */}
          {(project.zoomPoints ?? []).map((zp) => (
            <div key={zp.id} className="absolute top-[40px] z-10 h-9 w-6 -translate-x-1/2 cursor-grab" style={{ left: timeToX(zp.t) }} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDraggingDiamond({ id: zp.id, committed: true }); setSelectedZoom(zp.id); }} onMouseEnter={() => setHoveredDiamond(zp.id)} onMouseLeave={() => setHoveredDiamond(null)}>
              {hoveredDiamond === zp.id && (
                <button className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white" onClick={(e) => { e.stopPropagation(); removeZoomPoint(zp.id); }}>×</button>
              )}
            </div>
          ))}
          {(project.stagedZoomPoints ?? []).map((zp) => (
            <div key={zp.id} className="absolute top-[40px] z-10 h-9 w-6 -translate-x-1/2 cursor-grab" style={{ left: timeToX(zp.t) }} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDraggingDiamond({ id: zp.id, committed: false }); setSelectedZoom(zp.id); }} onMouseEnter={() => setHoveredDiamond(zp.id)} onMouseLeave={() => setHoveredDiamond(null)}>
              {hoveredDiamond === zp.id && (
                <button className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white" onClick={(e) => { e.stopPropagation(); removeStagedZoom(zp.id); }}>×</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
