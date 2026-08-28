/**
 * CameraControls — Dedicated Camera sidebar tab.
 * Provides Placement, Facecam Transitions, and Reshoot / Replace Camera options.
 * Supports single segment or grouped multi-segment editing.
 */
"use client";

import React, { useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { engine } from "@/lib/engineProvider";
import type { Facecam } from "@panoptik/schema";

const CAMERA_ASPECT = 16 / 9;

export interface CameraGridPreset {
  id: string;
  code: string;
  label: string;
  row: number; // 0 (top), 1 (mid), 2 (bottom)
  col: number; // 0 (left), 1 (center), 2 (right)
  at: (size: number, hFrac: number) => { x: number; y: number };
}

export const CAMERA_GRID_9: CameraGridPreset[] = [
  {
    id: "topLeft",
    code: "TL",
    label: "Top Left",
    row: 0,
    col: 0,
    at: () => ({ x: 0.03, y: 0.03 }),
  },
  {
    id: "topCenter",
    code: "TC",
    label: "Top Center",
    row: 0,
    col: 1,
    at: (s: number) => ({ x: Number(Math.max(0, 0.5 - s / 2).toFixed(4)), y: 0.03 }),
  },
  {
    id: "topRight",
    code: "TR",
    label: "Top Right",
    row: 0,
    col: 2,
    at: (s: number) => ({ x: Number(Math.max(0, 0.97 - s).toFixed(4)), y: 0.03 }),
  },
  {
    id: "midLeft",
    code: "ML",
    label: "Mid Left",
    row: 1,
    col: 0,
    at: (s: number, h: number) => ({ x: 0.03, y: Number(Math.max(0, 0.5 - h / 2).toFixed(4)) }),
  },
  {
    id: "center",
    code: "CTR",
    label: "Center",
    row: 1,
    col: 1,
    at: (s: number, h: number) => ({
      x: Number(Math.max(0, 0.5 - s / 2).toFixed(4)),
      y: Number(Math.max(0, 0.5 - h / 2).toFixed(4)),
    }),
  },
  {
    id: "midRight",
    code: "MR",
    label: "Mid Right",
    row: 1,
    col: 2,
    at: (s: number, h: number) => ({
      x: Number(Math.max(0, 0.97 - s).toFixed(4)),
      y: Number(Math.max(0, 0.5 - h / 2).toFixed(4)),
    }),
  },
  {
    id: "bottomLeft",
    code: "BL",
    label: "Bottom Left",
    row: 2,
    col: 0,
    at: (s: number, h: number) => ({ x: 0.03, y: Number(Math.max(0, 0.97 - h).toFixed(4)) }),
  },
  {
    id: "bottomCenter",
    code: "BC",
    label: "Bottom Center",
    row: 2,
    col: 1,
    at: (s: number, h: number) => ({
      x: Number(Math.max(0, 0.5 - s / 2).toFixed(4)),
      y: Number(Math.max(0, 0.97 - h).toFixed(4)),
    }),
  },
  {
    id: "bottomRight",
    code: "BR",
    label: "Bottom Right",
    row: 2,
    col: 2,
    at: (s: number, h: number) => ({
      x: Number(Math.max(0, 0.97 - s).toFixed(4)),
      y: Number(Math.max(0, 0.97 - h).toFixed(4)),
    }),
  },
];

export function getClosestGridPreset(
  x: number,
  y: number,
  size = 0.22,
  hFrac = size / (16 / 9),
): { preset: CameraGridPreset; isExact: boolean } {
  let best = CAMERA_GRID_9[0]!;
  let minDistance = Infinity;
  for (const preset of CAMERA_GRID_9) {
    const target = preset.at(size, hFrac);
    const dist = Math.hypot(x - target.x, y - target.y);
    if (dist < minDistance) {
      minDistance = dist;
      best = preset;
    }
  }
  return { preset: best, isExact: minDistance < 0.04 };
}

export const TRANSITION_ICONS: Record<string, React.ReactNode> = {
  smooth: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12c4-8 8-8 10 0s6 8 10 0" />
    </svg>
  ),
  spring: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4m0 12v4M2 12h4m12 0h4m-3.17-6.83l-2.83 2.83m-8 8l-2.83 2.83m0-13.66l2.83 2.83m8 8l2.83 2.83" />
    </svg>
  ),
  fade: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
      <circle cx="12" cy="12" r="4" fill="currentColor" fillOpacity="0.3" />
    </svg>
  ),
  slide: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="13 17 18 12 13 7" />
      <polyline points="6 17 11 12 6 7" />
    </svg>
  ),
  cut: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  ),
};



function isSameFacecam(fc1: Facecam, fc2: Facecam): boolean {
  return (
    Math.abs(fc1.size - fc2.size) < 0.01 &&
    Math.abs(fc1.x - fc2.x) < 0.01 &&
    Math.abs(fc1.y - fc2.y) < 0.01 &&
    (fc1.shape ?? "square") === (fc2.shape ?? "square")
  );
}

function MatchClipButton({
  direction,
  onClick,
  title,
  label,
  isSame,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  title: string;
  label?: string;
  isSame?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isSame}
      title={isSame ? `Already matches ${direction === "prev" ? "previous" : "next"} clip` : title}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition-all ${
        isSame
          ? "cursor-default opacity-40 text-[#888] bg-[#f5f5f5]"
          : "border border-[#e2e8f0] bg-[#fafafa] text-[#555] hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] active:scale-95 shadow-sm"
      }`}
    >
      {direction === "prev" ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 14 20 9 15 4" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
      )}
      <span>{label ?? (direction === "prev" ? "Match prev" : "Match next")}</span>
    </button>
  );
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

export function CameraControls() {
  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectedSegmentIds = useProjectStore((s) => s.selectedSegmentIds);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectAllSegments = useProjectStore((s) => s.selectAllSegments);
  const setFacecam = useProjectStore((s) => s.setFacecam);
  const updateSelectedSegments = useProjectStore((s) => s.updateSelectedSegments);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSection, setActiveSection] = useState<"placement" | "reshoot">("placement");

  if (!project) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Camera</h3>
        <p className="pk-help">Load or record a clip to style the camera.</p>
      </div>
    );
  }

  const activeIds = selectedSegmentIds.length > 0
    ? selectedSegmentIds
    : selectedSegmentId
      ? [selectedSegmentId]
      : project.segments[0]
        ? [project.segments[0].id]
        : [];

  const selectedSegs = project.segments.filter((s) => activeIds.includes(s.id));
  const seg = selectedSegs[0] ?? project.segments[0] ?? null;

  if (!seg) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Camera</h3>
        <p className="pk-help">Select a segment to edit camera settings.</p>
      </div>
    );
  }

  const isGrouped = selectedSegs.length > 1;
  const indices = selectedSegs.map((s) => project.segments.findIndex((x) => x.id === s.id)).sort((a, b) => a - b);
  const minIndex = indices[0] ?? 0;
  const maxIndex = indices[indices.length - 1] ?? 0;
  const prevSeg = minIndex > 0 ? project.segments[minIndex - 1]! : null;
  const nextSeg = maxIndex < project.segments.length - 1 ? project.segments[maxIndex + 1]! : null;

  const allSameFacecam = selectedSegs.every((s) => isSameFacecam(s.facecam, seg.facecam));
  const hasCameraTrack = !!seg.facecam.src;

  const camHeightFraction = (size: number) =>
    size * (project.media.width / project.media.height);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFacecam({ src: url });
    e.target.value = "";
  };

  const handleRemoveCamera = () => {
    setFacecam({ src: null });
  };

  const updateCameraSize = (newSize: number) => {
    const size = Math.max(0.1, Math.min(0.48, Number(newSize.toFixed(2))));
    const hFrac = camHeightFraction(size);
    const updates: Partial<Facecam> = { size };
    if (seg.facecam.x > 0.4) {
      updates.x = Number((0.97 - size).toFixed(4));
    }
    if (seg.facecam.y > 0.4) {
      updates.y = Number((0.97 - hFrac).toFixed(4));
    }
    setFacecam(updates);
  };

  return (
    <div className="pk-panel">
      {/* Top Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="pk-panel-title">Camera</h3>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            hasCameraTrack ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#f3f4f6] text-[#6b7280]"
          }`}>
            {hasCameraTrack ? "Active PiP" : "No Camera Track"}
          </span>
        </div>
        {isGrouped && (
          <span className="pk-chip pk-chip-blue font-bold">
            {selectedSegs.length} clips grouped
          </span>
        )}
      </div>

      {/* Grouped Settings Banner */}
      {isGrouped && (
        <div className="mb-4 rounded-xl border border-[#0070f3]/30 bg-[#f0f7ff] p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-md bg-[#0070f3] px-1 text-[11px] font-bold text-white">
                {selectedSegs.length}
              </span>
              <span className="text-xs font-semibold text-[#0070f3]">
                Grouped Settings ({indices.map((i) => `Seg ${i + 1}`).join(", ")})
              </span>
            </div>
            <button
              onClick={() => selectSegment(seg.id, false)}
              className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0070f3] shadow-sm border border-[#b3d7ff] hover:bg-[#0070f3] hover:text-white transition-all"
            >
              Ungroup
            </button>
          </div>
          <p className="mt-1 text-[11px] text-[#444]">
            Placement and transitions apply to all {selectedSegs.length} selected clips.
          </p>
        </div>
      )}

      {/* Segment Switcher */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">
            {isGrouped ? `Selected Segments (${selectedSegs.length})` : "Segment"}
          </span>
          <div className="flex items-center gap-1.5">
            {project.segments.length > 1 && (
              <button
                onClick={selectAllSegments}
                className="text-[10px] font-medium text-[#888] hover:text-[#0070f3] transition-colors"
              >
                Select all
              </button>
            )}
            <span className="pk-value" style={{ color: "#888" }}>
              {isGrouped ? `${selectedSegs.length} clips` : `${seg.srcStart.toFixed(1)}–${seg.srcEnd.toFixed(1)}s`}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {project.segments.map((s, i) => {
            const isSelected = activeIds.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={(e) => selectSegment(s.id, e.ctrlKey || e.metaKey || e.shiftKey)}
                className="pk-seg"
                data-active={isSelected}
                title={`Segment ${i + 1} (Ctrl+Click to multi-select)`}
              >
                Seg {i + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section Sub-Tabs: Placement / Reshoot */}
      <div className="mb-4 flex rounded-xl border border-[#ebebeb] bg-[#f8f8f8] p-1 shadow-inner">
        <button
          onClick={() => setActiveSection("placement")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            activeSection === "placement"
              ? "bg-white text-[#111] shadow-sm"
              : "text-[#666] hover:text-[#111]"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v4m0 10v4m-9-9h4m10 0h4" />
          </svg>
          <span>Placement</span>
        </button>
        <button
          onClick={() => setActiveSection("reshoot")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            activeSection === "reshoot"
              ? "bg-white text-[#111] shadow-sm"
              : "text-[#666] hover:text-[#111]"
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          <span>Reshoot & Source</span>
        </button>
      </div>

      {/* SECTION 1: PLACEMENT */}
      {activeSection === "placement" && (
        <div>
          {/* 3x3 Grid Position Preset */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="pk-label">3×3 Grid Placement</span>
              <div className="flex items-center gap-1.5">
                {prevSeg && prevSeg.facecam.src && (
                  <MatchClipButton
                    direction="prev"
                    onClick={() =>
                      setFacecam({
                        size: prevSeg.facecam.size,
                        x: prevSeg.facecam.x,
                        y: prevSeg.facecam.y,
                        shape: prevSeg.facecam.shape,
                      })
                    }
                    title={`Match placement from Seg ${minIndex}`}
                    label={`Seg ${minIndex}`}
                    isSame={allSameFacecam && isSameFacecam(seg.facecam, prevSeg.facecam)}
                  />
                )}
                {nextSeg && nextSeg.facecam.src && (
                  <MatchClipButton
                    direction="next"
                    onClick={() =>
                      setFacecam({
                        size: nextSeg.facecam.size,
                        x: nextSeg.facecam.x,
                        y: nextSeg.facecam.y,
                        shape: nextSeg.facecam.shape,
                      })
                    }
                    title={`Match placement from Seg ${maxIndex + 2}`}
                    label={`Seg ${maxIndex + 2}`}
                    isSame={allSameFacecam && isSameFacecam(seg.facecam, nextSeg.facecam)}
                  />
                )}
              </div>
            </div>

            {/* 3x3 Interactive Matrix */}
            <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-2.5 shadow-sm">
              <div className="grid grid-cols-3 gap-1.5">
                {CAMERA_GRID_9.map((c) => {
                  const size = seg.facecam.size;
                  const hFrac = camHeightFraction(size);
                  const target = c.at(size, hFrac);
                  const isExact =
                    allSameFacecam &&
                    Math.abs(seg.facecam.x - target.x) < 0.035 &&
                    Math.abs(seg.facecam.y - target.y) < 0.035;

                  return (
                    <button
                      key={c.id}
                      onClick={() => setFacecam(target)}
                      title={c.label}
                      className="group relative flex flex-col items-center justify-center rounded-lg border py-2 px-1 text-center transition-all active:scale-95"
                      style={{
                        borderColor: isExact ? "#0070f3" : "#e2e8f0",
                        background: isExact ? "#0070f3" : "#ffffff",
                        color: isExact ? "#ffffff" : "#475569",
                        boxShadow: isExact ? "0 4px 12px rgba(0,112,243,0.25)" : "0 1px 2px rgba(0,0,0,0.02)",
                      }}
                    >
                      <div className="mb-1 flex items-center justify-center">
                        <span
                          className={`h-2 w-2 rounded-full transition-all ${
                            isExact
                              ? "bg-white shadow-sm ring-2 ring-white/40"
                              : "bg-[#cbd5e1] group-hover:bg-[#0070f3] group-hover:scale-110"
                          }`}
                        />
                      </div>
                      <span className="text-[11px] font-bold tracking-tight">
                        {c.code}
                      </span>
                      <span className={`text-[9px] truncate max-w-full font-medium leading-none mt-0.5 ${
                        isExact ? "text-white/90" : "text-[#94a3b8] group-hover:text-[#475569]"
                      }`}>
                        {c.label.split(" ")[1] ?? c.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Status footer inside card */}
              {(() => {
                const { preset, isExact } = getClosestGridPreset(
                  seg.facecam.x,
                  seg.facecam.y,
                  seg.facecam.size,
                  camHeightFraction(seg.facecam.size),
                );
                return (
                  <div className="mt-2.5 flex items-center justify-between border-t border-[#e2e8f0] pt-2 text-[10.5px]">
                    <span className="text-[#64748b]">Active Placement:</span>
                    <span className="font-semibold text-[#0f172a]">
                      {isExact ? preset.label : `${preset.label} (Custom)`}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Size & Scale */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="pk-label">Camera Size</span>
              <span className="pk-value font-mono font-bold" style={{ color: "#0070f3" }}>
                {Math.round(seg.facecam.size * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateCameraSize(seg.facecam.size - 0.02)}
                className="pk-icon-btn h-7 w-7 text-xs"
              >
                −
              </button>
              <input
                type="range"
                min={0.1}
                max={0.48}
                step={0.01}
                value={seg.facecam.size}
                onChange={(e) => updateCameraSize(Number(e.target.value))}
                className="pk-range flex-1"
                aria-label="Camera size"
              />
              <button
                onClick={() => updateCameraSize(seg.facecam.size + 0.02)}
                className="pk-icon-btn h-7 w-7 text-xs"
              >
                +
              </button>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {[
                { label: "15%", val: 0.15 },
                { label: "22%", val: 0.22 },
                { label: "30%", val: 0.30 },
                { label: "40%", val: 0.40 },
              ].map((p) => (
                <button
                  key={p.val}
                  onClick={() => updateCameraSize(p.val)}
                  className="pk-seg"
                  data-active={Math.abs(seg.facecam.size - p.val) < 0.02}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Shape & Styling */}
          <div className="mb-4">
            <span className="pk-label mb-1.5 block">Frame Shape</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setFacecam({ shape: "square" })}
                className="flex items-center justify-center gap-2 rounded-xl border p-2 text-xs font-semibold transition-all hover:border-[#0070f3]"
                style={{
                  borderColor: (seg.facecam.shape ?? "square") === "square" ? "#0070f3" : "#ebebeb",
                  background: (seg.facecam.shape ?? "square") === "square" ? "#f0f7ff" : "#fff",
                }}
              >
                <div className="h-4 w-4 rounded-[4px] border-2 border-current" />
                <span>Rounded Square</span>
              </button>
              <button
                onClick={() => setFacecam({ shape: "circle" })}
                className="flex items-center justify-center gap-2 rounded-xl border p-2 text-xs font-semibold transition-all hover:border-[#0070f3]"
                style={{
                  borderColor: seg.facecam.shape === "circle" ? "#0070f3" : "#ebebeb",
                  background: seg.facecam.shape === "circle" ? "#f0f7ff" : "#fff",
                }}
              >
                <div className="h-4 w-4 rounded-full border-2 border-current" />
                <span>Circle</span>
              </button>
            </div>
          </div>

        </div>
      )}

      {/* SECTION 2: RESHOOT & SOURCE */}
      {activeSection === "reshoot" && (
        <div className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleFileUpload}
          />

          {/* Reshoot Take Action */}
          <div className="rounded-2xl border border-[#ebebeb] bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#fee2e2] text-[#ef4444]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="8" />
                </svg>
              </div>
              <div>
                <h4 className="text-xs font-bold text-[#111]">Reshoot Camera Take</h4>
                <p className="text-[11px] text-[#666]">Re-record webcam synchronized with screen canvas</p>
              </div>
            </div>
            <div className="mb-2 rounded-xl bg-[#f8f8f8] px-3 py-1.5 text-[11px] text-[#666]">
              <span>Starts at slider: </span>
              <strong className="font-mono text-[#111]">{formatTimer(currentTime)}</strong>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-reshoot-modal"))}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-red-500 active:scale-95"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="7" />
              </svg>
              <span>Reshoot from {formatTimer(currentTime)}</span>
            </button>
          </div>

          {/* Replace from File */}
          <div className="rounded-2xl border border-[#ebebeb] bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e0f2fe] text-[#0284c7]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <h4 className="text-xs font-bold text-[#111]">Import Video Track</h4>
                <p className="text-[11px] text-[#666]">Use a separate webcam MP4 / WebM</p>
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-[#e5e5e5] bg-[#fafafa] py-2 text-xs font-semibold text-[#333] transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
            >
              <span>Choose Video File...</span>
            </button>
          </div>

          {/* Remove / Detach Track */}
          {hasCameraTrack && (
            <button
              onClick={handleRemoveCamera}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#fee2e2] bg-[#fff5f5] py-2 text-xs font-semibold text-[#ef4444] transition-all hover:bg-[#fee2e2]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>Detach Camera Track</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
