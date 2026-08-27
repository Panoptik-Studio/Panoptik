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
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 font-mono text-[10px]" style={{ borderColor: "#ebebeb", color: "#888" }}>00:00.0 / 00:00.0</span>
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

      {/* Controls bar */}
      <div className="timeline-bar flex h-[44px] shrink-0 items-center justify-between border-b bg-white px-3" style={{ borderColor: "#ebebeb" }}>
        <div className="controls-left flex items-center gap-1">
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5] disabled:opacity-40" title="Video"><span className="text-[14px]">🎬</span></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Mic"><span className="text-[14px]">🎤</span></button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Volume"><span className="text-[14px]">🔊</span></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Split"><span className="text-[14px]">◫</span></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Mosaic"><span className="text-[14px]">⊞</span></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Speed"><span className="text-[14px]">⏱</span></button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Eraser"><span className="text-[14px]">⌫</span></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" title="Undo"><span className="text-[14px]">↩</span></button>
        </div>

        <div className="controls-center flex items-center gap-1.5">
          <button className="ctrl-btn ctrl-btn--round flex h-7 w-7 items-center justify-center rounded-full border hover:bg-[#f5f5f5] disabled:opacity-40" disabled title="Stop"><span className="h-2 w-2 bg-[#171717] " /></button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5] disabled:opacity-40" disabled title="Prev"><span className="text-[14px]">⏮</span></button>
          <button className="ctrl-btn ctrl-btn--play flex h-8 w-8 items-center justify-center rounded-full bg-[#171717] text-white hover:bg-black" onClick={() => isPlaying ? pause() : play()} title={isPlaying ? "Pause" : "Play"}>
            <span className="text-[12px]">{isPlaying ? "❚❚" : "▶"}</span>
          </button>
          <button className="ctrl-btn flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5] disabled:opacity-40" disabled title="Next"><span className="text-[14px]">⏭</span></button>
          <div className="time-display ml-2 flex items-center gap-1 font-mono text-xs">
            <span className="time-current font-medium" style={{ color: "#171717" }}>{fmtTime(currentTime)}</span>
            <span className="time-separator" style={{ color: "#888" }}>/</span>
            <span className="time-total" style={{ color: "#888" }}>{fmtTime(duration)}</span>
          </div>
        </div>

        <div className="controls-right flex items-center gap-1">
          <button className="ctrl-btn ctrl-btn--zoom flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" onClick={() => setZoom((z) => Math.max(0, z - 0.1))} title="Zoom out">−</button>
          <input type="range" className="zoom-slider h-1 w-24 accent-[#171717]" min={0} max={1} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          <button className="ctrl-btn ctrl-btn--zoom flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" onClick={() => setZoom((z) => Math.min(1, z + 0.1))} title="Zoom in">+</button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button className="ctrl-btn ctrl-btn--zoom flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5]" onClick={() => setZoom(0.52)} title="Fit"><span className="text-[14px]">⛶</span></button>
        </div>
      </div>

      {/* Scroll area + canvas + playhead */}
      <div ref={scrollRef} className="timeline-scroll-area relative flex-1 overflow-auto bg-[#fafafa]" onClick={handleCanvasClick} onPointerMove={handleDiamondDrag} onPointerUp={() => setDraggingDiamond(null)}>
        <div className="relative" style={{ width: canvasW, height: canvasH }}>
          <canvas ref={canvasRef} className="timeline-canvas block" width={canvasW} height={canvasH} style={{ width: canvasW, height: canvasH }} />
          {/* Playhead */}
          <div className="playhead pointer-events-none absolute top-0 z-20 h-full w-px" style={{ transform: `translateX(${playheadX}px)`, background: "#0070f3" }}>
            <div className="playhead-marker absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-[#0070f3] shadow-sm" />
            <div className="playhead-line h-full w-px bg-[#0070f3]" />
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
