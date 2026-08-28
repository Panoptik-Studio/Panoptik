/**
 * StageControls — padding resizer + beautiful themes + aspect.
 * Vercel card-soft style, pill controls black→blue hover.
 * Every setting edits the SELECTED segment (store actions all target it); a pill
 * strip switches which segment the panel edits.
 */
"use client";

import { useProjectStore } from "@/stores/projectStore";

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
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>Settings apply to the selected segment; others keep their own.</p>
      </div>

      {/* Padding resizer — reduces white space around black video container, and black letterboxing is via aspect */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Padding</span>
          <span className="pk-value" style={{ color: "#0070f3" }}>{seg.stagePadding}px</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStagePadding(seg.stagePadding - 4)} className="pk-icon-btn h-7 w-7 text-xs">−</button>
          <input type="range" min={0} max={48} step={4} value={seg.stagePadding} onChange={(e) => setStagePadding(Number(e.target.value))} className="pk-range flex-1" />
          <button onClick={() => setStagePadding(seg.stagePadding + 4)} className="pk-icon-btn h-7 w-7 text-xs">+</button>
        </div>
        <p className="pk-help mt-1.5" style={{ fontSize: 11 }}>White space around video. 0 = edge-to-edge.</p>
      </div>

      {/* Speed — per selected segment, affects cam+screen together, preview & export */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="pk-label">Speed</span>
          <span className="pk-value" style={{ color: seg.speed !== 1 ? "#0070f3" : "#888" }}>{seg.speed.toFixed(2)}x</span>
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

      {/* Aspect — controls black letterboxing */}
      <div className="mb-4">
        <p className="pk-label mb-1.5">Aspect</p>
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
            <span className="pk-help">
              {Math.round(seg.facecam.size * 100)}%
            </span>
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
        <p className="pk-label mb-1.5">Theme</p>
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
