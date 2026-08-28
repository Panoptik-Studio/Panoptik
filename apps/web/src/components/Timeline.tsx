/**
 * OWNER: DEV B — Poindeo-like timeline (shell-timeline 220px, resizable, with
 * canvas scroll area, playhead, and full controls bar). Keeps existing store
 * wiring (segment filmstrip, zoom diamonds, seeking, split, speed) inside the
 * new shell. Timeline time is ON-TIMELINE; segments are laid out by
 * segmentDuration / projectDuration; diamonds/edits target the selected segment.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { useTimelineThumbnails } from "@/lib/useTimelineThumbnails";
import {
  segmentDuration,
  projectDuration,
  resolveSegment,
  sourceToTimeline,
} from "@panoptik/engine";

const RULER_HEIGHT = 28;
const TRACK_HEIGHT = 36;
const DIAMOND_SIZE = 10;
const SHELL_MIN_H = 140;
const SHELL_MAX_H = 420;
const SHELL_DEFAULT_H = 220;

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
}

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
  const [draggingDiamond, setDraggingDiamond] = useState<{ id: string; committed: boolean; segmentId: string } | null>(null);
  const [hoveredDiamond, setHoveredDiamond] = useState<string | null>(null);
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const isPlaying = useProjectStore((s) => s.isPlaying);
  const seek = useProjectStore((s) => s.seek);
  const play = useProjectStore((s) => s.play);
  const pause = useProjectStore((s) => s.pause);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectedSegmentIds = useProjectStore((s) => s.selectedSegmentIds);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const splitAt = useProjectStore((s) => s.splitAt);
  const deleteSegment = useProjectStore((s) => s.deleteSegment);
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const [showSpeed, setShowSpeed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    segmentId: string;
    timelineT: number;
  } | null>(null);

  const { getThumbnail, version: thumbVersion } = useTimelineThumbnails(
    project?.media?.src,
    project?.media?.duration,
  );

  // On-timeline duration across all segments.
  const duration = project ? Math.max(projectDuration(project), 0.001) : 0.001;

  // Canvas width scales with zoom: 0→0.5×, 1→2× base — ruler uses on-timeline duration
  const baseW = 1387;
  const canvasW = Math.round(baseW * (0.5 + zoom * 1.5));
  const canvasH = 108;
  const timeToX = useCallback((t: number) => (t / duration) * canvasW, [duration, canvasW]);
  const xToTime = useCallback((x: number) => Math.max(0, Math.min(duration, (x / canvasW) * duration)), [duration, canvasW]);

  // The selected segment's speed, or 1 when nothing is selected.
  const sel = project?.segments.find((s) => s.id === selectedSegmentId);
  const segSpeed = sel?.speed ?? 1;
  const canSpeed = selectedSegmentId !== null && exportProgress === null;

  // Track and highlight the active segment under the playhead slider during playback
  useEffect(() => {
    if (!project || !isPlaying) return;
    const r = resolveSegment(project, currentTime);
    if (r && r.segment.id !== selectedSegmentId) {
      selectSegment(r.segment.id, false);
    }
  }, [project, selectedSegmentId, currentTime, isPlaying, selectSegment]);

  // Draw ruler + tracks onto canvas (lightweight, no DOM per tick)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    c.width = canvasW;
    c.height = canvasH;
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Identify active segment under playhead
    const activeSegId = project ? resolveSegment(project, currentTime)?.segment.id : null;

    // Ruler bg
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, canvasW, 28);
    ctx.fillStyle = "#ebebeb";
    ctx.fillRect(0, 27, canvasW, 1);

    // Ticks — on-timeline duration
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

    // Segment filmstrip blocks
    const TRACK_Y = 36;
    let acc = 0;
    for (const seg of project?.segments ?? []) {
      const d = segmentDuration(seg);
      const x0 = timeToX(acc);
      const x1 = timeToX(acc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);

      // 1. Clip filmstrip to the rounded segment block so thumbnails stay neat
      ctx.save();
      drawRoundRect(ctx, x0, TRACK_Y, segW, TRACK_HEIGHT, 4);
      ctx.clip();

      // Base background
      ctx.fillStyle = "#f0f2f5";
      ctx.fillRect(x0, TRACK_Y, segW, TRACK_HEIGHT);

      // Tile thumbnails across the segment
      const tileH = TRACK_HEIGHT;
      const tileW = 54; // ~16:9 proportion for 36px height
      const numTiles = Math.max(1, Math.ceil(segW / tileW));

      for (let i = 0; i < numTiles; i++) {
        const tx = x0 + i * tileW;
        const currentTileW = Math.min(tileW, x1 - tx);
        if (currentTileW <= 0) continue;

        // Calculate the timestamp corresponding to the center of this thumbnail tile
        const progress = Math.max(0, Math.min(1, (tx + currentTileW / 2 - x0) / segW));
        const srcT = seg.srcStart + progress * (seg.srcEnd - seg.srcStart);

        const thumb = getThumbnail(srcT);
        if (thumb) {
          // Draw extracted video frame thumbnail
          ctx.drawImage(thumb, 0, 0, thumb.width, thumb.height, tx, TRACK_Y, currentTileW, tileH);
        } else {
          // Clean, modern placeholder tile (sleek neutral with subtle filmstrip mark)
          ctx.fillStyle = i % 2 === 0 ? "#f0f2f5" : "#e8ebed";
          ctx.fillRect(tx, TRACK_Y, currentTileW, tileH);

          // Subtle placeholder frame outline
          if (currentTileW >= 20) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
            ctx.fillRect(tx + 4, TRACK_Y + 4, currentTileW - 8, tileH - 8);
          }
        }

        // Subtle frame separator between thumbnail tiles
        if (i > 0) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx + 0.5, TRACK_Y);
          ctx.lineTo(tx + 0.5, TRACK_Y + tileH);
          ctx.stroke();
        }
      }

      // If selected, apply a subtle blue tint over the segment
      if (selected) {
        ctx.fillStyle = "rgba(0, 112, 243, 0.10)";
        ctx.fillRect(x0, TRACK_Y, segW, TRACK_HEIGHT);
      }

      ctx.restore();

      // 2. Outer segment stroke
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 2;
        drawRoundRect(ctx, x0 + 1, TRACK_Y + 1, Math.max(1, segW - 2), TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#d4d4d4";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, TRACK_Y + 0.5, Math.max(1, segW - 1), TRACK_HEIGHT - 1, 4);
        ctx.stroke();
      }

      // 3. Speed badge
      if (seg.speed !== 1) {
        const speedText = `${String(seg.speed).replace(/\.?0$/, "")}x`;
        ctx.font = "bold 9px monospace";
        const textMetrics = ctx.measureText(speedText);
        const badgeW = textMetrics.width + 8;
        const badgeH = 14;
        const badgeX = x0 + 4;
        const badgeY = TRACK_Y + 4;

        ctx.fillStyle = selected ? "#0070f3" : "rgba(30, 30, 30, 0.85)";
        drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(speedText, badgeX + 4, badgeY + 10);
      }

      // 4. Split boundary between segments
      if (acc + d < duration) {
        ctx.strokeStyle = "#888888";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, TRACK_Y + TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      acc += d;
    }

    // Diamonds — per segment, positioned via sourceToTimeline
    for (const seg of project?.segments ?? []) {
      for (const zp of [...seg.zoomPoints, ...seg.stagedZoomPoints]) {
        const st = sourceToTimeline(project!, seg.id, zp.t);
        if (st == null) continue;
        const x = timeToX(st);
        const y = 36 + TRACK_HEIGHT / 2;
        const staged = !!seg.stagedZoomPoints.find((s) => s.id === zp.id);
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
    }
  }, [canvasW, canvasH, duration, project, selectedSegmentId, selectedSegmentIds, selectedZoomId, thumbVersion, getThumbnail, timeToX, currentTime, isPlaying]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (isDraggingPlayhead || draggingDiamond) return;
    const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
    // Multi-select is handled on pointerdown; avoid double-toggling
    if (isMulti) return;

    if (!scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;

    // Diamond hit first — select the segment the diamond belongs to, then the zoom
    for (const seg of project?.segments ?? []) {
      for (const zp of [...seg.zoomPoints, ...seg.stagedZoomPoints]) {
        const st = sourceToTimeline(project!, seg.id, zp.t);
        if (st == null) continue;
        if (Math.abs(x - timeToX(st)) < 14) {
          selectSegment(seg.id, false);
          setSelectedZoom(zp.id);
          return;
        }
      }
    }
    setSelectedZoom(null);

    // Segment selection: which filmstrip block does the x fall in?
    let acc = 0;
    for (const seg of project?.segments ?? []) {
      const d = segmentDuration(seg);
      if (x >= timeToX(acc) && x < timeToX(acc + d)) {
        selectSegment(seg.id, false);
        break;
      }
      acc += d;
    }
    seek(xToTime(x));
  }, [isDraggingPlayhead, draggingDiamond, project, selectSegment, seek, setSelectedZoom, timeToX, xToTime]);

  const handleDiamondDrag = useCallback((e: React.PointerEvent) => {
    if (!draggingDiamond || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const timelineT = xToTime(x);
    const proj = project;
    if (!proj) return;
    // Derive srcT from the diamond's HOME segment, not from whatever segment the
    // pointer happens to sit over. Find the home segment's on-timeline window and
    // clamp the pointer's timeline x to it, so dragging across a boundary never
    // writes an out-of-range srcT into the home segment (it clamps at the edge).
    const home = proj.segments.find((seg) => seg.id === draggingDiamond.segmentId);
    if (!home) return;
    let segStart = 0;
    for (const seg of proj.segments) {
      if (seg.id === home.id) break;
      segStart += segmentDuration(seg);
    }
    const segEnd = segStart + segmentDuration(home);
    const clampedT = Math.max(segStart, Math.min(segEnd, timelineT));
    const srcT = home.srcStart + (clampedT - segStart) * home.speed;
    // updateZoomPoint targets the SELECTED segment, so select the home segment.
    selectSegment(home.id);
    updateZoomPoint(draggingDiamond.id, { t: srcT });
  }, [draggingDiamond, project, selectSegment, updateZoomPoint, xToTime]);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent) => {
    if (contextMenu) setContextMenu(null);
    if (!scrollRef.current || draggingDiamond) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const px = timeToX(currentTime);

    const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
    if (isMulti && project) {
      let acc = 0;
      for (const seg of project.segments) {
        const d = segmentDuration(seg);
        if (x >= timeToX(acc) && x < timeToX(acc + d)) {
          selectSegment(seg.id, true);
          break;
        }
        acc += d;
      }
      seek(xToTime(x));
      e.preventDefault();
      return;
    }

    // If near playhead (20px), drag playhead; otherwise seek and start dragging
    if (Math.abs(x - px) < 20 || (e.target as HTMLElement).closest('.playhead, .timeline-canvas, .timeline-scroll-area')) {
      setIsDraggingPlayhead(true);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      seek(xToTime(x));
      e.preventDefault();
    }
  }, [contextMenu, currentTime, draggingDiamond, project, selectSegment, seek, timeToX, xToTime]);

  const handleTimelinePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingPlayhead || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    seek(xToTime(x));
  }, [isDraggingPlayhead, seek, xToTime]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!scrollRef.current || !project) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    const t = xToTime(x);

    // Identify which segment was right-clicked
    let acc = 0;
    let clickedSegment = null;
    for (const seg of project.segments) {
      const d = segmentDuration(seg);
      const startX = timeToX(acc);
      const endX = timeToX(acc + d);
      if (x >= startX && x <= endX) {
        clickedSegment = seg;
        break;
      }
      acc += d;
    }

    if (clickedSegment) {
      selectSegment(clickedSegment.id);
      setContextMenu({
        x: Math.min(window.innerWidth - 210, Math.max(10, e.clientX)),
        y: Math.min(window.innerHeight - 160, Math.max(10, e.clientY)),
        segmentId: clickedSegment.id,
        timelineT: t,
      });
    } else {
      setContextMenu(null);
    }
  }, [project, selectSegment, timeToX, xToTime]);

  // Context menu dismissal and keyboard Delete/Backspace listeners
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("#timeline-context-menu")) return;
      setContextMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (e.target as HTMLElement)?.tagName !== "INPUT" &&
        (e.target as HTMLElement)?.tagName !== "TEXTAREA"
      ) {
        const state = useProjectStore.getState();
        if (
          state.selectedSegmentId &&
          (state.project?.segments.length ?? 0) > 1 &&
          state.exportProgress === null
        ) {
          e.preventDefault();
          state.deleteSegment(state.selectedSegmentId);
          setContextMenu(null);
        }
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Split at playhead" disabled={exportProgress !== null} onClick={() => splitAt(currentTime)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="6.5" height="14" rx="1.5" /><rect x="14.5" y="5" width="6.5" height="14" rx="1.5" /><line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2.5 2" strokeWidth="1.6" /></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Mosaic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
          <div className="relative" onMouseEnter={() => exportProgress === null && setShowSpeed(true)} onMouseLeave={() => setShowSpeed(false)}>
            <button className="pk-icon-btn ctrl-btn h-8 w-8 relative" title={`Speed ${segSpeed}x`} disabled={!canSpeed}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>{segSpeed !== 1 && <span className="absolute -right-1 -top-1 rounded-full bg-[#0070f3] px-1 py-0.5 text-[9px] font-bold leading-none text-white">{segSpeed}x</span>}</button>
            {showSpeed && exportProgress === null && (
              <div className="absolute bottom-full left-1/2 z-30 mb-2 flex -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl border bg-white p-2 shadow-vercel-3" style={{ borderColor: "#ebebeb", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}>
                <div className="flex gap-1">
                  {[0.5, 1, 1.5, 2, 3].map((v) => (
                    <button key={v} onClick={() => selectedSegmentId && updateSegment(selectedSegmentId, { speed: v })} className="pk-seg min-w-[44px] text-xs" data-active={segSpeed === v}>{v}x</button>
                  ))}
                </div>
                {(() => {
                  const segIdx = project?.segments.findIndex((s) => s.id === selectedSegmentId) ?? -1;
                  const prevSeg = segIdx > 0 ? project?.segments[segIdx - 1] : null;
                  const nextSeg = segIdx >= 0 && segIdx < (project?.segments.length ?? 0) - 1 ? project?.segments[segIdx + 1] : null;
                  if (!prevSeg && !nextSeg) return null;
                  return (
                    <div className="flex w-full gap-1">
                      {prevSeg && (
                        <button
                          onClick={() => selectedSegmentId && updateSegment(selectedSegmentId, { speed: prevSeg.speed })}
                          disabled={segSpeed === prevSeg.speed}
                          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#e5e5e5] bg-[#fafafa] py-1 text-[10px] font-medium text-[#555] transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] disabled:opacity-40"
                          title={`Match speed from previous clip (${prevSeg.speed}x)`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
                          <span>Prev ({prevSeg.speed}x)</span>
                        </button>
                      )}
                      {nextSeg && (
                        <button
                          onClick={() => selectedSegmentId && updateSegment(selectedSegmentId, { speed: nextSeg.speed })}
                          disabled={segSpeed === nextSeg.speed}
                          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#e5e5e5] bg-[#fafafa] py-1 text-[10px] font-medium text-[#555] transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] disabled:opacity-40"
                          title={`Match speed from next clip (${nextSeg.speed}x)`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 14 20 9 15 4"/><path d="M4 20v-7a4 4 0 0 1 4-4h12"/></svg>
                          <span>Next ({nextSeg.speed}x)</span>
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button
            className="pk-icon-btn ctrl-btn h-8 w-8"
            title={
              !selectedSegmentId || project.segments.length <= 1
                ? "Cannot delete the only clip (split first)"
                : "Delete selected clip (⌫)"
            }
            disabled={!selectedSegmentId || project.segments.length <= 1 || exportProgress !== null}
            onClick={() => selectedSegmentId && deleteSegment(selectedSegmentId)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M20 20H7L3 16l9-9 4 4-9 9z"/>
              <path d="M6 11l8-8"/>
            </svg>
          </button>
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
      <div
        ref={scrollRef}
        className="timeline-scroll-area relative flex-1 cursor-pointer overflow-auto"
        style={{ background: "#f8f8f8" }}
        onClick={handleCanvasClick}
        onContextMenu={handleContextMenu}
        onPointerDown={handleTimelinePointerDown}
        onPointerMove={(e) => { handleDiamondDrag(e); handleTimelinePointerMove(e); }}
        onPointerUp={() => { setDraggingDiamond(null); setIsDraggingPlayhead(false); }}
        onPointerLeave={() => setIsDraggingPlayhead(false)}
      >
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
          {/* Diamond hit areas (transparent, for dragging) — per segment, on-timeline */}
          {project.segments.flatMap((seg) =>
            [...seg.zoomPoints, ...seg.stagedZoomPoints].map((zp) => {
              const st = sourceToTimeline(project, seg.id, zp.t);
              if (st == null) return null;
              const isStaged = !!seg.stagedZoomPoints.find((s) => s.id === zp.id);
              return (
                <div key={zp.id} className="absolute top-[36px] z-10 h-9 w-6 -translate-x-1/2 cursor-grab" style={{ left: timeToX(st) }} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDraggingDiamond({ id: zp.id, committed: !isStaged, segmentId: seg.id }); setSelectedZoom(zp.id); selectSegment(seg.id); }} onMouseEnter={() => setHoveredDiamond(zp.id)} onMouseLeave={() => setHoveredDiamond(null)}>
                  {hoveredDiamond === zp.id && (
                    <button className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white" onClick={(e) => { e.stopPropagation(); isStaged ? removeStagedZoom(zp.id) : removeZoomPoint(zp.id); }}>×</button>
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>

      {/* Right-click Context Menu */}
      {contextMenu && (
        <div
          id="timeline-context-menu"
          className="fixed z-50 min-w-[200px] rounded-xl border bg-white p-1.5 shadow-vercel-3 animate-in fade-in zoom-in-95 duration-100"
          style={{
            left: contextMenu.x,
            top: contextMenu.y - 85 < 0 ? contextMenu.y + 10 : contextMenu.y - 85,
            borderColor: "#ebebeb",
            boxShadow: "0 8px 30px rgba(0,0,0,0.14)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#888]">
            Clip Actions
          </div>
          <button
            className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[#1a1a1a] hover:bg-[#f5f5f5] transition-colors"
            disabled={exportProgress !== null}
            onClick={() => {
              splitAt(contextMenu.timelineT);
              setContextMenu(null);
            }}
          >
            <span className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="6.5" height="14" rx="1.5" />
                <rect x="14.5" y="5" width="6.5" height="14" rx="1.5" />
                <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2.5 2" strokeWidth="1.6" />
              </svg>
              Split at cursor
            </span>
          </button>
          <div className="my-1 h-px bg-[#ebebeb]" />
          <button
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
              project.segments.length > 1 && exportProgress === null
                ? "text-[#ee0000] hover:bg-[#fff0f0]"
                : "cursor-not-allowed text-[#aaa]"
            }`}
            disabled={project.segments.length <= 1 || exportProgress !== null}
            title={
              project.segments.length <= 1
                ? "Cannot delete the only clip (split first)"
                : "Delete this clip"
            }
            onClick={() => {
              deleteSegment(contextMenu.segmentId);
              setContextMenu(null);
            }}
          >
            <span className="flex items-center gap-2">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              Delete clip
            </span>
            <span className="font-mono text-[10px] opacity-70">⌫</span>
          </button>
        </div>
      )}
    </footer>
  );
}
