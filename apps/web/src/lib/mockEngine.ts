/**
 * OWNER: DEV B — placeholder renderer used until the Day-3 integration swap.
 * Full drawing behavior per ROADMAP-B.md "Your test fixture" section.
 * A owns lib/engineProvider.ts (the switch); never edit that file.
 */
import type { Project } from "@panoptik/schema";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";

type Ctx = CanvasRenderingContext2D;

export const mockEngine = {
  loadClip: async (file: File): Promise<Project> => {
    const p = mockProject();
    p.media = { src: URL.createObjectURL(file), duration: 15, width: 1920, height: 1080 };
    p.segments[0]!.srcEnd = p.media.duration;
    return p;
  },
  prepareFrame: async () => {},
  renderFrame: (ctx: Ctx, project: Project, t: number) => {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    // The mock always renders its single (first) segment.
    const seg = project.segments[0];

    // Background fill
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, w, h);
    if (seg?.background.kind === "gradient" && seg.background.stops.length >= 2) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, seg.background.stops[0]!);
      g.addColorStop(1, seg.background.stops[1]!);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else if (seg?.background.kind === "solid") {
      ctx.fillStyle = seg.background.color;
      ctx.fillRect(0, 0, w, h);
    }

    // Zoom focal markers: green committed, amber ghost
    [
      ...(seg?.zoomPoints ?? []),
      ...(seg?.stagedZoomPoints ?? []),
    ].forEach((zp) => {
      if (t >= zp.t && t <= zp.t + zp.dur) {
        ctx.strokeStyle = zp.staged ? "#f59e0b" : "#10b981";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(
          zp.to.x * w,
          zp.to.y * h,
          24 * zp.to.scale,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
    });

    // Text overlays
    [
      ...(seg?.textOverlays ?? []),
      ...(seg?.stagedTextOverlays ?? []),
    ].forEach((to) => {
      if (t >= to.timestamp && t <= to.timestamp + 3) {
        ctx.fillStyle = to.staged ? "#f59e0b" : "#ffffff";
        ctx.font = "bold 32px sans-serif";
        ctx.textAlign = "center";
        const y =
          to.position === "top"
            ? 60
            : to.position === "bottom"
              ? h - 60
              : h / 2;
        ctx.fillText(to.text, w / 2, y);
      }
    });

    // Captions
    [
      ...(seg?.captions ?? []),
      ...(seg?.stagedCaptions ?? []),
    ].forEach((c) => {
      if (t >= c.start && t <= c.end) {
        ctx.fillStyle = "#ffffff";
        ctx.font = "28px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(c.text, w / 2, h - 40);
      }
    });

    // Timestamp HUD
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "20px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`t=${t.toFixed(1)}s`, 20, 30);
  },
  loadRecording: async (): Promise<Project> => ({
    ...mockProject(),
  }),
  getAudioBuffer: async () => null,
  exportProject: async () =>
    new Blob(["mock"], { type: "video/mp4" }),
};
