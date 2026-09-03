/**
 * Text Overlay Inspector & Creator Panel.
 * Lets users add, style, animate, position, and retime text callouts on the timeline.
 */
"use client";

import React, { useMemo } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { resolveSegment } from "@panoptik/engine";
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

function parseColorToRgba(colorStr?: string): { r: number; g: number; b: number; a: number } {
  if (!colorStr || colorStr === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const str = colorStr.trim();
  if (str.startsWith("rgba")) {
    const match = str.match(/rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i);
    if (match) {
      return {
        r: parseInt(match[1]!, 10),
        g: parseInt(match[2]!, 10),
        b: parseInt(match[3]!, 10),
        a: parseFloat(match[4]!),
      };
    }
  } else if (str.startsWith("rgb")) {
    const match = str.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
    if (match) {
      return {
        r: parseInt(match[1]!, 10),
        g: parseInt(match[2]!, 10),
        b: parseInt(match[3]!, 10),
        a: 1,
      };
    }
  } else if (str.startsWith("#")) {
    const hex = str.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1,
      };
    } else if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    } else if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }
  return { r: 0, g: 0, b: 0, a: 0.75 };
}

function setRgbaAlpha(colorStr: string | undefined, alpha: number): string {
  const { r, g, b } = parseColorToRgba(colorStr);
  const clampedA = Math.max(0, Math.min(1, Number(alpha.toFixed(2))));
  return `rgba(${r}, ${g}, ${b}, ${clampedA})`;
}

function hexFromRgba(colorStr?: string): string {
  const { r, g, b } = parseColorToRgba(colorStr);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function MatchSettingButton({
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
      title={isSame ? `Already matches ${direction === "prev" ? "previous" : "next"} text` : title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
        isSame
          ? "cursor-default opacity-40 text-[#888] bg-[#f5f5f5]"
          : "border border-[#e2e8f0] bg-[#fafafa] text-[#555] hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] active:scale-95 shadow-xs cursor-pointer"
      }`}
    >
      {direction === "prev" ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 14 4 9 9 4" />
          <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
        </svg>
      ) : (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 14 20 9 15 4" />
          <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
        </svg>
      )}
      <span>{label ?? (direction === "prev" ? "Prev" : "Next")}</span>
    </button>
  );
}

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

  const seg = useMemo(() => {
    if (!project) return null;
    if (selectedTextOverlayId) {
      const foundSeg = project.segments.find((s) =>
        [...s.textOverlays, ...s.stagedTextOverlays].some((t) => t.id === selectedTextOverlayId),
      );
      if (foundSeg) return foundSeg;
    }
    return project.segments.find((s) => s.id === selectedSegmentId) ?? project.segments[0] ?? null;
  }, [project, selectedSegmentId, selectedTextOverlayId]);

  const overlays: TextOverlay[] = useMemo(() => {
    if (!seg) return [];
    return [...seg.textOverlays, ...seg.stagedTextOverlays]
      .filter((t) => t.kind !== "caption")
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [seg]);

  const activeOverlay = useMemo(
    () => overlays.find((t) => t.id === selectedTextOverlayId),
    [overlays, selectedTextOverlayId],
  );

  const activeIdx = useMemo(() => {
    if (!activeOverlay) return -1;
    return overlays.findIndex((t) => t.id === activeOverlay.id);
  }, [overlays, activeOverlay]);

  const prevOverlay = activeIdx > 0 ? overlays[activeIdx - 1] : null;
  const nextOverlay =
    activeIdx >= 0 && activeIdx < overlays.length - 1 ? overlays[activeIdx + 1] : null;

  if (!project || !seg) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Text Overlays</h3>
        <p className="pk-help">Import a clip to start adding text.</p>
      </div>
    );
  }

  const handleAddNew = () => {
    if (!project) return;
    // Overlays are stored in SOURCE-media seconds (the renderer compares them
    // against srcT), but the playhead is TIMELINE time — the two diverge after
    // any trim/split/delete/speed change, so convert here. Storing the raw
    // playhead put the overlay at a source moment the playhead never reaches.
    const srcT = resolveSegment(project, currentTime)?.srcT ?? currentTime;
    addTextOverlay({
      kind: "text",
      text: "New Text",
      timestamp: Number(srcT.toFixed(2)),
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
          <p className="pk-help">Titles, lower thirds & callouts</p>
        </div>
        <button
          onClick={handleAddNew}
          className="flex items-center gap-1.5 rounded-lg bg-[#0070f3] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#0060df] active:scale-95 cursor-pointer"
        >
          <span className="text-sm leading-none">+</span> Add Text
        </button>
      </div>

      {/* Overlay Quick Selector / Badges */}
      {overlays.length > 0 && (
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
      )}

      {/* Selected Overlay Inspector */}
      {activeOverlay ? (
        <div className="space-y-4 border-t border-pk-hairline pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#111]">Style & Content</span>
            <div className="flex items-center gap-1.5">
              {prevOverlay && (
                <MatchSettingButton
                  direction="prev"
                  onClick={() => {
                    patch({
                      fontFamily: prevOverlay.fontFamily,
                      fontSize: prevOverlay.fontSize,
                      fontWeight: prevOverlay.fontWeight,
                      fontStyle: prevOverlay.fontStyle,
                      textAlign: prevOverlay.textAlign,
                      color: prevOverlay.color,
                      backgroundColor: prevOverlay.backgroundColor,
                      backgroundPadding: prevOverlay.backgroundPadding,
                      borderRadius: prevOverlay.borderRadius,
                      shadowColor: prevOverlay.shadowColor,
                      shadowBlur: prevOverlay.shadowBlur,
                      animation: prevOverlay.animation,
                      animationDuration: prevOverlay.animationDuration,
                    });
                  }}
                  title={`Copy all style settings from previous text ("${prevOverlay.text?.slice(0, 15) ?? "Text"}")`}
                  label="Match all prev"
                />
              )}
              {nextOverlay && (
                <MatchSettingButton
                  direction="next"
                  onClick={() => {
                    patch({
                      fontFamily: nextOverlay.fontFamily,
                      fontSize: nextOverlay.fontSize,
                      fontWeight: nextOverlay.fontWeight,
                      fontStyle: nextOverlay.fontStyle,
                      textAlign: nextOverlay.textAlign,
                      color: nextOverlay.color,
                      backgroundColor: nextOverlay.backgroundColor,
                      backgroundPadding: nextOverlay.backgroundPadding,
                      borderRadius: nextOverlay.borderRadius,
                      shadowColor: nextOverlay.shadowColor,
                      shadowBlur: nextOverlay.shadowBlur,
                      animation: nextOverlay.animation,
                      animationDuration: nextOverlay.animationDuration,
                    });
                  }}
                  title={`Copy all style settings from next text ("${nextOverlay.text?.slice(0, 15) ?? "Text"}")`}
                  label="Match all next"
                />
              )}
              <button
                onClick={() => seek(activeOverlay.timestamp)}
                className="pk-chip text-[10px]"
                title="Seek playhead to text start time"
              >
                Seek {activeOverlay.timestamp.toFixed(1)}s
              </button>
            </div>
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
            <div className="flex items-center justify-between">
              <label className="pk-label">Typography</label>
              <div className="flex items-center gap-1">
                {prevOverlay && (
                  <MatchSettingButton
                    direction="prev"
                    onClick={() =>
                      patch({
                        fontFamily: prevOverlay.fontFamily,
                        fontSize: prevOverlay.fontSize,
                        fontWeight: prevOverlay.fontWeight,
                        fontStyle: prevOverlay.fontStyle,
                        textAlign: prevOverlay.textAlign,
                      })
                    }
                    title="Match font & typography from previous text"
                    label="Prev"
                    isSame={
                      activeOverlay.fontFamily === prevOverlay.fontFamily &&
                      activeOverlay.fontSize === prevOverlay.fontSize &&
                      activeOverlay.fontWeight === prevOverlay.fontWeight &&
                      activeOverlay.fontStyle === prevOverlay.fontStyle &&
                      activeOverlay.textAlign === prevOverlay.textAlign
                    }
                  />
                )}
                {nextOverlay && (
                  <MatchSettingButton
                    direction="next"
                    onClick={() =>
                      patch({
                        fontFamily: nextOverlay.fontFamily,
                        fontSize: nextOverlay.fontSize,
                        fontWeight: nextOverlay.fontWeight,
                        fontStyle: nextOverlay.fontStyle,
                        textAlign: nextOverlay.textAlign,
                      })
                    }
                    title="Match font & typography from next text"
                    label="Next"
                    isSame={
                      activeOverlay.fontFamily === nextOverlay.fontFamily &&
                      activeOverlay.fontSize === nextOverlay.fontSize &&
                      activeOverlay.fontWeight === nextOverlay.fontWeight &&
                      activeOverlay.fontStyle === nextOverlay.fontStyle &&
                      activeOverlay.textAlign === nextOverlay.textAlign
                    }
                  />
                )}
              </div>
            </div>
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
            <div className="flex items-center justify-between">
              <label className="pk-label">Text Color</label>
              <div className="flex items-center gap-1.5">
                {prevOverlay && (
                  <MatchSettingButton
                    direction="prev"
                    onClick={() => patch({ color: prevOverlay.color })}
                    title="Match text color from previous text"
                    label="Prev"
                    isSame={(activeOverlay.color ?? "#ffffff") === (prevOverlay.color ?? "#ffffff")}
                  />
                )}
                {nextOverlay && (
                  <MatchSettingButton
                    direction="next"
                    onClick={() => patch({ color: nextOverlay.color })}
                    title="Match text color from next text"
                    label="Next"
                    isSame={(activeOverlay.color ?? "#ffffff") === (nextOverlay.color ?? "#ffffff")}
                  />
                )}
                <span className="font-mono text-[11px] text-pk-faint">
                  {activeOverlay.color ?? "#ffffff"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Custom Color Input with Dynamic Eyedropper Icon Color */}
              <label
                className="group relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] border border-pk-hairline bg-white shadow-xs transition-all hover:border-[#0070f3]"
                title="Pick custom text color"
                style={{ borderColor: activeOverlay.color ? `${activeOverlay.color}88` : undefined }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ color: activeOverlay.color ?? "#555555" }}
                >
                  <path d="m14 7 3 3" />
                  <path d="M17 4a2.12 2.12 0 0 1 3 3L9 18l-5 1 1-5L17 4z" />
                </svg>
                <input
                  type="color"
                  value={activeOverlay.color ?? "#ffffff"}
                  onChange={(e) => patch({ color: e.target.value })}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>

              <div className="h-4 w-px bg-pk-hairline mx-0.5" />

              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => patch({ color: c })}
                  style={{ background: c }}
                  className={`h-5 w-5 rounded-full border border-pk-hairline shadow-xs transition-transform hover:scale-110 active:scale-95 ${
                    activeOverlay.color === c ? "ring-2 ring-[#0070f3]" : ""
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Background Pill */}
          <div className="rounded-lg border border-pk-hairline bg-pk-surface-soft p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#333]">Text Backdrop</span>
              <div className="flex items-center gap-1.5">
                {prevOverlay && (
                  <MatchSettingButton
                    direction="prev"
                    onClick={() =>
                      patch({
                        backgroundColor: prevOverlay.backgroundColor,
                        backgroundPadding: prevOverlay.backgroundPadding,
                        borderRadius: prevOverlay.borderRadius,
                      })
                    }
                    title="Match backdrop style from previous text"
                    label="Prev"
                    isSame={
                      (activeOverlay.backgroundColor ?? "transparent") ===
                        (prevOverlay.backgroundColor ?? "transparent") &&
                      (activeOverlay.backgroundPadding ?? 14) ===
                        (prevOverlay.backgroundPadding ?? 14) &&
                      (activeOverlay.borderRadius ?? 10) ===
                        (prevOverlay.borderRadius ?? 10)
                    }
                  />
                )}
                {nextOverlay && (
                  <MatchSettingButton
                    direction="next"
                    onClick={() =>
                      patch({
                        backgroundColor: nextOverlay.backgroundColor,
                        backgroundPadding: nextOverlay.backgroundPadding,
                        borderRadius: nextOverlay.borderRadius,
                      })
                    }
                    title="Match backdrop style from next text"
                    label="Next"
                    isSame={
                      (activeOverlay.backgroundColor ?? "transparent") ===
                        (nextOverlay.backgroundColor ?? "transparent") &&
                      (activeOverlay.backgroundPadding ?? 14) ===
                        (nextOverlay.backgroundPadding ?? 14) &&
                      (activeOverlay.borderRadius ?? 10) ===
                        (nextOverlay.borderRadius ?? 10)
                    }
                  />
                )}
                <button
                  onClick={() => {
                    const hasBg =
                      !!activeOverlay.backgroundColor &&
                      activeOverlay.backgroundColor !== "transparent";
                    patch({
                      backgroundColor: hasBg ? "transparent" : "rgba(0,0,0,0.75)",
                    });
                  }}
                  className={`pk-chip ${
                    activeOverlay.backgroundColor &&
                    activeOverlay.backgroundColor !== "transparent"
                      ? "pk-chip-blue font-bold"
                      : ""
                  }`}
                >
                  {activeOverlay.backgroundColor &&
                  activeOverlay.backgroundColor !== "transparent"
                    ? "Enabled"
                    : "Transparent"}
                </button>
              </div>
            </div>

            {activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent" && (
              <div className="space-y-2.5 pt-1 border-t border-pk-hairline/60">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Custom Background Color Input with Dynamic Eyedropper Icon Color */}
                  <label
                    className="group relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-[6px] border border-pk-hairline bg-white shadow-xs transition-all hover:border-[#0070f3]"
                    title="Pick custom background color"
                    style={{
                      borderColor:
                        activeOverlay.backgroundColor && activeOverlay.backgroundColor !== "transparent"
                          ? `${hexFromRgba(activeOverlay.backgroundColor)}88`
                          : undefined,
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      style={{
                        color: hexFromRgba(activeOverlay.backgroundColor),
                      }}
                    >
                      <path d="m14 7 3 3" />
                      <path d="M17 4a2.12 2.12 0 0 1 3 3L9 18l-5 1 1-5L17 4z" />
                    </svg>
                    <input
                      type="color"
                      value={hexFromRgba(activeOverlay.backgroundColor)}
                      onChange={(e) => {
                        const currentAlpha = parseColorToRgba(activeOverlay.backgroundColor).a;
                        patch({ backgroundColor: setRgbaAlpha(e.target.value, currentAlpha) });
                      }}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                  </label>

                  <div className="h-4 w-px bg-pk-hairline mx-0.5" />

                  {BG_PILL_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => {
                        const currentAlpha = parseColorToRgba(activeOverlay.backgroundColor).a;
                        patch({ backgroundColor: setRgbaAlpha(c, currentAlpha) });
                      }}
                      style={{ background: c }}
                      className={`h-5 w-5 rounded-md border border-pk-hairline transition-transform hover:scale-110 active:scale-95 ${
                        hexFromRgba(activeOverlay.backgroundColor) === hexFromRgba(c) ? "ring-2 ring-[#0070f3]" : ""
                      }`}
                    />
                  ))}
                </div>

                {/* Transparency Slider */}
                <div>
                  <div className="flex justify-between text-[10px] text-pk-faint">
                    <span>Transparency</span>
                    <span>{Math.round((1 - parseColorToRgba(activeOverlay.backgroundColor).a) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round((1 - parseColorToRgba(activeOverlay.backgroundColor).a) * 100)}
                    onChange={(e) => {
                      const trans = Number(e.target.value);
                      const newAlpha = Math.max(0, Math.min(1, (100 - trans) / 100));
                      patch({
                        backgroundColor: setRgbaAlpha(activeOverlay.backgroundColor, newAlpha),
                      });
                    }}
                    className="pk-range"
                  />
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
              <div className="flex items-center gap-1.5">
                {prevOverlay && (
                  <MatchSettingButton
                    direction="prev"
                    onClick={() =>
                      patch({
                        animation: prevOverlay.animation,
                        animationDuration: prevOverlay.animationDuration,
                      })
                    }
                    title="Match animation from previous text"
                    label="Prev"
                    isSame={
                      (activeOverlay.animation ?? "fade") === (prevOverlay.animation ?? "fade")
                    }
                  />
                )}
                {nextOverlay && (
                  <MatchSettingButton
                    direction="next"
                    onClick={() =>
                      patch({
                        animation: nextOverlay.animation,
                        animationDuration: nextOverlay.animationDuration,
                      })
                    }
                    title="Match animation from next text"
                    label="Next"
                    isSame={
                      (activeOverlay.animation ?? "fade") === (nextOverlay.animation ?? "fade")
                    }
                  />
                )}
                <span className="text-[10px] text-pk-faint">
                  {ANIMATION_OPTIONS.find((a) => a.value === (activeOverlay.animation ?? "fade"))?.desc}
                </span>
              </div>
            </div>
            <select
              value={activeOverlay.animation ?? "fade"}
              onChange={(e) => patch({ animation: e.target.value as TextAnimation })}
              className="w-full rounded-md border border-pk-hairline bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[#0070f3]"
            >
              {ANIMATION_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label} ({a.desc})
                </option>
              ))}
            </select>
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
