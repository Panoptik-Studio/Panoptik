/**
 * StageControls — padding resizer + beautiful themes + aspect.
 * Vercel card-soft style, pill controls black→blue hover.
 * Every setting edits the SELECTED segment (store actions all target it); a pill
 * strip switches which segment the panel edits.
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
  const selectSegment = useProjectStore((s) => s.selectSegment);
  const setStagePadding = useProjectStore((s) => s.setStagePadding);
  const stageBackground = useProjectStore((s) => s.stageBackground);
  const setAspectPreset = useProjectStore((s) => s.setAspectPreset);
  const setFacecam = useProjectStore((s) => s.setFacecam);
  const updateSegment = useProjectStore((s) => s.updateSegment);
  const exportProgress = useProjectStore((s) => s.exportProgress);

  if (!project) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Stage</h3>
        <p className="pk-help">Load a clip to style the stage.</p>
      </div>
    );
  }

  const seg = project.segments.find((s) => s.id === selectedSegmentId) ?? null;

  if (!seg) {
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Stage</h3>
        <p className="pk-help">Select a segment to edit its settings.</p>
      </div>
    );
  }

  const segIndex = project.segments.findIndex((s) => s.id === seg.id);
  const prevSeg = segIndex > 0 ? project.segments[segIndex - 1]! : null;
  const nextSeg = segIndex < project.segments.length - 1 ? project.segments[segIndex + 1]! : null;

  const camHeightFraction = (size: number) =>
    (size * (project.media.width / project.media.height)) / CAMERA_ASPECT;

  return (
    <div className="pk-panel">
      <h3 className="pk-panel-title mb-3">Stage</h3>

      {/* Segment switcher — the panel edits the selected segment */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Segment</span>
          <span className="pk-value" style={{ color: "#888" }}>{seg.srcStart.toFixed(1)}–{seg.srcEnd.toFixed(1)}s · {seg.speed}x</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {project.segments.map((s, i) => (
            <button
              key={s.id}
              onClick={() => selectSegment(s.id)}
              className="pk-seg"
              data-active={s.id === selectedSegmentId}
              title={`Segment ${i + 1}: ${s.srcStart.toFixed(1)}–${s.srcEnd.toFixed(1)}s @${s.speed}x`}
            >
              Seg {i + 1}
            </button>
          ))}
        </div>
        {(prevSeg || nextSeg) && (
          <div className="mt-2.5 flex gap-2">
            {prevSeg && (
              <button
                onClick={() => {
                  updateSegment(seg.id, {
                    stagePadding: prevSeg.stagePadding,
                    speed: prevSeg.speed,
                    aspectPreset: prevSeg.aspectPreset,
                    background: prevSeg.background,
                    ...(prevSeg.facecam.src ? { facecam: { ...prevSeg.facecam } } : {}),
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1.5 text-xs font-medium text-[#333] shadow-sm transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                title={`Copy all stage settings from Segment ${segIndex} to Segment ${segIndex + 1}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 14 4 9 9 4" />
                  <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                </svg>
                <span>Match all from Seg {segIndex}</span>
              </button>
            )}
            {nextSeg && (
              <button
                onClick={() => {
                  updateSegment(seg.id, {
                    stagePadding: nextSeg.stagePadding,
                    speed: nextSeg.speed,
                    aspectPreset: nextSeg.aspectPreset,
                    background: nextSeg.background,
                    ...(nextSeg.facecam.src ? { facecam: { ...nextSeg.facecam } } : {}),
                  });
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1.5 text-xs font-medium text-[#333] shadow-sm transition-all hover:border-[#0070f3] hover:bg-[#f0f7ff] hover:text-[#0070f3]"
                title={`Copy all stage settings from Segment ${segIndex + 2} to Segment ${segIndex + 1}`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 14 20 9 15 4" />
                  <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
                </svg>
                <span>Match all from Seg {segIndex + 2}</span>
              </button>
            )}
          </div>
        )}
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>Settings apply to the selected segment; others keep their own.</p>
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
                title={`Apply padding from Seg ${segIndex} (${prevSeg.stagePadding}px)`}
                label={`Prev (${prevSeg.stagePadding}px)`}
                isSame={seg.stagePadding === prevSeg.stagePadding}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => setStagePadding(nextSeg.stagePadding)}
                title={`Apply padding from Seg ${segIndex + 2} (${nextSeg.stagePadding}px)`}
                label={`Next (${nextSeg.stagePadding}px)`}
                isSame={seg.stagePadding === nextSeg.stagePadding}
              />
            )}
            <span className="pk-value ml-1" style={{ color: "#0070f3" }}>{seg.stagePadding}px</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStagePadding(seg.stagePadding - 4)} className="pk-icon-btn h-7 w-7 text-xs">−</button>
          <input type="range" min={0} max={48} step={4} value={seg.stagePadding} onChange={(e) => setStagePadding(Number(e.target.value))} className="pk-range flex-1" />
          <button onClick={() => setStagePadding(seg.stagePadding + 4)} className="pk-icon-btn h-7 w-7 text-xs">+</button>
        </div>
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>White space around video. 0 = edge-to-edge.</p>
      </div>

      {/* Speed */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Speed</span>
          <div className="flex items-center gap-1.5">
            {prevSeg && (
              <MatchClipButton
                direction="prev"
                onClick={() => updateSegment(seg.id, { speed: prevSeg.speed })}
                title={`Apply speed from Seg ${segIndex} (${prevSeg.speed}x)`}
                label={`Prev (${prevSeg.speed}x)`}
                isSame={seg.speed === prevSeg.speed}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => updateSegment(seg.id, { speed: nextSeg.speed })}
                title={`Apply speed from Seg ${segIndex + 2} (${nextSeg.speed}x)`}
                label={`Next (${nextSeg.speed}x)`}
                isSame={seg.speed === nextSeg.speed}
              />
            )}
            <span className="pk-value ml-1" style={{ color: seg.speed !== 1 ? "#0070f3" : "#888" }}>{seg.speed.toFixed(2)}x</span>
          </div>
        </div>
        <input
          type="range"
          min={0.25}
          max={3}
          step={0.05}
          value={seg.speed}
          onChange={(e) => updateSegment(seg.id, { speed: Number(e.target.value) })}
          className="pk-range flex-1"
          disabled={exportProgress !== null}
          aria-label="Video speed"
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[0.5, 1, 1.5, 2].map((v) => (
            <button
              key={v}
              onClick={() => updateSegment(seg.id, { speed: v })}
              disabled={exportProgress !== null}
              className="pk-seg"
              data-active={seg.speed === v}
            >
              {v}x
            </button>
          ))}
        </div>
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>0.25x–3x · affects preview & export · cam+screen synced</p>
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
                title={`Apply aspect from Seg ${segIndex} (${prevSeg.aspectPreset})`}
                label={`Prev (${prevSeg.aspectPreset === "source" ? "Fit" : prevSeg.aspectPreset})`}
                isSame={seg.aspectPreset === prevSeg.aspectPreset}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => setAspectPreset(nextSeg.aspectPreset)}
                title={`Apply aspect from Seg ${segIndex + 2} (${nextSeg.aspectPreset})`}
                label={`Next (${nextSeg.aspectPreset === "source" ? "Fit" : nextSeg.aspectPreset})`}
                isSame={seg.aspectPreset === nextSeg.aspectPreset}
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
              data-active={seg.aspectPreset === preset}
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
                  title={`Apply camera position & size from Seg ${segIndex}`}
                  label="Match prev"
                  isSame={isSameFacecam(seg.facecam, prevSeg.facecam)}
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
                  title={`Apply camera position & size from Seg ${segIndex + 2}`}
                  label="Match next"
                  isSame={isSameFacecam(seg.facecam, nextSeg.facecam)}
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
              // Keep the bubble pinned to whichever edge it is nearest as it grows.
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
              const active = (seg.facecam.shape ?? "square") === s;
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
                title={`Apply background theme from Seg ${segIndex}`}
                label="Match prev"
                isSame={isSameBackground(seg.background, prevSeg.background)}
              />
            )}
            {nextSeg && (
              <MatchClipButton
                direction="next"
                onClick={() => stageBackground(nextSeg.background)}
                title={`Apply background theme from Seg ${segIndex + 2}`}
                label="Match next"
                isSame={isSameBackground(seg.background, nextSeg.background)}
              />
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const isActive =
              t.bg.kind === "gradient"
                // Both stops must match: Vercel and Ocean share their first one.
                ? seg.background.kind === "gradient" &&
                  (seg.background as { stops: [string, string] }).stops[0] === t.bg.stops![0] &&
                  (seg.background as { stops: [string, string] }).stops[1] === t.bg.stops![1]
                : seg.background.kind === "solid" && (seg.background as { color: string }).color === t.bg.color;
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
        <p className="pk-help mt-2" style={{ fontSize: 11 }}>Applies to stage background behind video. Staged, commit to keep.</p>
      </div>
    </div>
  );
}
