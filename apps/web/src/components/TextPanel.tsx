/**
 * Text Overlay Inspector & Creator Panel.
 * Lets users add, style, animate, position, and retime text callouts on the timeline.
 */
"use client";

import React, { useMemo } from "react";
import { useProjectStore } from "@/stores/projectStore";
import type { TextAnimation, TextOverlay } from "@panoptik/schema";

const FONT_OPTIONS: { value: string; label: string; previewFont: string }[] = [
  { value: "Inter, sans-serif", label: "Inter (Clean Modern)", previewFont: "Inter" },
  { value: "Outfit, sans-serif", label: "Outfit (Geometric)", previewFont: "Outfit" },
  { value: "Poppins, sans-serif", label: "Poppins (Rounded Bold)", previewFont: "Poppins" },
  { value: "Montserrat, sans-serif", label: "Montserrat (Punchy)", previewFont: "Montserrat" },
  { value: "'Playfair Display', serif", label: "Playfair (Elegant Serif)", previewFont: "Playfair Display" },
  { value: "'Bebas Neue', sans-serif", label: "Bebas Neue (Cinematic)", previewFont: "Bebas Neue" },
  { value: "'Fira Code', monospace", label: "Fira Code (Technical)", previewFont: "Fira Code" },
  { value: "Caveat, cursive", label: "Caveat (Handwritten)", previewFont: "Caveat" },
  { value: "Roboto, sans-serif", label: "Roboto (Universal)", previewFont: "Roboto" },
  { value: "Oswald, sans-serif", label: "Oswald (Headline)", previewFont: "Oswald" },
];

const ANIMATION_OPTIONS: { value: TextAnimation; label: string; desc: string }[] = [
  { value: "fade", label: "Fade", desc: "Smooth opacity in & out" },
  { value: "pop", label: "Pop", desc: "Elastic scale with punchy overshoot" },
  { value: "slide-up", label: "Slide Up", desc: "Smooth upward entrance" },
  { value: "slide-down", label: "Slide Down", desc: "Downward entrance drop" },
  { value: "zoom-in", label: "Zoom In", desc: "Dynamic scale expansion" },
  { value: "typewriter", label: "Typewriter", desc: "Letters revealed in sequence" },
  { value: "bounce", label: "Bounce", desc: "Energetic bouncy landing" },
  { value: "none", label: "None", desc: "Instant cut" },
];

const QUICK_COLORS = [
  "#ffffff",
  "#000000",
  "#0070f3",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

const BG_PILL_COLORS = [
  "rgba(0,0,0,0.75)",
  "rgba(0,0,0,0.45)",
  "rgba(255,255,255,0.9)",
  "rgba(0,112,243,0.85)",
  "rgba(16,185,129,0.85)",
  "rgba(245,158,11,0.85)",
  "rgba(139,92,246,0.85)",
];

export function TextPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectedTextOverlayId = useProjectStore((s) => s.selectedTextOverlayId);
  const currentTime = useProjectStore((s) => s.currentTime);
  const addTextOverlay = useProjectStore((s) => s.addTextOverlay);
  const updateTextOverlay = useProjectStore((s) => s.updateTextOverlay);
  const removeTextOverlay = useProjectStore((s) => s.removeTextOverlay);
  const setSelectedTextOverlay = useProjectStore((s) => s.setSelectedTextOverlay);
  const seek = useProjectStore((s) => s.seek);

  const seg = useMemo(
    () => project?.segments.find((s) => s.id === selectedSegmentId),
    [project, selectedSegmentId],
  );

  const overlays: TextOverlay[] = useMemo(() => {
    if (!seg) return [];
    return [...seg.textOverlays, ...seg.stagedTextOverlays].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
  }, [seg]);

  const activeOverlay = useMemo(
    () => overlays.find((t) => t.id === selectedTextOverlayId),
    [overlays, selectedTextOverlayId],
  );

  if (!project || !seg) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Text Overlays</h3>
        <p className="pk-help">Import a clip to start adding text.</p>
      </div>
    );
  }

  const handleAddNew = () => {
    const startT = Math.max(0, currentTime);
    addTextOverlay({
      text: "New Text Callout",
      timestamp: Number(startT.toFixed(2)),
      duration: 3,
      position: "bottom",
      x: 0.5,
      y: 0.85,
      fontFamily: "Inter, sans-serif",
      fontSize: 36,
      fontWeight: "bold",
      fontStyle: "normal",
      textAlign: "center",
      color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.75)",
      backgroundPadding: 14,
      borderRadius: 10,
      shadowColor: "rgba(0,0,0,0.5)",
      shadowBlur: 4,
      animation: "pop",
      animationDuration: 0.35,
    });
  };

  const patch = (updates: Partial<TextOverlay>) => {
    if (!activeOverlay) return;
    updateTextOverlay(activeOverlay.id, updates);
  };

  return (
    <div className="pk-panel space-y-4">
      {/* Header & Add Button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="pk-panel-title">Text Overlays</h3>
          <p className="pk-help">Captions, titles & callout graphics</p>
        </div>
        <button
          onClick={handleAddNew}
          className="flex items-center gap-1.5 rounded-lg bg-[#0070f3] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#0060df] active:scale-95 cursor-pointer"
        >
          <span className="text-sm leading-none">+</span> Add Text
        </button>
      </div>

      {/* Overlay Quick Selector / Badges */}
      {overlays.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-pk-faint">
            Timeline Text Items ({overlays.length})
          </div>
          <div className="max-h-[140px] space-y-1 overflow-y-auto pr-1">
            {overlays.map((to) => {
              const isSelected = to.id === selectedTextOverlayId;
              const dur = to.duration ?? 3;
              return (
                <div
                  key={to.id}
                  onClick={() => setSelectedTextOverlay(to.id)}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-all ${
                    isSelected
                      ? "border-[#0070f3] bg-[#0070f3]/10 font-medium text-[#0070f3]"
                      : "border-pk-hairline bg-pk-surface-soft text-[#333] hover:border-pk-subtle"
                  }`}
                >
                  <span className="truncate flex-1">
                    {to.text ? to.text.replace(/\n/g, " ") : "Untitled Text"}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0 text-[10px] text-pk-faint font-mono">
                    <span>{to.timestamp.toFixed(1)}s–{(to.timestamp + dur).toFixed(1)}s</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTextOverlay(to.id);
                      }}
                      className="rounded p-0.5 text-pk-faint hover:text-red-500 hover:bg-red-50"
                      title="Delete text overlay"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-pk-hairline bg-pk-surface-soft p-4 text-center">
          <div className="text-xs text-pk-faint">No text overlays yet</div>
          <button
            onClick={handleAddNew}
            className="mt-2 text-xs font-semibold text-[#0070f3] hover:underline"
          >
            Create first text callout
          </button>
        </div>
      )}

      {/* Selected Overlay Inspector */}
      {activeOverlay ? (
        <div className="space-y-4 border-t border-pk-hairline pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#111]">Style & Content</span>
            <button
              onClick={() => seek(activeOverlay.timestamp)}
              className="pk-chip text-[10px]"
              title="Seek playhead to text start time"
            >
              Seek to {activeOverlay.timestamp.toFixed(1)}s
            </button>
          </div>

          {/* Text Input */}
          <div>
            <label className="pk-label mb-1 block">Text Content</label>
            <textarea
              rows={2}
              value={activeOverlay.text}
              onChange={(e) => patch({ text: e.target.value })}
              className="w-full rounded-md border border-pk-hairline bg-white p-2 text-xs outline-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3]"
              placeholder="Enter overlay text..."
            />
          </div>

          {/* Typography */}
          <div className="space-y-2">
            <label className="pk-label block">Typography</label>
            <select
              value={activeOverlay.fontFamily ?? "Inter, sans-serif"}
              onChange={(e) => patch({ fontFamily: e.target.value })}
              className="w-full rounded-md border border-pk-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[#0070f3]"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>

            {/* Font Size & Weight & Style */}
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="flex justify-between text-[11px] text-pk-faint mb-1">
                  <span>Size</span>
                  <span>{activeOverlay.fontSize ?? 36}px</span>
                </div>
                <input
                  type="range"
                  min={16}
                  max={120}
                  step={2}
                  value={activeOverlay.fontSize ?? 36}
                  onChange={(e) => patch({ fontSize: Number(e.target.value) })}
                  className="pk-range"
                />
              </div>

              {/* Bold / Italic / Align */}
              <div className="flex items-center gap-1 self-end pb-0.5">
                <button
                  onClick={() =>
                    patch({
                      fontWeight:
                        activeOverlay.fontWeight === "bold" ? "normal" : "bold",
                    })
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded border text-xs font-bold ${
                    (activeOverlay.fontWeight ?? "bold") === "bold"
                      ? "border-[#0070f3] bg-[#0070f3] text-white"
                      : "border-pk-hairline bg-white text-[#555]"
                  }`}
                  title="Bold"
                >
                  B
                </button>
                <button
                  onClick={() =>
                    patch({
                      fontStyle:
                        activeOverlay.fontStyle === "italic" ? "normal" : "italic",
                    })
                  }
                  className={`flex h-7 w-7 items-center justify-center rounded border text-xs italic font-serif ${
                    activeOverlay.fontStyle === "italic"
                      ? "border-[#0070f3] bg-[#0070f3] text-white"
                      : "border-pk-hairline bg-white text-[#555]"
                  }`}
                  title="Italic"
                >
                  I
                </button>
                <button
                  onClick={() => {
                    const current = activeOverlay.textAlign ?? "center";
                    const next =
                      current === "left" ? "center" : current === "center" ? "right" : "left";
                    patch({ textAlign: next });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded border border-pk-hairline bg-white text-xs text-[#555]"
                  title={`Alignment: ${activeOverlay.textAlign ?? "center"}`}
                >
                  {(activeOverlay.textAlign ?? "center") === "left"
                    ? "⫷"
                    : (activeOverlay.textAlign ?? "center") === "right"
                    ? "⫸"
                    : "≡"}
                </button>
              </div>
            </div>
          </div>

          {/* Color & Pill Box */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="pk-label">Text Color</label>
              <div className="flex items-center gap-1">
                <input
                  type="color"
                  value={activeOverlay.color ?? "#ffffff"}
                  onChange={(e) => patch({ color: e.target.value })}
                  className="h-5 w-6 cursor-pointer rounded border border-pk-hairline p-0"
                />
                <span className="font-mono text-[10px] text-pk-faint">
                  {activeOverlay.color ?? "#ffffff"}
                </span>
              </div>
            </div>

            <div className="flex gap-1.5 flex-wrap">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => patch({ color: c })}
                  style={{ background: c }}
                  className={`h-5 w-5 rounded-full border border-pk-hairline shadow-xs ${
                    activeOverlay.color === c ? "ring-2 ring-[#0070f3]" : ""
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Background Pill */}
          <div className="rounded-lg border border-pk-hairline bg-pk-surface-soft p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#333]">Background Box / Pill</span>
              <button
                onClick={() => {
                  const hasBg = !!activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent";
                  patch({
                    backgroundColor: hasBg ? "transparent" : "rgba(0,0,0,0.75)",
                  });
                }}
                className={`pk-chip ${
                  activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent"
                    ? "pk-chip-blue font-bold"
                    : ""
                }`}
              >
                {activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent"
                  ? "Enabled"
                  : "Transparent"}
              </button>
            </div>

            {activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent" && (
              <div className="space-y-2 pt-1 border-t border-pk-hairline/60">
                <div className="flex gap-1.5 flex-wrap">
                  {BG_PILL_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => patch({ backgroundColor: c })}
                      style={{ background: c }}
                      className={`h-5 w-5 rounded-md border border-pk-hairline ${
                        activeOverlay.backgroundColor === c ? "ring-2 ring-[#0070f3]" : ""
                      }`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="flex justify-between text-[10px] text-pk-faint">
                      <span>Padding</span>
                      <span>{activeOverlay.backgroundPadding ?? 14}px</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={36}
                      value={activeOverlay.backgroundPadding ?? 14}
                      onChange={(e) => patch({ backgroundPadding: Number(e.target.value) })}
                      className="pk-range"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-pk-faint">
                      <span>Corner Radius</span>
                      <span>{activeOverlay.borderRadius ?? 10}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={32}
                      value={activeOverlay.borderRadius ?? 10}
                      onChange={(e) => patch({ borderRadius: Number(e.target.value) })}
                      className="pk-range"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Animation */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="pk-label">Animation</label>
              <span className="text-[10px] text-pk-faint">
                {ANIMATION_OPTIONS.find((a) => a.value === (activeOverlay.animation ?? "fade"))?.desc}
              </span>
            </div>
            <select
              value={activeOverlay.animation ?? "fade"}
              onChange={(e) => patch({ animation: e.target.value as TextAnimation })}
              className="w-full rounded-md border border-pk-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[#0070f3]"
            >
              {ANIMATION_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label} — {a.desc}
                </option>
              ))}
            </select>
          </div>

          {/* Position */}
          <div className="space-y-2">
            <label className="pk-label block">Screen Position</label>
            <div className="grid grid-cols-4 gap-1">
              {(["top", "center", "bottom", "custom"] as const).map((pos) => {
                const isActive = (activeOverlay.position ?? "bottom") === pos;
                return (
                  <button
                    key={pos}
                    onClick={() => {
                      if (pos === "top") patch({ position: pos, x: 0.5, y: 0.12 });
                      else if (pos === "center") patch({ position: pos, x: 0.5, y: 0.5 });
                      else if (pos === "bottom") patch({ position: pos, x: 0.5, y: 0.88 });
                      else patch({ position: pos });
                    }}
                    className={`rounded border py-1 text-xs capitalize transition-all ${
                      isActive
                        ? "border-[#0070f3] bg-[#0070f3] font-semibold text-white"
                        : "border-pk-hairline bg-white text-[#555] hover:bg-pk-surface-soft"
                    }`}
                  >
                    {pos}
                  </button>
                );
              })}
            </div>

            {/* Custom Coordinates */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <div className="flex justify-between text-[10px] text-pk-faint">
                  <span>Horizontal (X)</span>
                  <span>{Math.round((activeOverlay.x ?? 0.5) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={activeOverlay.x ?? 0.5}
                  onChange={(e) => patch({ position: "custom", x: Number(e.target.value) })}
                  className="pk-range"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-pk-faint">
                  <span>Vertical (Y)</span>
                  <span>{Math.round((activeOverlay.y ?? 0.85) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.01}
                  value={activeOverlay.y ?? 0.85}
                  onChange={(e) => patch({ position: "custom", y: Number(e.target.value) })}
                  className="pk-range"
                />
              </div>
            </div>
          </div>

          {/* Timing & Duration */}
          <div className="space-y-2 border-t border-pk-hairline pt-3">
            <label className="pk-label block">Timeline Timing</label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between text-[10px] text-pk-faint">
                  <span>Start Time</span>
                  <span>{activeOverlay.timestamp.toFixed(2)}s</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, seg.srcEnd)}
                  step={0.05}
                  value={activeOverlay.timestamp}
                  onChange={(e) => patch({ timestamp: Number(e.target.value) })}
                  className="pk-range"
                />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-pk-faint">
                  <span>Duration</span>
                  <span>{(activeOverlay.duration ?? 3).toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={15}
                  step={0.1}
                  value={activeOverlay.duration ?? 3}
                  onChange={(e) => patch({ duration: Number(e.target.value) })}
                  className="pk-range"
                />
              </div>
            </div>
          </div>

          {/* Delete Action */}
          <div className="pt-2">
            <button
              onClick={() => removeTextOverlay(activeOverlay.id)}
              className="w-full rounded-md border border-red-200 bg-red-50/50 py-1.5 text-xs font-semibold text-red-600 transition-all hover:bg-red-100/70 active:scale-98"
            >
              Delete This Text Overlay
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
