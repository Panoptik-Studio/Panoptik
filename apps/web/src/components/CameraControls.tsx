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

const CAMERA_CORNERS = [
  {
    id: "topLeft",
    label: "Top Left",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 17 7 7 17 7" />
        <line x1="7" y1="7" x2="17" y2="17" />
      </svg>
    ),
    at: () => ({ x: 0.03, y: 0.03 }),
  },
  {
    id: "topRight",
    label: "Top Right",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 7 17 7 17 17" />
        <line x1="17" y1="7" x2="7" y2="17" />
      </svg>
    ),
    at: (s: number) => ({ x: 0.97 - s, y: 0.03 }),
  },
  {
    id: "bottomLeft",
    label: "Bottom Left",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 17 7 17 7 7" />
        <line x1="7" y1="17" x2="17" y2="7" />
      </svg>
    ),
    at: (s: number, h: number) => ({ x: 0.03, y: 0.97 - h }),
  },
  {
    id: "bottomRight",
    label: "Bottom Right",
    icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 17 17 17 17 7" />
        <line x1="17" y1="17" x2="7" y2="7" />
      </svg>
    ),
    at: (s: number, h: number) => ({ x: 0.97 - s, y: 0.97 - h }),
  },
] as const;

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

export function CameraControls() {
  const project = useProjectStore((s) => s.project);
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
    (size * (project.media.width / project.media.height)) / CAMERA_ASPECT;

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
          {/* Corner Position Preset */}
          <div className="mb-4">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="pk-label">Corner Placement</span>
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
            <div className="grid grid-cols-2 gap-2">
              {CAMERA_CORNERS.map((c) => {
                const size = seg.facecam.size;
                const target = c.at(size, camHeightFraction(size));
                const active =
                  allSameFacecam &&
                  Math.abs(seg.facecam.x - target.x) < 0.03 &&
                  Math.abs(seg.facecam.y - target.y) < 0.03;
                return (
                  <button
                    key={c.id}
                    onClick={() => setFacecam(target)}
                    className="group relative flex items-center justify-between rounded-xl border p-2.5 text-left transition-all hover:border-[#0070f3]"
                    style={{
                      borderColor: active ? "#0070f3" : "#ebebeb",
                      background: active ? "#f0f7ff" : "#ffffff",
                      boxShadow: active ? "0 0 0 2px rgba(0,112,243,0.2)" : "0 2px 8px rgba(0,0,0,0.02)",
                    }}
                  >
                    <span className="text-xs font-semibold text-[#333]">{c.label}</span>
                    <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold transition-all ${
                      active ? "bg-[#0070f3] text-white" : "bg-[#f5f5f5] text-[#666] group-hover:bg-[#e0f2fe] group-hover:text-[#0070f3]"
                    }`}>
                      {c.icon}
                    </span>
                  </button>
                );
              })}
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
                onClick={() => setFacecam({ size: Math.max(0.1, Number((seg.facecam.size - 0.02).toFixed(2))) })}
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
                onChange={(e) => {
                  const size = Number(e.target.value);
                  const hFrac = camHeightFraction(size);
                  setFacecam({
                    size,
                    x: seg.facecam.x > 0.5 ? 0.97 - size : seg.facecam.x,
                    y: seg.facecam.y > 0.5 ? 0.97 - hFrac : seg.facecam.y,
                  });
                }}
                className="pk-range flex-1"
                aria-label="Camera size"
              />
              <button
                onClick={() => setFacecam({ size: Math.min(0.48, Number((seg.facecam.size + 0.02).toFixed(2))) })}
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
                  onClick={() => setFacecam({ size: p.val })}
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
                <p className="text-[11px] text-[#666]">Re-record webcam track with synced audio</p>
              </div>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-record-modal"))}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#111] py-2 text-xs font-semibold text-white shadow-md transition-all hover:bg-[#0070f3]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
              <span>Record New Camera Take</span>
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
