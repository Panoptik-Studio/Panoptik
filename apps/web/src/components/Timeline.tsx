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
import { engine } from "@/lib/engineProvider";
import {
  segmentDuration,
  projectDuration,
  resolveSegment,
  sourceToTimeline,
} from "@panoptik/engine";
import { TRANSITION_ICONS, getClosestGridPreset } from "./CameraControls";
import { AUDIO_TRACK_Y, AUDIO_LANE_HEIGHT, audioBlockGeometry, drawAudioTracks } from "@/lib/timelineAudioTracks";

const RULER_HEIGHT = 26;
const VIDEO_TRACK_Y = 30;
const VIDEO_TRACK_HEIGHT = 32;
const ADD_CLIP_ZONE_W = 40;
const SCREEN_AUDIO_TRACK_Y = 66;
const SCREEN_AUDIO_TRACK_HEIGHT = 24;
const FACECAM_TRACK_Y = 94;
const FACECAM_TRACK_HEIGHT = 26;
const FACECAM_AUDIO_TRACK_Y = 124;
const FACECAM_AUDIO_TRACK_HEIGHT = 24;
const ZOOM_TRACK_Y = 152;
const ZOOM_TRACK_HEIGHT = 24;
const DIAMOND_SIZE = 10;
const SHELL_MIN_H = 180;
const SHELL_MAX_H = 460;
const SHELL_DEFAULT_H = 280;

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

function drawWaveformBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  volume: number,
  color: string,
  seed = 42,
) {
  if (w <= 2) return;
  const centerY = y + h / 2;
  const isMuted = volume === 0;

  if (isMuted) {
    ctx.save();
    ctx.strokeStyle = "rgba(150, 150, 150, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x + 4, centerY);
    ctx.lineTo(x + w - 4, centerY);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const barWidth = 2;
  const barGap = 1.5;
  const step = barWidth + barGap;
  const numBars = Math.floor((w - 8) / step);
  const maxBarH = (h - 6) * Math.min(1.4, Math.max(0.25, volume));

  ctx.fillStyle = color;
  for (let i = 0; i < numBars; i++) {
    const bx = x + 4 + i * step;
    const n = Math.sin(i * 0.45 + seed) * 0.35 + Math.cos(i * 0.9 + seed * 2) * 0.25 + 0.4;
    const barH = Math.max(2, Math.min(maxBarH, maxBarH * Math.abs(n)));
    const by = centerY - barH / 2;
    ctx.fillRect(bx, by, barWidth, barH);
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
  const [draggingAudio, setDraggingAudio] = useState<{ id: string; grabOffset: number } | null>(null);
  const [transitionPopover, setTransitionPopover] = useState<{
    x: number;
    y: number;
    targetSegId: string;
    fromSegIdx: number;
    toSegIdx: number;
  } | null>(null);
  const [addPopover, setAddPopover] = useState<boolean>(false);
  const addClipFileRef = useRef<HTMLInputElement>(null);

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
  const setSegmentAudioVolume = useProjectStore((s) => s.setSegmentAudioVolume);
  const setFacecamAudioVolume = useProjectStore((s) => s.setFacecamAudioVolume);
  const setAllSegmentsAudioVolume = useProjectStore((s) => s.setAllSegmentsAudioVolume);
  const selectedZoomId = useProjectStore((s) => s.selectedZoomId);
  const setSelectedZoom = useProjectStore((s) => s.setSelectedZoom);
  const updateZoomPoint = useProjectStore((s) => s.updateZoomPoint);
  const updateAudioTrack = useProjectStore((s) => s.updateAudioTrack);
  const removeZoomPoint = useProjectStore((s) => s.removeZoomPoint);
  const removeStagedZoom = useProjectStore((s) => s.removeStagedZoom);
  const exportProgress = useProjectStore((s) => s.exportProgress);
  const [showSpeed, setShowSpeed] = useState(false);
  const speedHideTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [hoveredVolume, setHoveredVolume] = useState<{
    type: "screen" | "facecam" | "voiceover";
    segmentId: string;
    segmentIndex: number;
    x: number;
    y: number;
    volume: number;
  } | null>(null);
  const volumePopoverTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnterSpeed = () => {
    if (exportProgress !== null) return;
    if (speedHideTimerRef.current) {
      clearTimeout(speedHideTimerRef.current);
      speedHideTimerRef.current = null;
    }
    setShowSpeed(true);
  };

  const handleMouseLeaveSpeed = () => {
    if (speedHideTimerRef.current) clearTimeout(speedHideTimerRef.current);
    speedHideTimerRef.current = setTimeout(() => {
      setShowSpeed(false);
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (speedHideTimerRef.current) clearTimeout(speedHideTimerRef.current);
      if (volumePopoverTimerRef.current) clearTimeout(volumePopoverTimerRef.current);
    };
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    segmentId: string;
    timelineT: number;
  } | null>(null);

  const { getThumbnail, version: thumbVersion } = useTimelineThumbnails(project);

  // On-timeline duration across all segments.
  const duration = project ? Math.max(projectDuration(project), 0.001) : 0.001;

  // Canvas width scales with zoom: 0→0.5×, 1→2× base — ruler uses on-timeline duration
  const baseW = 1387;
  const canvasW = Math.round(baseW * (0.5 + zoom * 1.5));
  const canvasH = 216; // extended to fit the audio lane below the zoom track
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

  // Draw ruler + 5 organized tracks onto canvas (lightweight, no DOM per tick)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? Math.max(1, window.devicePixelRatio || 1) : 1;
    c.width = Math.round(canvasW * dpr);
    c.height = Math.round(canvasH * dpr);
    c.style.width = `${canvasW}px`;
    c.style.height = `${canvasH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Identify active segment under playhead
    const activeSegId = project ? resolveSegment(project, currentTime)?.segment.id : null;

    // ── 1. Ruler bg ──
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, canvasW, 26);
    ctx.fillStyle = "#ebebeb";
    ctx.fillRect(0, 25, canvasW, 1);

    // Ticks — on-timeline duration
    const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
    ctx.strokeStyle = "#d4d4d4";
    ctx.lineWidth = 1;
    for (let t = 0; t <= duration; t += interval) {
      const x = Math.round(timeToX(t));
      const major = t % (interval * 5) === 0 || t === 0;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, major ? 10 : 5);
      ctx.stroke();
    }

    const segments = project?.segments ?? [];

    // ── 2. Video Filmstrip Blocks (Track 1) ──
    let vidAcc = 0;
    for (const seg of segments) {
      const d = segmentDuration(seg);
      const x0 = timeToX(vidAcc);
      const x1 = timeToX(vidAcc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);

      // Clip filmstrip to the rounded segment block
      ctx.save();
      drawRoundRect(ctx, x0, VIDEO_TRACK_Y, segW, VIDEO_TRACK_HEIGHT, 4);
      ctx.clip();

      // Base background
      ctx.fillStyle = "#f0f2f5";
      ctx.fillRect(x0, VIDEO_TRACK_Y, segW, VIDEO_TRACK_HEIGHT);

      // Tile thumbnails across the segment
      const tileH = VIDEO_TRACK_HEIGHT;
      const tileW = 54;
      const numTiles = Math.max(1, Math.ceil(segW / tileW));

      for (let i = 0; i < numTiles; i++) {
        const tx = x0 + i * tileW;
        const currentTileW = Math.min(tileW, x1 - tx);
        if (currentTileW <= 0) continue;

        const progress = Math.max(0, Math.min(1, (tx + currentTileW / 2 - x0) / segW));
        const srcT = seg.srcStart + progress * (seg.srcEnd - seg.srcStart);

        const thumb = getThumbnail(seg.mediaId ?? "m1", srcT);
        if (thumb) {
          ctx.drawImage(thumb, 0, 0, thumb.width, thumb.height, tx, VIDEO_TRACK_Y, currentTileW, tileH);
        } else {
          ctx.fillStyle = i % 2 === 0 ? "#f0f2f5" : "#e8ebed";
          ctx.fillRect(tx, VIDEO_TRACK_Y, currentTileW, tileH);
          if (currentTileW >= 20) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
            ctx.fillRect(tx + 4, VIDEO_TRACK_Y + 4, currentTileW - 8, tileH - 8);
          }
        }

        if (i > 0) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(tx + 0.5, VIDEO_TRACK_Y);
          ctx.lineTo(tx + 0.5, VIDEO_TRACK_Y + tileH);
          ctx.stroke();
        }
      }

      if (selected) {
        ctx.fillStyle = "rgba(0, 112, 243, 0.10)";
        ctx.fillRect(x0, VIDEO_TRACK_Y, segW, VIDEO_TRACK_HEIGHT);
      }

      // Chapter name (C2), drawn over the thumbnails with a scrim so it stays
      // readable on any frame. Skipped when the clip is too narrow to say
      // anything useful.
      if (seg.name && segW >= 56) {
        const padX = 5;
        ctx.font = "500 10px Poppins, system-ui, sans-serif";
        const maxTextW = segW - padX * 2 - 4;
        let label = seg.name;
        if (ctx.measureText(label).width > maxTextW) {
          while (label.length > 1 && ctx.measureText(`${label}…`).width > maxTextW) {
            label = label.slice(0, -1);
          }
          label = `${label}…`;
        }
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        drawRoundRect(ctx, x0 + padX - 3, VIDEO_TRACK_Y + 3, textW + 8, 14, 3);
        ctx.fill();
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x0 + padX + 1, VIDEO_TRACK_Y + 10.5);
      }

      ctx.restore();

      // Outer segment stroke
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 2;
        drawRoundRect(ctx, x0 + 1, VIDEO_TRACK_Y + 1, Math.max(1, segW - 2), VIDEO_TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#d4d4d4";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, VIDEO_TRACK_Y + 0.5, Math.max(1, segW - 1), VIDEO_TRACK_HEIGHT - 1, 4);
        ctx.stroke();
        // Speed badge
        if (seg.speed !== 1) {
          const speedText = `${String(seg.speed).replace(/\.?0$/, "")}x`;
          ctx.font = "700 9.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          const textMetrics = ctx.measureText(speedText);
          const badgeW = textMetrics.width + 8;
          const badgeH = 14;
          const badgeX = x0 + 4;
          const badgeY = VIDEO_TRACK_Y + 4;

          ctx.fillStyle = selected ? "#0070f3" : "rgba(30, 30, 30, 0.85)";
          drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.fillText(speedText, badgeX + 4, badgeY + 10);
        }
      }

      // Split boundary line
      if (vidAcc + d < duration) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, VIDEO_TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      vidAcc += d;
    }

    // ── 2b. Add-clip affordance: dashed zone at the end of the video track ──
    if (project && exportProgress === null) {
      const addX = timeToX(duration);
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "rgba(0, 112, 243, 0.45)";
      ctx.lineWidth = 1;
      drawRoundRect(ctx, addX, VIDEO_TRACK_Y, ADD_CLIP_ZONE_W, VIDEO_TRACK_HEIGHT, 4);
      ctx.stroke();
      ctx.restore();
    }

    // ── 3. Screen Audio Track (Track 2) ──
    let sAudioAcc = 0;
    for (const seg of segments) {
      const d = segmentDuration(seg);
      const x0 = timeToX(sAudioAcc);
      const x1 = timeToX(sAudioAcc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);
      const vol = seg.audioVolume ?? 1;

      ctx.save();
      drawRoundRect(ctx, x0, SCREEN_AUDIO_TRACK_Y, segW, SCREEN_AUDIO_TRACK_HEIGHT, 4);
      ctx.clip();

      // Background
      ctx.fillStyle = selected ? "#f0fdf4" : "#f8fafc";
      ctx.fillRect(x0, SCREEN_AUDIO_TRACK_Y, segW, SCREEN_AUDIO_TRACK_HEIGHT);

      // Waveform Bars (Green)
      const labelW = 24;
      const waveformStartX = x0 + labelW;
      const rightPadding = segW >= 130 ? 62 : 6;
      const waveformW = Math.max(0, x1 - rightPadding - waveformStartX);
      if (waveformW > 8) {
        drawWaveformBars(
          ctx,
          waveformStartX,
          SCREEN_AUDIO_TRACK_Y,
          waveformW,
          SCREEN_AUDIO_TRACK_HEIGHT,
          vol,
          selected ? "#16a34a" : "#22c55e",
          23,
        );
      }

      ctx.restore();

      // Outer stroke
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 1.5;
        drawRoundRect(ctx, x0 + 1, SCREEN_AUDIO_TRACK_Y + 1, Math.max(1, segW - 2), SCREEN_AUDIO_TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, SCREEN_AUDIO_TRACK_Y + 0.5, Math.max(1, segW - 1), SCREEN_AUDIO_TRACK_HEIGHT - 1, 4);
        ctx.stroke();
      }

      // Group split line
      if (sAudioAcc + d < duration) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, SCREEN_AUDIO_TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, SCREEN_AUDIO_TRACK_Y + SCREEN_AUDIO_TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      sAudioAcc += d;
    }

    // ── 4. Dedicated Facecam Video Track (Track 3) ──
    let fcAcc = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const d = segmentDuration(seg);
      const x0 = timeToX(fcAcc);
      const x1 = timeToX(fcAcc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);

      const hasCam = !!seg.facecam.src;

      ctx.save();
      drawRoundRect(ctx, x0, FACECAM_TRACK_Y, segW, FACECAM_TRACK_HEIGHT, 4);
      ctx.clip();

      if (hasCam) {
        ctx.fillStyle = selected ? "#eff6ff" : "#f8fafc";
        ctx.fillRect(x0, FACECAM_TRACK_Y, segW, FACECAM_TRACK_HEIGHT);
      } else {
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(x0, FACECAM_TRACK_Y, segW, FACECAM_TRACK_HEIGHT);
      }
      ctx.restore();

      // Outer stroke for facecam clip
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 1.5;
        drawRoundRect(ctx, x0 + 1, FACECAM_TRACK_Y + 1, Math.max(1, segW - 2), FACECAM_TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, FACECAM_TRACK_Y + 0.5, Math.max(1, segW - 1), FACECAM_TRACK_HEIGHT - 1, 4);
        ctx.stroke();
      }

      // Group split line
      if (fcAcc + d < duration) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, FACECAM_TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, FACECAM_TRACK_Y + FACECAM_TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      fcAcc += d;
    }

    // ── 5. Facecam Mic Audio Track (Track 4) ──
    let fcAudioAcc = 0;
    for (const seg of segments) {
      const d = segmentDuration(seg);
      const x0 = timeToX(fcAudioAcc);
      const x1 = timeToX(fcAudioAcc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);
      const hasCam = !!seg.facecam.src;
      const vol = seg.facecam?.audioVolume ?? 1;

      ctx.save();
      drawRoundRect(ctx, x0, FACECAM_AUDIO_TRACK_Y, segW, FACECAM_AUDIO_TRACK_HEIGHT, 4);
      ctx.clip();

      if (hasCam) {
        ctx.fillStyle = selected ? "#faf5ff" : "#f8fafc";
        ctx.fillRect(x0, FACECAM_AUDIO_TRACK_Y, segW, FACECAM_AUDIO_TRACK_HEIGHT);

        // Waveform Bars (Purple / Mic)
        const labelW = 24;
        const waveformStartX = x0 + labelW;
        const rightPadding = segW >= 130 ? 62 : 6;
        const waveformW = Math.max(0, x1 - rightPadding - waveformStartX);
        if (waveformW > 8) {
          drawWaveformBars(
            ctx,
            waveformStartX,
            FACECAM_AUDIO_TRACK_Y,
            waveformW,
            FACECAM_AUDIO_TRACK_HEIGHT,
            vol,
            selected ? "#9333ea" : "#a855f7",
            79,
          );
        }
      } else {
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(x0, FACECAM_AUDIO_TRACK_Y, segW, FACECAM_AUDIO_TRACK_HEIGHT);
      }
      ctx.restore();

      // Outer stroke
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 1.5;
        drawRoundRect(ctx, x0 + 1, FACECAM_AUDIO_TRACK_Y + 1, Math.max(1, segW - 2), FACECAM_AUDIO_TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, FACECAM_AUDIO_TRACK_Y + 0.5, Math.max(1, segW - 1), FACECAM_AUDIO_TRACK_HEIGHT - 1, 4);
        ctx.stroke();
      }

      // Group split line
      if (fcAudioAcc + d < duration) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, FACECAM_AUDIO_TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, FACECAM_AUDIO_TRACK_Y + FACECAM_AUDIO_TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      fcAudioAcc += d;
    }

    // ── 6. Dedicated Zoom Track (Track 5) ──
    let zoomAcc = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const d = segmentDuration(seg);
      const x0 = timeToX(zoomAcc);
      const x1 = timeToX(zoomAcc + d);
      const segW = Math.max(1, x1 - x0);
      const selected = isPlaying
        ? seg.id === activeSegId
        : (selectedSegmentIds.length > 0 ? selectedSegmentIds.includes(seg.id) : seg.id === selectedSegmentId);

      const allZps = [...seg.zoomPoints, ...seg.stagedZoomPoints];
      const hasZoom = allZps.length > 0;

      ctx.save();
      drawRoundRect(ctx, x0, ZOOM_TRACK_Y, segW, ZOOM_TRACK_HEIGHT, 4);
      ctx.clip();

      if (hasZoom) {
        ctx.fillStyle = selected ? "#eff6ff" : "#f8fafc";
        ctx.fillRect(x0, ZOOM_TRACK_Y, segW, ZOOM_TRACK_HEIGHT);
      } else {
        ctx.fillStyle = "#fafafa";
        ctx.fillRect(x0, ZOOM_TRACK_Y, segW, ZOOM_TRACK_HEIGHT);
      }

      ctx.restore();

      // Outer stroke for zoom track segment
      if (selected) {
        ctx.strokeStyle = "#0070f3";
        ctx.lineWidth = 1.5;
        drawRoundRect(ctx, x0 + 1, ZOOM_TRACK_Y + 1, Math.max(1, segW - 2), ZOOM_TRACK_HEIGHT - 2, 4);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#e2e8f0";
        ctx.lineWidth = 1;
        drawRoundRect(ctx, x0 + 0.5, ZOOM_TRACK_Y + 0.5, Math.max(1, segW - 1), ZOOM_TRACK_HEIGHT - 1, 4);
        ctx.stroke();
      }

      // Group split line extending down
      if (zoomAcc + d < duration) {
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, ZOOM_TRACK_Y - 2);
        ctx.lineTo(x1 + 0.5, ZOOM_TRACK_Y + ZOOM_TRACK_HEIGHT + 2);
        ctx.stroke();
      }

      zoomAcc += d;
    }

    // ── 6b. Zoom Diamonds & Subtle Purple Affected Zone on Zoom Track ──
    for (const seg of segments) {
      for (const zp of [...seg.zoomPoints, ...seg.stagedZoomPoints]) {
        const st = sourceToTimeline(project!, seg.id, zp.t);
        if (st == null) continue;
        const x = timeToX(st);
        const y = ZOOM_TRACK_Y + ZOOM_TRACK_HEIGHT / 2;
        const staged = !!seg.stagedZoomPoints.find((s) => s.id === zp.id);
        const selected = zp.id === selectedZoomId;

        // Calculate total affected window (zoom in + hold + zoom out)
        const dur = Math.max(zp.dur ?? 0.45, 0.05);
        const hold = zp.hold ?? 2.0;
        const totalDur = (dur * 2 + hold) / Math.max(0.1, seg.speed);
        const endHoldT = Math.min(duration, st + totalDur);
        const endHoldX = timeToX(endHoldT);
        const spanW = Math.max(14, endHoldX - x);

        // 1. Draw subtle purple affected zone background capsule
        ctx.save();
        if (staged) {
          ctx.fillStyle = "rgba(245, 166, 35, 0.18)";
          ctx.strokeStyle = "rgba(245, 166, 35, 0.6)";
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
        } else if (selected) {
          const grad = ctx.createLinearGradient(x, ZOOM_TRACK_Y + 3, x, ZOOM_TRACK_Y + ZOOM_TRACK_HEIGHT - 3);
          grad.addColorStop(0, "rgba(168, 85, 247, 0.32)");
          grad.addColorStop(1, "rgba(147, 51, 234, 0.20)");
          ctx.fillStyle = grad;
          ctx.strokeStyle = "#9333ea";
          ctx.lineWidth = 1.5;
        } else {
          const grad = ctx.createLinearGradient(x, ZOOM_TRACK_Y + 3, x, ZOOM_TRACK_Y + ZOOM_TRACK_HEIGHT - 3);
          grad.addColorStop(0, "rgba(168, 85, 247, 0.18)");
          grad.addColorStop(1, "rgba(147, 51, 234, 0.10)");
          ctx.fillStyle = grad;
          ctx.strokeStyle = "rgba(168, 85, 247, 0.42)";
          ctx.lineWidth = 1;
        }

        drawRoundRect(ctx, x, ZOOM_TRACK_Y + 3, spanW, ZOOM_TRACK_HEIGHT - 6, 4);
        ctx.fill();
        ctx.stroke();

        // 2. Draw zoom factor badge inside affected zone if wide enough
        if (spanW >= 36) {
          const scaleVal = zp.to?.scale ?? 2;
          const scaleText = `${scaleVal.toFixed(1)}×`;
          ctx.font = "700 9.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          ctx.fillStyle = staged ? "#b45309" : selected ? "#6b21a8" : "#7e22ce";
          ctx.fillText(scaleText, x + DIAMOND_SIZE / 2 + 4, ZOOM_TRACK_Y + 16);
        }
        ctx.restore();

        // 3. Zoom Diamond Marker
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = staged ? "#ffefcf" : selected ? "#9333ea" : "#a855f7";
        ctx.strokeStyle = staged ? "#f5a623" : selected ? "#581c87" : "#7e22ce";
        ctx.lineWidth = selected ? 2 : 1.2;
        if (staged) ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.rect(-DIAMOND_SIZE / 2, -DIAMOND_SIZE / 2, DIAMOND_SIZE, DIAMOND_SIZE);
        ctx.fill();
        ctx.stroke();

        // Inner white dot for selected diamond
        if (selected) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-1.5, -1.5, 3, 3);
        }

        ctx.restore();
      }
    }

    // ── 7. Audio Track Lane (music/voiceover, wall-clock) ──
    drawAudioTracks(ctx, project?.audioTracks ?? [], timeToX, AUDIO_TRACK_Y, AUDIO_LANE_HEIGHT);
  }, [canvasW, canvasH, duration, project, selectedSegmentId, selectedSegmentIds, selectedZoomId, thumbVersion, getThumbnail, timeToX, currentTime, isPlaying, exportProgress]);

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
    selectSegment(home.id);
    updateZoomPoint(draggingDiamond.id, { t: srcT });
  }, [draggingDiamond, project, selectSegment, updateZoomPoint, xToTime]);

  const handleTimelinePointerDown = useCallback((e: React.PointerEvent) => {
    if (contextMenu) setContextMenu(null);
    if (!scrollRef.current || draggingDiamond) return;
    const target = e.target as HTMLElement;
    if (target.closest('#facecam-transition-popover, #timeline-context-menu, #timeline-volume-popover, input, button')) {
      return;
    }
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

    // If near playhead (20px) or on canvas, drag playhead; otherwise seek and start dragging
    if (Math.abs(x - px) < 20 || target.closest('.playhead, .timeline-canvas')) {
      setIsDraggingPlayhead(true);
      target.setPointerCapture?.(e.pointerId);
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

  const handleAudioTrackDrag = useCallback((e: React.PointerEvent) => {
    if (!draggingAudio || !scrollRef.current) return;
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    updateAudioTrack(draggingAudio.id, { startT: Math.max(0, xToTime(x) - draggingAudio.grabOffset) });
  }, [draggingAudio, updateAudioTrack, xToTime]);

  const handleAudioTrackDown = useCallback((e: React.PointerEvent, track: { id: string; startT: number }) => {
    e.stopPropagation();
    if (!scrollRef.current) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = scrollRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollRef.current.scrollLeft;
    setDraggingAudio({ id: track.id, grabOffset: xToTime(x) - track.startT });
  }, [xToTime]);

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
      if (target?.closest("#timeline-context-menu") || target?.closest("#facecam-transition-popover") || target?.closest("#add-clip-popover")) return;
      setContextMenu(null);
      setTransitionPopover(null);
      setAddPopover(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null);
        setTransitionPopover(null);
        setAddPopover(false);
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
          <button
            className="pk-icon-btn ctrl-btn h-8 w-8"
            title="Adjust Facecam Mic Volume"
            onClick={() => {
              const activeSeg = project.segments.find((s) => s.id === selectedSegmentId) || project.segments[0];
              if (!activeSeg) return;
              const segIdx = project.segments.findIndex((s) => s.id === activeSeg.id);
              setHoveredVolume({
                type: "facecam",
                segmentId: activeSeg.id,
                segmentIndex: Math.max(0, segIdx),
                x: Math.min(canvasW - 252, Math.max(10, timeToX(currentTime) - 120)),
                y: FACECAM_AUDIO_TRACK_Y,
                volume: activeSeg.facecam?.audioVolume ?? 1,
              });
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <div className="ctrl-divider mx-1 h-4 w-px bg-[#ebebeb]" />
          <button
            className="pk-icon-btn ctrl-btn h-8 w-8"
            title="Adjust Screen Audio Volume"
            onClick={() => {
              const activeSeg = project.segments.find((s) => s.id === selectedSegmentId) || project.segments[0];
              if (!activeSeg) return;
              const segIdx = project.segments.findIndex((s) => s.id === activeSeg.id);
              setHoveredVolume({
                type: "screen",
                segmentId: activeSeg.id,
                segmentIndex: Math.max(0, segIdx),
                x: Math.min(canvasW - 252, Math.max(10, timeToX(currentTime) - 120)),
                y: SCREEN_AUDIO_TRACK_Y,
                volume: activeSeg.audioVolume ?? 1,
              });
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
          </button>
          <button
            className="pk-icon-btn ctrl-btn h-8 w-8"
            title="Adjust Voiceover Volume"
            onClick={() => {
              const tracks = project.audioTracks?.filter((t) => t.kind === "voiceover") ?? [];
              if (tracks.length === 0) {
                alert("No voiceover track yet. Record one in the Audio panel.");
                return;
              }
              const track = tracks[tracks.length - 1]!;
              setHoveredVolume({
                type: "voiceover",
                segmentId: track.id,
                segmentIndex: 0,
                x: Math.min(canvasW - 252, Math.max(10, timeToX(currentTime) - 120)),
                y: AUDIO_TRACK_Y,
                volume: track.volume,
              });
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10a7 7 0 0 1-14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Split at playhead" disabled={exportProgress !== null} onClick={() => splitAt(currentTime)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="6.5" height="14" rx="1.5" /><rect x="14.5" y="5" width="6.5" height="14" rx="1.5" /><line x1="12" y1="3" x2="12" y2="21" strokeDasharray="2.5 2" strokeWidth="1.6" /></svg></button>
          <button className="pk-icon-btn ctrl-btn h-8 w-8" title="Mosaic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg></button>
          <div
            className="relative"
            onMouseEnter={handleMouseEnterSpeed}
            onMouseLeave={handleMouseLeaveSpeed}
          >
            <button
              className="pk-icon-btn ctrl-btn h-8 w-8 relative"
              title={`Speed ${segSpeed}x`}
              disabled={!canSpeed}
              onClick={() => {
                if (!canSpeed) return;
                if (speedHideTimerRef.current) clearTimeout(speedHideTimerRef.current);
                setShowSpeed((s) => !s);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {segSpeed !== 1 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-[#0070f3] px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                  {segSpeed}x
                </span>
              )}
            </button>
            {showSpeed && exportProgress === null && (
              <div
                className="absolute bottom-full left-1/2 z-30 pb-2 -translate-x-1/2"
                onMouseEnter={handleMouseEnterSpeed}
                onMouseLeave={handleMouseLeaveSpeed}
              >
                <div
                  className="flex flex-col items-center gap-1.5 rounded-xl border bg-white p-2 shadow-vercel-3 animate-in fade-in zoom-in-95 duration-100"
                  style={{ borderColor: "#ebebeb", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
                >
                  <div className="flex gap-1">
                    {[0.5, 1, 1.5, 2, 3].map((v) => (
                      <button
                        key={v}
                        onClick={() => {
                          if (selectedSegmentId) updateSegment(selectedSegmentId, { speed: v });
                        }}
                        className="pk-seg min-w-[44px] text-xs"
                        data-active={segSpeed === v}
                      >
                        {v}x
                      </button>
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
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="9 14 4 9 9 4" />
                              <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                            </svg>
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
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="15 14 20 9 15 4" />
                              <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                            </svg>
                            <span>Next ({nextSeg.speed}x)</span>
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
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
        onPointerMove={(e) => { handleDiamondDrag(e); handleTimelinePointerMove(e); handleAudioTrackDrag(e); }}
        onPointerUp={() => { setDraggingDiamond(null); setIsDraggingPlayhead(false); setDraggingAudio(null); }}
        onPointerLeave={() => setIsDraggingPlayhead(false)}
      >
        <div className="relative" style={{ width: canvasW, height: canvasH }}>
          <canvas ref={canvasRef} className="timeline-canvas block" style={{ width: canvasW, height: canvasH }} />
          {/* Ruler Timestamps DOM Overlay (Vector-sharp, non-blurry) */}
          {(() => {
            const interval = duration <= 30 ? 1 : duration <= 120 ? 5 : 10;
            const majorInterval = interval * 5;
            const ticks: { t: number; label: string; x: number }[] = [];
            for (let t = 0; t <= duration; t += interval) {
              if (t % majorInterval === 0 || t === 0) {
                const label = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
                ticks.push({ t, label, x: timeToX(t) });
              }
            }
            return ticks.map((tk) => (
              <span
                key={`ruler-tk-${tk.t}`}
                className="pointer-events-none absolute top-1.5 select-none font-mono text-[10px] font-semibold text-[#64748b]"
                style={{ left: tk.x + 4 }}
              >
                {tk.label}
              </span>
            ));
          })()}
          {/* Playhead — draggable with grab cursor */}
          <div className={`playhead absolute top-0 z-20 h-full ${isDraggingPlayhead ? "cursor-grabbing" : "cursor-grab"}`} style={{ transform: `translateX(${playheadX}px)` }} onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setIsDraggingPlayhead(true); }}>
            <div className="pointer-events-none absolute left-1/2 h-full w-px -translate-x-1/2 bg-[#0070f3]" />
            <div className="playhead-marker pointer-events-none absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-[#0070f3] shadow-sm" />
            {/* Hit area */}
            <div className="absolute -left-3 top-0 h-full w-6" />
          </div>
          {/* End line */}
          <div className="end-line pointer-events-none absolute top-0 h-full w-px" style={{ transform: `translateX(${endX}px)`, borderLeft: "1px solid rgba(0,0,0,0.08)" }} />
          {/* Add-clip affordance: "+" at the end of the video filmstrip */}
          {exportProgress === null && (
            <>
              <button
                className="absolute z-20 flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[#0070f3]/40 bg-white text-[#0070f3] shadow-sm transition-colors hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                style={{ left: timeToX(duration) + 6, top: VIDEO_TRACK_Y + 3 }}
                title="Add clip"
                onClick={(e) => {
                  e.stopPropagation();
                  setAddPopover((v) => !v);
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              </button>
              <input
                ref={addClipFileRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setAddPopover(false);
                  try {
                    // importClip reads metadata only — the playing clip's
                    // pipeline and every project blob URL stay alive.
                    const { media, segment } = await engine.importClip(file);
                    useProjectStore.getState().appendClip(media, segment);
                    // Park the playhead at the new end so the appended clip is
                    // what appears in the preview.
                    const newEnd = useProjectStore
                      .getState()
                      .project!.segments.reduce((a, s) => a + segmentDuration(s), 0);
                    useProjectStore.getState().seek(newEnd);
                  } catch (err) {
                    console.error("import failed", err);
                  }
                }}
              />
              {addPopover && (
                <div
                  id="add-clip-popover"
                  className="absolute z-30 flex w-44 flex-col rounded-xl border bg-white p-1.5"
                  style={{ left: timeToX(duration) + 14, top: VIDEO_TRACK_Y + VIDEO_TRACK_HEIGHT + 10, borderColor: "#ebebeb", boxShadow: "0 8px 24px rgba(0,0,0,0.12)" }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <button
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#333] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                    onClick={() => {
                      setAddPopover(false);
                      addClipFileRef.current?.click();
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                    Import video file
                  </button>
                  <button
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#333] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                    onClick={() => {
                      setAddPopover(false);
                      window.dispatchEvent(new CustomEvent("open-record-modal", { detail: { append: true } }));
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                    Record take
                  </button>
                  <span className="mt-1 border-t pt-1.5 text-center text-[10px] text-[#999]" style={{ borderTopColor: "#ebebeb" }}>Appends to end of timeline</span>
                </div>
              )}
            </>
          )}
          {/* Diamond hit areas on Dedicated Zoom Track (transparent, for dragging) */}
          {project.segments.flatMap((seg) =>
            [...seg.zoomPoints, ...seg.stagedZoomPoints].map((zp) => {
              const st = sourceToTimeline(project, seg.id, zp.t);
              if (st == null) return null;
              const isStaged = !!seg.stagedZoomPoints.find((s) => s.id === zp.id);
              return (
                <div
                  key={zp.id}
                  className="absolute z-10 flex h-[26px] w-6 -translate-x-1/2 cursor-grab items-center justify-center"
                  style={{ top: ZOOM_TRACK_Y, left: timeToX(st) }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    (e.target as HTMLElement).setPointerCapture(e.pointerId);
                    setDraggingDiamond({ id: zp.id, committed: !isStaged, segmentId: seg.id });
                    setSelectedZoom(zp.id);
                    selectSegment(seg.id);
                  }}
                  onMouseEnter={() => setHoveredDiamond(zp.id)}
                  onMouseLeave={() => setHoveredDiamond(null)}
                >
                  {hoveredDiamond === zp.id && (
                    <button
                      className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[#ee0000] text-[8px] font-bold text-white shadow-sm hover:scale-110 active:scale-95 transition-all"
                      title="Delete zoom keyframe"
                      onClick={(e) => {
                        e.stopPropagation();
                        isStaged ? removeStagedZoom(zp.id) : removeZoomPoint(zp.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            }),
          )}

          {/* Audio Track lane — invisible draggable hit-divs over the canvas-drawn blocks */}
          {(project.audioTracks ?? []).map((track) => {
            const { left, width } = audioBlockGeometry(track, timeToX);
            return (
              <div
                key={`audio-hit-${track.id}`}
                className="absolute z-10 cursor-grab active:cursor-grabbing"
                style={{ top: AUDIO_TRACK_Y, left, width, height: AUDIO_LANE_HEIGHT }}
                onPointerDown={(e) => handleAudioTrackDown(e, track)}
                title={`${track.name ?? track.kind} — drag to move`}
              />
            );
          })}

          {/* Facecam Transition Interactive Nodes in between clips */}
          {(() => {
            let trAcc = 0;
            return project.segments.slice(0, -1).map((seg, i) => {
              const nextSeg = project.segments[i + 1]!;
              trAcc += segmentDuration(seg);
              const splitX = timeToX(trAcc);
              const transType = nextSeg.facecam.transition ?? "smooth";

              return (
                <button
                  key={`trans-pill-${seg.id}-${nextSeg.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    selectSegment(nextSeg.id, false);
                    setTransitionPopover({
                      x: Math.min(canvasW - 220, Math.max(10, splitX - 100)),
                      y: FACECAM_TRACK_Y,
                      targetSegId: nextSeg.id,
                      fromSegIdx: i + 1,
                      toSegIdx: i + 2,
                    });
                  }}
                  title={`Facecam Transition: ${transType} (${(nextSeg.facecam.transitionDuration ?? 0.45).toFixed(2)}s). Click to customize.`}
                  className="absolute z-20 flex h-[20px] w-[24px] -translate-x-1/2 items-center justify-center rounded-md border border-[#cbd5e1] bg-white text-[#475569] shadow-sm hover:border-[#0070f3] hover:text-[#0070f3] hover:scale-110 active:scale-95 transition-all cursor-pointer"
                  style={{ left: splitX, top: FACECAM_TRACK_Y + (FACECAM_TRACK_HEIGHT - 20) / 2 }}
                >
                  <span className="flex items-center justify-center scale-90">
                    {TRANSITION_ICONS[transType] ?? TRANSITION_ICONS.smooth}
                  </span>
                </button>
              );
            });
          })()}

          {/* Inline Facecam Transition Popover */}
          {transitionPopover && (
            <div
              id="facecam-transition-popover"
              className="absolute z-40 w-[240px] rounded-2xl border bg-white p-3 shadow-vercel-4 animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: transitionPopover.x,
                top: Math.max(10, FACECAM_TRACK_Y - 155),
                borderColor: "#ebebeb",
                boxShadow: "0 12px 36px rgba(0,0,0,0.18)",
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-[#111]">
                    Facecam Transition
                  </span>
                  <span className="rounded bg-[#f0f7ff] px-1.5 py-0.2 text-[10px] font-semibold text-[#0070f3]">
                    Seg {transitionPopover.fromSegIdx} ➔ {transitionPopover.toSegIdx}
                  </span>
                </div>
                <button
                  onClick={() => setTransitionPopover(null)}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-xs text-[#888] hover:bg-[#f5f5f5]"
                >
                  ×
                </button>
              </div>

              <div className="space-y-1">
                {[
                  { id: "smooth", name: "Smooth Float" },
                  { id: "spring", name: "Spring Pop" },
                  { id: "fade", name: "Crossfade" },
                  { id: "slide", name: "Corner Slide" },
                  { id: "cut", name: "Instant Cut" },
                ].map((t) => {
                  const targetSeg = project.segments.find((s) => s.id === transitionPopover.targetSegId);
                  const currentType = targetSeg?.facecam.transition ?? "smooth";
                  const active = currentType === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        updateSegment(transitionPopover.targetSegId, {
                          facecam: {
                            ...(targetSeg?.facecam ?? { x: 0.8, y: 0.8, size: 0.22, src: null }),
                            transition: t.id as any,
                          },
                        });
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                        active ? "bg-[#f0f7ff] text-[#0070f3] font-semibold" : "text-[#333] hover:bg-[#f5f5f5]"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`flex h-5 w-5 items-center justify-center rounded ${
                          active ? "text-[#0070f3]" : "text-[#666]"
                        }`}>
                          {TRANSITION_ICONS[t.id]}
                        </span>
                        <span>{t.name}</span>
                      </span>
                      {active && <span className="text-[11px]">✓</span>}
                    </button>
                  );
                })}
              </div>

              {/* Duration slider */}
              {(() => {
                const targetSeg = project.segments.find((s) => s.id === transitionPopover.targetSegId);
                const dur = targetSeg?.facecam.transitionDuration ?? 0.45;
                const setDuration = (val: number) => {
                  updateSegment(transitionPopover.targetSegId, {
                    facecam: {
                      ...(targetSeg?.facecam ?? { x: 0.8, y: 0.8, size: 0.22, src: null }),
                      transitionDuration: Math.max(0.05, Math.min(1.0, Number(val.toFixed(2)))),
                    },
                  });
                };

                return (
                  <div className="mt-2 border-t border-[#f0f0f0] pt-2">
                    <div className="mb-1.5 flex items-center justify-between text-[11px]">
                      <span className="text-[#666]">Transition Duration</span>
                      <span className="font-mono font-bold text-[#0070f3]">{dur.toFixed(2)}s</span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.05}
                      value={dur}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="pk-range w-full"
                    />
                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      {[
                        { label: "0.2s", val: 0.2 },
                        { label: "0.45s", val: 0.45 },
                        { label: "0.8s", val: 0.8 },
                      ].map((p) => (
                        <button
                          key={p.val}
                          onClick={() => setDuration(p.val)}
                          className={`flex-1 rounded-md border py-0.5 text-[10px] font-medium transition-all ${
                            Math.abs(dur - p.val) < 0.03
                              ? "border-[#0070f3] bg-[#f0f7ff] font-bold text-[#0070f3]"
                              : "border-[#e5e5e5] bg-[#fafafa] text-[#666] hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Screen Audio Track DOM Overlays (Speaker Button + Crisp Text Badge + Volume Pill) */}
          {(() => {
            let sAcc = 0;
            return project.segments.map((seg, idx) => {
              const d = segmentDuration(seg);
              const segX0 = timeToX(sAcc);
              const segX1 = timeToX(sAcc + d);
              const segW = Math.max(1, segX1 - segX0);
              sAcc += d;
              const vol = seg.audioVolume ?? 1;
              const isMuted = vol === 0;
              const labelText = segW >= 110 ? "SCREEN AUDIO" : segW >= 65 ? "AUDIO" : null;

              return (
                <div
                  key={`screen-audio-dom-${seg.id}`}
                  className="pointer-events-none absolute z-20 flex items-center justify-between"
                  style={{
                    left: segX0 + 3,
                    top: SCREEN_AUDIO_TRACK_Y + 3,
                    width: Math.max(0, segW - 6),
                    height: 18,
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSegmentAudioVolume(seg.id, isMuted ? 1.0 : 0);
                      }}
                      onMouseEnter={() => {
                        if (volumePopoverTimerRef.current) {
                          clearTimeout(volumePopoverTimerRef.current);
                          volumePopoverTimerRef.current = null;
                        }
                        setHoveredVolume({
                          type: "screen",
                          segmentId: seg.id,
                          segmentIndex: idx,
                          x: Math.min(canvasW - 195, Math.max(10, segX0)),
                          y: SCREEN_AUDIO_TRACK_Y,
                          volume: vol,
                        });
                      }}
                      onMouseLeave={() => {
                        if (volumePopoverTimerRef.current) clearTimeout(volumePopoverTimerRef.current);
                        volumePopoverTimerRef.current = setTimeout(() => setHoveredVolume(null), 300);
                      }}
                      className={`pointer-events-auto flex h-[18px] w-[18px] items-center justify-center rounded transition-all cursor-pointer shadow-xs ${
                        isMuted
                          ? "bg-[#fee2e2] text-[#dc2626] border border-[#fca5a5]"
                          : "bg-white text-[#16a34a] border border-[#dcfce7] hover:border-[#16a34a] hover:bg-[#f0fdf4]"
                      }`}
                      title={isMuted ? "Unmute Screen Audio" : `Screen Audio (${Math.round(vol * 100)}%)`}
                    >
                      {isMuted ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23" />
                          <path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </button>
                    {labelText && (
                      <span className="select-none rounded border border-[#e2e8f0] bg-white/95 px-1.5 py-0.5 text-[9.5px] font-bold tracking-tight text-black shadow-2xs font-mono">
                        {labelText}
                      </span>
                    )}
                  </div>
                  {segW >= 130 && (
                    <span
                      className={`select-none rounded px-1.5 py-0.5 text-[9.5px] font-bold font-mono shadow-2xs ${
                        isMuted
                          ? "bg-[#fee2e2] text-[#dc2626] border border-[#fca5a5]"
                          : "bg-[#dcfce7] text-[#16a34a] border border-[#bbf7d0]"
                      }`}
                    >
                      {isMuted ? "MUTED" : `${Math.round(vol * 100)}%`}
                    </span>
                  )}
                </div>
              );
            });
          })()}

          {/* Facecam Track DOM Overlays (Position Badge) */}
          {(() => {
            let fcAcc = 0;
            return project.segments.map((seg) => {
              const d = segmentDuration(seg);
              const segX0 = timeToX(fcAcc);
              const segX1 = timeToX(fcAcc + d);
              const segW = Math.max(1, segX1 - segX0);
              fcAcc += d;
              if (!seg.facecam.src) {
                if (segW > 50) {
                  return (
                    <div
                      key={`fc-badge-${seg.id}`}
                      className="pointer-events-none absolute z-20 flex items-center"
                      style={{ left: segX0 + 6, top: FACECAM_TRACK_Y + 3, height: 18 }}
                    >
                      <span className="select-none text-[9.5px] font-bold text-[#94a3b8] font-mono">NO CAM</span>
                    </div>
                  );
                }
                return null;
              }

              const hFrac = (seg.facecam.size * (project?.media?.[0]?.width ?? 1920) / (project?.media?.[0]?.height ?? 1080)) / (16 / 9);
              const { preset } = getClosestGridPreset(seg.facecam.x, seg.facecam.y, seg.facecam.size, hFrac);
              const positionText = preset.code;
              const shapeIcon = seg.facecam.shape === "circle" ? "●" : "■";

              return (
                <div
                  key={`fc-badge-${seg.id}`}
                  className="pointer-events-none absolute z-20 flex items-center gap-1.5"
                  style={{ left: segX0 + 4, top: FACECAM_TRACK_Y + 3, height: 18 }}
                >
                  {segW >= 42 && (
                    <div className="grid grid-cols-3 gap-0.5 p-0.5 rounded bg-black/5">
                      {[0, 1, 2].map((r) =>
                        [0, 1, 2].map((c) => (
                          <div
                            key={`cell-${r}-${c}`}
                            className={`h-[2.5px] w-[2.5px] rounded-xs ${
                              r === preset.row && c === preset.col ? "bg-[#0070f3]" : "bg-black/20"
                            }`}
                          />
                        ))
                      )}
                    </div>
                  )}
                  <span className="select-none rounded border border-[#e2e8f0] bg-white/95 px-1.5 py-0.5 text-[9.5px] font-bold tracking-tight text-black shadow-2xs font-mono">
                    {segW > 74 ? `CAM · ${positionText} ${shapeIcon}` : segW > 32 ? positionText : "CAM"}
                  </span>
                </div>
              );
            });
          })()}

          {/* Facecam Mic Audio Track DOM Overlays (Speaker Button + Crisp Text Badge + Volume Pill) */}
          {(() => {
            let fcAcc = 0;
            return project.segments.map((seg, idx) => {
              const d = segmentDuration(seg);
              const segX0 = timeToX(fcAcc);
              const segX1 = timeToX(fcAcc + d);
              const segW = Math.max(1, segX1 - segX0);
              fcAcc += d;
              if (!seg.facecam.src) {
                if (segW > 50) {
                  return (
                    <div
                      key={`fc-mic-badge-${seg.id}`}
                      className="pointer-events-none absolute z-20 flex items-center"
                      style={{ left: segX0 + 6, top: FACECAM_AUDIO_TRACK_Y + 3, height: 18 }}
                    >
                      <span className="select-none text-[9.5px] font-bold text-[#94a3b8] font-mono">NO MIC</span>
                    </div>
                  );
                }
                return null;
              }

              const vol = seg.facecam?.audioVolume ?? 1;
              const isMuted = vol === 0;
              const labelText = segW >= 95 ? "CAM MIC" : segW >= 55 ? "MIC" : null;

              return (
                <div
                  key={`fc-mic-dom-${seg.id}`}
                  className="pointer-events-none absolute z-20 flex items-center justify-between"
                  style={{
                    left: segX0 + 3,
                    top: FACECAM_AUDIO_TRACK_Y + 3,
                    width: Math.max(0, segW - 6),
                    height: 18,
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFacecamAudioVolume(seg.id, isMuted ? 1.0 : 0);
                      }}
                      onMouseEnter={() => {
                        if (volumePopoverTimerRef.current) {
                          clearTimeout(volumePopoverTimerRef.current);
                          volumePopoverTimerRef.current = null;
                        }
                        setHoveredVolume({
                          type: "facecam",
                          segmentId: seg.id,
                          segmentIndex: idx,
                          x: Math.min(canvasW - 195, Math.max(10, segX0)),
                          y: FACECAM_AUDIO_TRACK_Y,
                          volume: vol,
                        });
                      }}
                      onMouseLeave={() => {
                        if (volumePopoverTimerRef.current) clearTimeout(volumePopoverTimerRef.current);
                        volumePopoverTimerRef.current = setTimeout(() => setHoveredVolume(null), 300);
                      }}
                      className={`pointer-events-auto flex h-[18px] w-[18px] items-center justify-center rounded transition-all cursor-pointer shadow-xs ${
                        isMuted
                          ? "bg-[#fee2e2] text-[#dc2626] border border-[#fca5a5]"
                          : "bg-white text-[#9333ea] border border-[#f3e8ff] hover:border-[#9333ea] hover:bg-[#faf5ff]"
                      }`}
                      title={isMuted ? "Unmute Cam Mic" : `Cam Mic (${Math.round(vol * 100)}%)`}
                    >
                      {isMuted ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="1" y1="1" x2="23" y2="23" />
                          <path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        </svg>
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </button>
                    {labelText && (
                      <span className="select-none rounded border border-[#e2e8f0] bg-white/95 px-1.5 py-0.5 text-[9.5px] font-bold tracking-tight text-black shadow-2xs font-mono">
                        {labelText}
                      </span>
                    )}
                  </div>
                  {segW >= 130 && (
                    <span
                      className={`select-none rounded px-1.5 py-0.5 text-[9.5px] font-bold font-mono shadow-2xs ${
                        isMuted
                          ? "bg-[#fee2e2] text-[#dc2626] border border-[#fca5a5]"
                          : "bg-[#f3e8ff] text-[#7e22ce] border border-[#e9d5ff]"
                      }`}
                    >
                      {isMuted ? "MUTED" : `${Math.round(vol * 100)}%`}
                    </span>
                  )}
                </div>
              );
            });
          })()}

          {/* Dedicated Zoom Track DOM Overlays (Zoom Badge) */}
          {(() => {
            let zoomAcc = 0;
            return project.segments.map((seg) => {
              const d = segmentDuration(seg);
              const segX0 = timeToX(zoomAcc);
              const segX1 = timeToX(zoomAcc + d);
              const segW = Math.max(1, segX1 - segX0);
              zoomAcc += d;
              const allZps = [...seg.zoomPoints, ...seg.stagedZoomPoints];
              const hasZoom = allZps.length > 0;
              if (!hasZoom) {
                if (segW > 45) {
                  return (
                    <div
                      key={`zoom-badge-${seg.id}`}
                      className="pointer-events-none absolute z-20 flex items-center"
                      style={{ left: segX0 + 6, top: ZOOM_TRACK_Y + 3, height: 18 }}
                    >
                      <span className="select-none text-[9.5px] font-bold text-[#94a3b8] font-mono">ZOOM</span>
                    </div>
                  );
                }
                return null;
              }

              return (
                <div
                  key={`zoom-badge-${seg.id}`}
                  className="pointer-events-none absolute z-20 flex items-center"
                  style={{ left: segX0 + 4, top: ZOOM_TRACK_Y + 3, height: 18 }}
                >
                  <span className="select-none rounded border border-[#e2e8f0] bg-white/95 px-1.5 py-0.5 text-[9.5px] font-bold tracking-tight text-black shadow-2xs font-mono">
                    {segW > 70 ? `ZOOM (${allZps.length})` : "ZOOM"}
                  </span>
                </div>
              );
            });
          })()}

          {/* Thin Volume Control Popover (NO EMOJIS) */}
          {hoveredVolume && (
            <div
              id="timeline-volume-popover"
              className="absolute z-40 w-[185px] rounded-xl border bg-white p-2.5 shadow-vercel-4 animate-in fade-in zoom-in-95 duration-100"
              style={{
                left: hoveredVolume.x,
                top: Math.max(6, hoveredVolume.y - 96),
                borderColor: "#e5e7eb",
                boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
              }}
              onMouseEnter={() => {
                if (volumePopoverTimerRef.current) {
                  clearTimeout(volumePopoverTimerRef.current);
                  volumePopoverTimerRef.current = null;
                }
              }}
              onMouseLeave={() => {
                if (volumePopoverTimerRef.current) clearTimeout(volumePopoverTimerRef.current);
                volumePopoverTimerRef.current = setTimeout(() => {
                  setHoveredVolume(null);
                }, 300);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {(() => {
                const isScreen = hoveredVolume.type === "screen";
                const isVoiceover = hoveredVolume.type === "voiceover";
                const seg = !isVoiceover ? project.segments.find((s) => s.id === hoveredVolume.segmentId) : null;
                const track = isVoiceover ? project.audioTracks?.find((t) => t.id === hoveredVolume.segmentId) : null;
                const currentVol = isVoiceover ? (track?.volume ?? 1) : isScreen ? (seg?.audioVolume ?? 1) : (seg?.facecam?.audioVolume ?? 1);

                const applyVol = (val: number) => {
                  const clamped = Math.max(0, Math.min(2.0, Number(val.toFixed(2))));
                  if (isVoiceover) {
                    updateAudioTrack(hoveredVolume.segmentId, { volume: clamped });
                  } else if (isScreen) {
                    setSegmentAudioVolume(hoveredVolume.segmentId, clamped);
                  } else {
                    setFacecamAudioVolume(hoveredVolume.segmentId, clamped);
                  }
                  setHoveredVolume((h) => (h ? { ...h, volume: clamped } : null));
                };

                return (
                  <div className="flex flex-col gap-2">
                    {/* Header */}
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-[#111827]">
                          {isVoiceover ? "Voiceover" : isScreen ? "Screen Audio" : "Cam Mic"}
                        </span>
                        <span className="rounded bg-[#f3f4f6] px-1 py-0.2 text-[9.5px] font-medium text-[#4b5563]">
                          {isVoiceover ? (track?.name ?? "Voiceover") : `Clip ${hoveredVolume.segmentIndex + 1}`}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] font-bold text-[#0070f3]">
                        {Math.round(currentVol * 100)}%
                      </span>
                    </div>

                    {/* Slider Row */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => applyVol(currentVol === 0 ? 1.0 : 0)}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${
                          currentVol === 0
                            ? "border-[#fca5a5] bg-[#fef2f2] text-[#dc2626]"
                            : "border-[#e5e7eb] bg-[#f9fafb] text-[#4b5563] hover:border-[#0070f3] hover:text-[#0070f3]"
                        }`}
                        title={currentVol === 0 ? "Unmute" : "Mute"}
                      >
                        {currentVol === 0 ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="1" y1="1" x2="23" y2="23" />
                            <path d="M9 9v6a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                          </svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                          </svg>
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={2.0}
                        step={0.05}
                        value={currentVol}
                        onChange={(e) => applyVol(Number(e.target.value))}
                        className="pk-range flex-1"
                      />
                    </div>

                    {/* Apply to all segments option — not for voiceover */}
                    {!isVoiceover && project.segments.length > 1 && (
                      <button
                        onClick={() => setAllSegmentsAudioVolume(hoveredVolume.type as "screen" | "facecam", currentVol)}
                        className="mt-0.5 flex w-full items-center justify-center gap-1 rounded border border-[#e5e7eb] bg-[#f9fafb] py-1 text-[10px] font-medium text-[#4b5563] transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] cursor-pointer"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Apply to all clips</span>
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
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
