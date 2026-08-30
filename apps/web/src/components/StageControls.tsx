/**
 * StageControls — padding resizer + beautiful themes + aspect.
 * Vercel card-soft style, pill controls black→blue hover.
 * Supports single segment or grouped multi-segment editing (via Ctrl/Cmd+Click).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_CORNER_RADIUS_UNITS } from "@panoptik/engine";
import { useProjectStore } from "@/stores/projectStore";
import type { Background } from "@panoptik/schema";

const THEMES: { name: string; bg: { kind: "solid" | "gradient"; color?: string; stops?: [string, string] }; swatch: string }[] = [
  { name: "Vercel", bg: { kind: "gradient", stops: ["#007cf0", "#7928ca"] }, swatch: "linear-gradient(135deg, #007cf0 0%, #7928ca 55%, #ff0080 100%)" },
  { name: "Midnight", bg: { kind: "solid", color: "#0a0a0a" }, swatch: "#0a0a0a" },
  { name: "Ocean", bg: { kind: "gradient", stops: ["#007cf0", "#00dfd8"] }, swatch: "linear-gradient(135deg, #007cf0, #00dfd8)" },
  { name: "Sunset", bg: { kind: "gradient", stops: ["#ff4d4d", "#f9cb28"] }, swatch: "linear-gradient(135deg, #ff4d4d, #f9cb28)" },
  { name: "Forest", bg: { kind: "gradient", stops: ["#0ea5e9", "#10b981"] }, swatch: "linear-gradient(135deg, #0ea5e9, #10b981)" },
  { name: "Paper", bg: { kind: "solid", color: "#ffffff" }, swatch: "#ffffff" },
];

/**
 * What "remove image" falls back to — the same background a project starts on,
 * so clearing one lands somewhere recognisable rather than on an arbitrary theme.
 *
 * The object URL is deliberately NOT revoked here: history holds whole project
 * snapshots, so an undo can bring this background back, and a revoked URL would
 * return as an unpaintable blank. They are released when the panel unmounts.
 */
const DEFAULT_BACKGROUND = { kind: "solid", color: "#000000" } as const;

/** Pictures large enough to stall the encoder are refused rather than resized. */
const MAX_BG_IMAGE_BYTES = 20 * 1024 * 1024;

function isSameBackground(bg1: Background, bg2: Background): boolean {
  if (bg1.kind !== bg2.kind) return false;
  if (bg1.kind === "solid" && bg2.kind === "solid") return bg1.color === bg2.color;
  if (bg1.kind === "gradient" && bg2.kind === "gradient") {
    return bg1.stops[0] === bg2.stops[0] && bg1.stops[1] === bg2.stops[1];
  }
  // Two clips share an image background only when it is the same image shown
  // the same way — otherwise Match prev would claim they already agree.
  if (bg1.kind === "image" && bg2.kind === "image") {
    return bg1.src === bg2.src && bg1.fit === bg2.fit;
  }
  return true;
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
      title={isSame ? `Already matches ${direction === "prev" ? "previous" : "next"} clip${label ? ` (${label})` : ""}` : title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all ${
        isSame
          ? "cursor-default opacity-40 text-[#888] bg-[#f5f5f5]"
          : "border border-[#e2e8f0] bg-[#fafafa] text-[#555] hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3] active:scale-95 shadow-sm"
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
      <span>{label ?? (direction === "prev" ? "Match prev" : "Match next")}</span>
    </button>
  );
}

export function StageControls() {
  const project = useProjectStore((s) => s.project);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const selectedSegmentIds = useProjectStore((s) => s.selectedSegmentIds);
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const selectAllSegments = useProjectStore((s) => s.selectAllSegments);
  const setStagePadding = useProjectStore((s) => s.setStagePadding);
  const setCornerRadius = useProjectStore((s) => s.setCornerRadius);
  const stageBackground = useProjectStore((s) => s.stageBackground);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const [bgImageError, setBgImageError] = useState<string | null>(null);
  // Object URLs this panel minted, so replacing an image can release the one it
  // replaced instead of holding every picture the user ever tried.
  const ownedBgUrls = useRef<string[]>([]);

  useEffect(
    () => () => {
      ownedBgUrls.current.forEach((u) => URL.revokeObjectURL(u));
      ownedBgUrls.current = [];
    },
    [],
  );

  /**
   * Turn a picked file into a staged image background.
   *
   * The file never leaves the machine: it becomes an object URL that the
   * renderer decodes, and a copy is written to OPFS on the next autosave so the
   * background survives a reload.
   */
  const applyImageBackground = useCallback(
    async (file: File) => {
      setBgImageError(null);
      if (!file.type.startsWith("image/")) {
        setBgImageError("That file is not an image.");
        return;
      }
      if (file.size > MAX_BG_IMAGE_BYTES) {
        setBgImageError(`Image is ${(file.size / 1e6).toFixed(0)} MB — keep it under 20 MB.`);
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        // Decode before staging, so a corrupt file fails here with a message
        // rather than silently rendering as a flat fill behind every frame.
        const { ensureBackgroundImages } = await import("@panoptik/engine");
        await ensureBackgroundImages({
          segments: [{ background: { kind: "image", src: url, fit: "cover" } }],
        } as unknown as Parameters<typeof ensureBackgroundImages>[0]);
      } catch {
        URL.revokeObjectURL(url);
        setBgImageError("That image could not be read.");
        return;
      }
      ownedBgUrls.current.push(url);
      stageBackground({ kind: "image", src: url, fit: "cover" });
    },
    [stageBackground],
  );
  const setAspectPreset = useProjectStore((s) => s.setAspectPreset);
  const setFacecam = useProjectStore((s) => s.setFacecam);
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const updateSelectedSegments = useProjectStore((s) => s.updateSelectedSegments);
  const exportProgress = useProjectStore((s) => s.exportProgress);

  if (!project) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Stage</h3>
        <p className="pk-help">Load a clip to style the stage.</p>
      </div>
    );
  }

  // Determine all selected segments
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
        <h3 className="pk-panel-title mb-1">Stage</h3>
        <p className="pk-help">Select a segment to edit its settings.</p>
      </div>
    );
  }

  const isGrouped = selectedSegs.length > 1;

  // Indices for matching prev/next
  const indices = selectedSegs.map((s) => project.segments.findIndex((x) => x.id === s.id)).sort((a, b) => a - b);
  const minIndex = indices[0] ?? 0;
  const maxIndex = indices[indices.length - 1] ?? 0;
  const prevSeg = minIndex > 0 ? project.segments[minIndex - 1]! : null;
  const nextSeg = maxIndex < project.segments.length - 1 ? project.segments[maxIndex + 1]! : null;

  // Check if properties match across grouped selection
  const allSamePadding = selectedSegs.every((s) => s.stagePadding === seg.stagePadding);
  // An unset radius means "automatic", which the renderer resolves the same way.
  const radiusOf = (sg: typeof seg) =>
    sg.cornerRadius ?? (sg.stagePadding > 0 ? DEFAULT_CORNER_RADIUS_UNITS : 0);
  const effectiveRadius = radiusOf(seg);
  const allSameRadius = selectedSegs.every((s) => radiusOf(s) === effectiveRadius);
  const allSameSpeed = selectedSegs.every((s) => s.speed === seg.speed);
  const allSameAspect = selectedSegs.every((s) => s.aspectPreset === seg.aspectPreset);
  const allSameBg = selectedSegs.every((s) => isSameBackground(s.background, seg.background));
  const isImageBg = allSameBg && seg.background.kind === "image";
  return (
    <div className="pk-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="pk-panel-title">Stage</h3>
        {isGrouped && (
          <span className="pk-chip pk-chip-blue font-bold">
            {selectedSegs.length} clips grouped
          </span>
        )}
      </div>

      {/* Grouped settings notice banner */}
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
              title="Ungroup and edit only Seg 1"
            >
              Ungroup
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-[#444]">
            Changes to padding, speed, aspect, and theme will apply simultaneously to all {selectedSegs.length} selected clips.
          </p>
        </div>
      )}

      {/* Segment switcher — supports single click or Ctrl/Cmd multi-selection */}
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
                title="Select all segments"
              >
                Select all
              </button>
            )}
            <span className="pk-value" style={{ color: "#888" }}>
              {isGrouped
                ? `${selectedSegs.length} clips`
                : `${seg.srcStart.toFixed(1)}–${seg.srcEnd.toFixed(1)}s · ${seg.speed}x`}
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
                title={`Segment ${i + 1}: ${s.srcStart.toFixed(1)}–${s.srcEnd.toFixed(1)}s @${s.speed}x (Ctrl+Click to multi-select)`}
              >
                Seg {i + 1}
              </button>
            );
          })}
        </div>
        {(prevSeg || nextSeg) && (
          <div className="mt-2.5 flex gap-2">
            {prevSeg && (
              <button
                onClick={() => {
                  updateSelectedSegments({
                    stagePadding: prevSeg.stagePadding,
                    speed: prevSeg.speed,
                    aspectPreset: prevSeg.aspectPreset,
                    background: prevSeg.background,
                    ...(prevSeg.facecam.src ? { facecam: { ...prevSeg.facecam } } : {}),
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1.5 text-xs font-medium text-[#333] shadow-sm transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                title={`Copy all stage settings from Segment ${minIndex} to selected clips`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 14 4 9 9 4" />
                  <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                </svg>
                <span>Match all from Seg {minIndex}</span>
              </button>
            )}
            {nextSeg && (
              <button
                onClick={() => {
                  updateSelectedSegments({
                    stagePadding: nextSeg.stagePadding,
                    speed: nextSeg.speed,
                    aspectPreset: nextSeg.aspectPreset,
                    background: nextSeg.background,
                    ...(nextSeg.facecam.src ? { facecam: { ...nextSeg.facecam } } : {}),
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1.5 text-xs font-medium text-[#333] shadow-sm transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                title={`Copy all stage settings from Segment ${maxIndex + 2} to selected clips`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 14 20 9 15 4" />
                  <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                </svg>
                <span>Match all from Seg {maxIndex + 2}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Padding resizer */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Padding</span>
          <div className="flex items-center gap-1.5">
            {prevSeg && (
              <MatchClipButton
                direction="prev"
                onClick={() => setStagePadding(prevSeg.stagePadding)}
                title={`Apply padding from Seg ${minIndex} (${prevSeg.stagePadding}px)`}
                label={`Prev (${prevSeg.stagePadding}px)`}
                isSame={allSamePadding && seg.stagePadding === prevSeg.stagePadding}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => setStagePadding(nextSeg.stagePadding)}
                title={`Apply padding from Seg ${maxIndex + 2} (${nextSeg.stagePadding}px)`}
                label={`Next (${nextSeg.stagePadding}px)`}
                isSame={allSamePadding && seg.stagePadding === nextSeg.stagePadding}
              />
            )}
            <span className="pk-value ml-1" style={{ color: "#0070f3" }}>
              {allSamePadding ? `${seg.stagePadding}px` : "Mixed"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStagePadding(seg.stagePadding - 4)} className="pk-icon-btn h-7 w-7 text-xs">−</button>
          <input
            type="range"
            min={0}
            max={48}
            step={4}
            value={seg.stagePadding}
            onChange={(e) => setStagePadding(Number(e.target.value))}
            className="pk-range flex-1"
          />
          <button onClick={() => setStagePadding(seg.stagePadding + 4)} className="pk-icon-btn h-7 w-7 text-xs">+</button>
        </div>
      </div>

      {/* Corner radius — rounds the recorded frame itself, so it carries
          through to the exported file, not just the preview. */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Corner radius</span>
          <span className="pk-value">{allSameRadius ? `${effectiveRadius}px` : "Mixed"}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCornerRadius(effectiveRadius - 4)} className="pk-icon-btn h-7 w-7 text-xs">−</button>
          <input
            type="range"
            min={0}
            max={64}
            step={2}
            value={effectiveRadius}
            onChange={(e) => setCornerRadius(Number(e.target.value))}
            className="pk-range flex-1"
          />
          <button onClick={() => setCornerRadius(effectiveRadius + 4)} className="pk-icon-btn h-7 w-7 text-xs">+</button>
        </div>
      </div>



      {/* Speed */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Speed</span>
          <div className="flex items-center gap-1.5">
            {prevSeg && (
              <MatchClipButton
                direction="prev"
                onClick={() => updateSelectedSegments({ speed: prevSeg.speed })}
                title={`Apply speed from Seg ${minIndex} (${prevSeg.speed}x)`}
                label={`Prev (${prevSeg.speed}x)`}
                isSame={allSameSpeed && seg.speed === prevSeg.speed}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => updateSelectedSegments({ speed: nextSeg.speed })}
                title={`Apply speed from Seg ${maxIndex + 2} (${nextSeg.speed}x)`}
                label={`Next (${nextSeg.speed}x)`}
                isSame={allSameSpeed && seg.speed === nextSeg.speed}
              />
            )}
            <span className="pk-value ml-1" style={{ color: (allSameSpeed && seg.speed !== 1) || !allSameSpeed ? "#0070f3" : "#888" }}>
              {allSameSpeed ? `${seg.speed.toFixed(2)}x` : "Mixed"}
            </span>
          </div>
        </div>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={seg.speed}
          onChange={(e) => updateSelectedSegments({ speed: Number(e.target.value) })}
          className="pk-range flex-1"
          disabled={exportProgress !== null}
          aria-label="Video speed"
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[0.5, 1, 1.5, 2].map((v) => (
            <button
              key={v}
              onClick={() => updateSelectedSegments({ speed: v })}
              disabled={exportProgress !== null}
              className="pk-seg"
              data-active={allSameSpeed && seg.speed === v}
            >
              {v}x
            </button>
          ))}
        </div>
      </div>

      {/* Aspect */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="pk-label">Aspect</p>
          <div className="flex items-center gap-1.5">
            {prevSeg && (
              <MatchClipButton
                direction="prev"
                onClick={() => setAspectPreset(prevSeg.aspectPreset)}
                title={`Apply aspect from Seg ${minIndex} (${prevSeg.aspectPreset})`}
                label={`Prev (${prevSeg.aspectPreset === "source" ? "Fit" : prevSeg.aspectPreset})`}
                isSame={allSameAspect && seg.aspectPreset === prevSeg.aspectPreset}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => setAspectPreset(nextSeg.aspectPreset)}
                title={`Apply aspect from Seg ${maxIndex + 2} (${nextSeg.aspectPreset})`}
                label={`Next (${nextSeg.aspectPreset === "source" ? "Fit" : nextSeg.aspectPreset})`}
                isSame={allSameAspect && seg.aspectPreset === nextSeg.aspectPreset}
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {(["source", "16:9", "9:16", "1:1", "4:3"] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setAspectPreset(preset)}
              className="pk-seg"
              data-active={allSameAspect && seg.aspectPreset === preset}
            >
              {preset === "source" ? "Fit" : preset}
            </button>
          ))}
        </div>
      </div>



      {/* Themes — beautiful presets for stage background (gradient/solid) */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="pk-label">Theme</p>
          <div className="flex items-center gap-1.5">
            {prevSeg && (
              <MatchClipButton
                direction="prev"
                onClick={() => stageBackground(prevSeg.background)}
                title={`Apply background theme from Seg ${minIndex}`}
                label="Match prev"
                isSame={allSameBg && isSameBackground(seg.background, prevSeg.background)}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => stageBackground(nextSeg.background)}
                title={`Apply background theme from Seg ${maxIndex + 2}`}
                label="Match next"
                isSame={allSameBg && isSameBackground(seg.background, nextSeg.background)}
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const isActive =
              allSameBg &&
              (t.bg.kind === "gradient"
                ? seg.background.kind === "gradient" &&
                  (seg.background as { stops: [string, string] }).stops[0] === t.bg.stops![0] &&
                  (seg.background as { stops: [string, string] }).stops[1] === t.bg.stops![1]
                : seg.background.kind === "solid" && (seg.background as { color: string }).color === t.bg.color);
            return (
              <button
                key={t.name}
                onClick={() => {
                  if (t.bg.kind === "gradient") stageBackground({ kind: "gradient", stops: t.bg.stops! });
                  else if (t.bg.kind === "solid") stageBackground({ kind: "solid", color: t.bg.color! });
                  else stageBackground({ kind: "solid", color: "#ffffff" });
                }}
                className="group relative overflow-hidden rounded-[12px] border p-2 text-left transition-all hover:border-[#0070f3]"
                style={{ borderColor: isActive ? "#0070f3" : "#ebebeb", background: "#ffffff", boxShadow: isActive ? "0 0 0 2px #0070f3" : "0 2px 12px rgba(0,0,0,0.04)" }}
              >
                <div className="h-10 rounded-md border" style={{ background: t.swatch, borderColor: "rgba(0,0,0,0.06)" }} />
                <p className="pk-ui mt-1.5 text-center text-[11px] font-medium" style={{ color: isActive ? "#0070f3" : "#424242" }}>{t.name}</p>
              </button>
            );
          })}

          {/* Bring your own image */}
          <button
            onClick={() => bgFileRef.current?.click()}
            className="group relative overflow-hidden rounded-[12px] border p-2 text-left transition-all hover:border-[#0070f3]"
            style={{
              borderColor: isImageBg ? "#0070f3" : "#ebebeb",
              background: "#ffffff",
              boxShadow: isImageBg ? "0 0 0 2px #0070f3" : "0 2px 12px rgba(0,0,0,0.04)",
            }}
            title="Use an image from your computer"
          >
            <div
              className="flex h-10 items-center justify-center rounded-md border"
              style={{
                borderColor: "rgba(0,0,0,0.06)",
                background: isImageBg
                  ? `center / cover no-repeat url("${(seg.background as { src: string }).src}")`
                  : "#f1f1f1",
                color: "#666",
              }}
            >
              {!isImageBg && (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="m21 15-5-5L5 21" />
                </svg>
              )}
            </div>
            <p className="pk-ui mt-1.5 text-center text-[11px] font-medium" style={{ color: isImageBg ? "#0070f3" : "#424242" }}>
              {isImageBg ? "Change" : "Image"}
            </p>
          </button>
        </div>

        <input
          ref={bgFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so picking the same file twice still fires a change event.
            e.target.value = "";
            if (file) applyImageBackground(file);
          }}
        />

        {isImageBg && (
          <div className="mt-2 flex items-center gap-2">
            <span className="pk-label">Fit</span>
            <button
              className="pk-seg flex-1"
              data-active={(seg.background as { fit: string }).fit !== "contain"}
              onClick={() => stageBackground({ ...(seg.background as { kind: "image"; src: string }), fit: "cover" })}
              title="Fill the frame, cropping the edges"
            >
              Cover
            </button>
            <button
              className="pk-seg flex-1"
              data-active={(seg.background as { fit: string }).fit === "contain"}
              onClick={() => stageBackground({ ...(seg.background as { kind: "image"; src: string }), fit: "contain" })}
              title="Show the whole image, letterboxed"
            >
              Contain
            </button>
            <button
              className="pk-icon-btn"
              onClick={() => stageBackground(DEFAULT_BACKGROUND)}
              title="Remove image background"
              aria-label="Remove image background"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {bgImageError && (
          <p className="pk-help mt-2" style={{ fontSize: 11, color: "#e11d48" }}>{bgImageError}</p>
        )}
      </div>
    </div>
  );
}
