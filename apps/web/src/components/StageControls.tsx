/**
 * StageControls — padding resizer + beautiful themes + aspect.
 * Vercel card-soft style, pill controls black→blue hover.
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
  const stagePadding = useProjectStore((s) => s.stagePadding);
  const setStagePadding = useProjectStore((s) => s.setStagePadding);
  const stageBackground = useProjectStore((s) => s.stageBackground);
  const setBackground = useProjectStore((s) => s.setBackground);
  const setAspectPreset = useProjectStore((s) => s.setAspectPreset);
  const setFacecam = useProjectStore((s) => s.setFacecam);

  const camHeightFraction = (size: number) =>
    project ? (size * (project.clip.width / project.clip.height)) / CAMERA_ASPECT : size;

  if (!project) {
    return (
      <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
        <h3 className="mb-1 text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>Stage</h3>
        <p className="font-mono text-[11px]" style={{ color: "#888" }}>Load a clip to style the stage.</p>
      </div>
    );
  }

  return (
    <div className="border-b bg-white p-4" style={{ borderColor: "#ebebeb" }}>
      <h3 className="mb-3 text-[13px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>Stage</h3>

      {/* Padding resizer — reduces white space around black video container, and black letterboxing is via aspect */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium" style={{ color: "#4d4d4d" }}>Padding</span>
          <span className="font-mono text-[11px]" style={{ color: "#0070f3" }}>{stagePadding}px</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStagePadding(stagePadding - 4)} className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-xs transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>−</button>
          <input type="range" min={0} max={48} step={4} value={stagePadding} onChange={(e) => setStagePadding(Number(e.target.value))} className="h-1 flex-1 appearance-none rounded-full accent-[#171717]" style={{ background: "#ebebeb" }} />
          <button onClick={() => setStagePadding(stagePadding + 4)} className="flex h-7 w-7 items-center justify-center rounded-full border bg-white text-xs transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>+</button>
        </div>
        <p className="mt-1 font-mono text-[10px]" style={{ color: "#888" }}>White space around video. 0 = edge-to-edge.</p>
      </div>

      {/* Aspect — controls black letterboxing */}
      <div className="mb-4">
        <p className="mb-1.5 text-xs font-medium" style={{ color: "#4d4d4d" }}>Aspect</p>
        <div className="grid grid-cols-4 gap-1.5">
          {(["16:9", "9:16", "1:1", "4:3"] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => setAspectPreset(preset)}
              className={`rounded-full border px-2 py-1.5 text-[11px] font-medium transition-colors ${project.aspectPreset === preset ? "text-white" : "bg-white"}`}
              style={{
                background: project.aspectPreset === preset ? "#171717" : "#ffffff",
                borderColor: project.aspectPreset === preset ? "#171717" : "#ebebeb",
                color: project.aspectPreset === preset ? "#ffffff" : "#4d4d4d",
              }}
              onMouseEnter={(e) => { if (project.aspectPreset !== preset) { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; } else e.currentTarget.style.background = "#0070f3"; }}
              onMouseLeave={(e) => { if (project.aspectPreset !== preset) { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#4d4d4d"; } else e.currentTarget.style.background = "#171717"; }}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {/* Camera — only meaningful once a recording carried a facecam track */}
      {project.facecam.src && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium" style={{ color: "#4d4d4d" }}>Camera</span>
            <span className="font-mono text-[11px]" style={{ color: "#888" }}>
              {Math.round(project.facecam.size * 100)}%
            </span>
          </div>
          <div className="mb-2 grid grid-cols-4 gap-1.5">
            {CAMERA_CORNERS.map((c) => {
              const size = project.facecam.size;
              const target = c.at(size, camHeightFraction(size));
              const active =
                Math.abs(project.facecam.x - target.x) < 0.02 &&
                Math.abs(project.facecam.y - target.y) < 0.02;
              return (
                <button
                  key={c.id}
                  onClick={() => setFacecam(target)}
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={active}
                  className="rounded-lg border px-2 py-1.5 text-[11px] font-medium transition-colors"
                  style={{
                    background: active ? "#171717" : "#ffffff",
                    borderColor: active ? "#171717" : "#ebebeb",
                    color: active ? "#ffffff" : "#4d4d4d",
                  }}
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
            value={project.facecam.size}
            onChange={(e) => {
              const size = Number(e.target.value);
              // Keep the bubble pinned to whichever edge it is nearest as it grows.
              const hFrac = camHeightFraction(size);
              setFacecam({
                size,
                x: project.facecam.x > 0.5 ? 0.97 - size : project.facecam.x,
                y: project.facecam.y > 0.5 ? 0.97 - hFrac : project.facecam.y,
              });
            }}
            className="h-1 w-full appearance-none rounded-full accent-[#171717]"
            style={{ background: "#ebebeb" }}
            aria-label="Camera size"
          />
          <div className="mt-2 flex gap-1.5">
            {(["circle", "square"] as const).map((s) => {
              const active = (project.facecam.shape ?? "square") === s;
              return (
                <button
                  key={s}
                  onClick={() => setFacecam({ shape: s })}
                  className="flex-1 rounded-full border px-2 py-1 text-[11px] font-medium capitalize transition-colors"
                  style={{
                    background: active ? "#171717" : "#ffffff",
                    borderColor: active ? "#171717" : "#ebebeb",
                    color: active ? "#ffffff" : "#4d4d4d",
                  }}
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
        <p className="mb-1.5 text-xs font-medium" style={{ color: "#4d4d4d" }}>Theme</p>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const isActive =
              t.bg.kind === "gradient"
                // Both stops must match: Vercel and Ocean share their first one.
                ? project.background.kind === "gradient" &&
                  (project.background as { stops: [string, string] }).stops[0] === t.bg.stops![0] &&
                  (project.background as { stops: [string, string] }).stops[1] === t.bg.stops![1]
                : project.background.kind === "solid" && (project.background as { color: string }).color === t.bg.color;
            return (
              <button
                key={t.name}
                onClick={() => {
                  if (t.bg.kind === "gradient") stageBackground({ kind: "gradient", stops: t.bg.stops! });
                  else if (t.bg.kind === "solid") stageBackground({ kind: "solid", color: t.bg.color! });
                  else stageBackground({ kind: "solid", color: "#ffffff" });
                }}
                className={`group relative overflow-hidden rounded-lg border p-2 text-left transition-all ${isActive ? "ring-2" : "hover:scale-[1.02]"}`}
                style={{ borderColor: isActive ? "#0070f3" : "#ebebeb", background: "#ffffff", boxShadow: isActive ? "0 0 0 1px #0070f3" : "0 1px 2px rgba(0,0,0,0.04)" }}
              >
                <div className="h-10 rounded-md border" style={{ background: t.swatch, borderColor: "rgba(0,0,0,0.06)" }} />
                <p className="mt-1.5 text-center font-mono text-[10px] font-medium tracking-wide" style={{ color: isActive ? "#0070f3" : "#4d4d4d" }}>{t.name}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-[10px]" style={{ color: "#888" }}>Applies to stage background behind video. Staged, commit to keep.</p>
      </div>
    </div>
  );
}
