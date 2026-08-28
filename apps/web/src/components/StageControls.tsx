/**
 * StageControls — padding resizer + beautiful themes + aspect.
 * Vercel card-soft style, pill controls black→blue hover.
 * Supports single segment or grouped multi-segment editing (via Ctrl/Cmd+Click).
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";
import type { Background, Facecam } from "@panoptik/schema";

const THEMES: { name: string; bg: { kind: "solid" | "gradient"; color?: string; stops?: [string, string] }; swatch: string }[] = [
  { name: "Vercel", bg: { kind: "gradient", stops: ["#007cf0", "#7928ca"] }, swatch: "linear-gradient(135deg, #007cf0 0%, #7928ca 55%, #ff0080 100%)" },
  { name: "Midnight", bg: { kind: "solid", color: "#0a0a0a" }, swatch: "#0a0a0a" },
  { name: "Ocean", bg: { kind: "gradient", stops: ["#007cf0", "#00dfd8"] }, swatch: "linear-gradient(135deg, #007cf0, #00dfd8)" },
  { name: "Sunset", bg: { kind: "gradient", stops: ["#ff4d4d", "#f9cb28"] }, swatch: "linear-gradient(135deg, #ff4d4d, #f9cb28)" },
  { name: "Forest", bg: { kind: "gradient", stops: ["#0ea5e9", "#10b981"] }, swatch: "linear-gradient(135deg, #0ea5e9, #10b981)" },
  { name: "Paper", bg: { kind: "solid", color: "#ffffff" }, swatch: "#ffffff" },
];

/** Webcam tracks are 16:9; the PiP keeps that aspect while `size` scales its width. */
const CAMERA_ASPECT = 16 / 9;

/**
 * Facecam top-left (0-1) for each corner. `size` is a fraction of canvas width,
 * so the height inset goes through both the canvas and camera aspects.
 */
const CAMERA_CORNERS = [
  { id: "topLeft", label: "Top left", at: () => ({ x: 0.03, y: 0.03 }) },
  { id: "topRight", label: "Top right", at: (s: number) => ({ x: 0.97 - s, y: 0.03 }) },
  { id: "bottomLeft", label: "Bottom left", at: (s: number, h: number) => ({ x: 0.03, y: 0.97 - h }) },
  { id: "bottomRight", label: "Bottom right", at: (s: number, h: number) => ({ x: 0.97 - s, y: 0.97 - h }) },
] as const;

function isSameBackground(bg1: Background, bg2: Background): boolean {
  if (bg1.kind !== bg2.kind) return false;
  if (bg1.kind === "solid" && bg2.kind === "solid") return bg1.color === bg2.color;
  if (bg1.kind === "gradient" && bg2.kind === "gradient") {
    return bg1.stops[0] === bg2.stops[0] && bg1.stops[1] === bg2.stops[1];
  }
  return true;
}

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
  const stageBackground = useProjectStore((s) => s.stageBackground);
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
  const allSameSpeed = selectedSegs.every((s) => s.speed === seg.speed);
  const allSameAspect = selectedSegs.every((s) => s.aspectPreset === seg.aspectPreset);
  const allSameBg = selectedSegs.every((s) => isSameBackground(s.background, seg.background));
  const allSameFacecam = selectedSegs.every((s) => isSameFacecam(s.facecam, seg.facecam));

  const camHeightFraction = (size: number) =>
    (size * (project.media.width / project.media.height)) / CAMERA_ASPECT;

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
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>
          Ctrl / Cmd + Click to group multiple clips and edit together.
        </p>
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
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>
          {isGrouped ? `Applies to all ${selectedSegs.length} selected clips.` : "White space around video. 0 = edge-to-edge."}
        </p>
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
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>
          {isGrouped ? `Sets playback speed for all ${selectedSegs.length} clips.` : "0.25x–3x · affects preview & export · cam+screen synced"}
        </p>
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

      {/* Camera — only meaningful once a recording carried a facecam track */}
      {seg.facecam.src && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="pk-label">Camera</span>
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
                  title={`Apply camera position & size from Seg ${minIndex}`}
                  label="Match prev"
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
                  title={`Apply camera position & size from Seg ${maxIndex + 2}`}
                  label="Match next"
                  isSame={allSameFacecam && isSameFacecam(seg.facecam, nextSeg.facecam)}
                />
              )}
              <span className="pk-help ml-1">
                {Math.round(seg.facecam.size * 100)}%
              </span>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            {CAMERA_CORNERS.map((c) => {
              const size = seg.facecam.size;
              const target = c.at(size, camHeightFraction(size));
              const active =
                allSameFacecam &&
                Math.abs(seg.facecam.x - target.x) < 0.02 &&
                Math.abs(seg.facecam.y - target.y) < 0.02;
              return (
                <button
                  key={c.id}
                  onClick={() => setFacecam(target)}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={active}
                  className="pk-seg"
                  data-active={active}
                >
                  {c.label.split(" ")[0]![0]}
                  {c.label.split(" ")[1]![0]}
                </button>
              );
            })}
          </div>
          <input
            type="range"
            min={0.1}
            max={0.4}
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
            className="pk-range"
            aria-label="Camera size"
          />
          <div className="mt-2 flex gap-1.5">
            {(["circle", "square"] as const).map((s) => {
              const active = allSameFacecam && (seg.facecam.shape ?? "square") === s;
              return (
                <button
                  key={s}
                  onClick={() => setFacecam({ shape: s })}
                  className="pk-seg flex-1 capitalize"
                  data-active={active}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        </div>
        <p className="pk-help mt-2" style={{ fontSize: 11 }}>
          {isGrouped ? `Applies background to all ${selectedSegs.length} selected clips.` : "Applies to stage background behind video. Staged, commit to keep."}
        </p>
      </div>
    </div>
  );
}
