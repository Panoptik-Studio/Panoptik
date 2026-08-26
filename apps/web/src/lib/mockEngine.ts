/**
 * OWNER: DEV B — placeholder renderer used until the Day-3 integration swap.
 * Full drawing behavior per ROADMAP-B.md "Your test fixture" section.
 * A owns lib/engineProvider.ts (the switch); never edit that file.
 */
import type { Project } from "@panoptik/schema";
import { mockProject } from "../../../../packages/engine/src/test-fixtures";

type Ctx = CanvasRenderingContext2D;

export const mockEngine = {
  loadClip: async (file: File): Promise<Project> => ({
    ...mockProject(),
    clip: { src: URL.createObjectURL(file), duration: 15, width: 1920, height: 1080 },
  }),
  prepareFrame: async () => {},
  renderFrame: (ctx: Ctx, project: Project, t: number) => {
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    if (project.background.kind === "gradient") {
      const g = ctx.createLinearGradient(0, 0, ctx.canvas.width, ctx.canvas.height);
      g.addColorStop(0, project.background.stops[0]);
      g.addColorStop(1, project.background.stops[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else if (project.background.kind === "solid") {
      ctx.fillStyle = project.background.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    ctx.fillStyle = "#e5e7eb";
    ctx.font = "20px monospace";
    ctx.fillText(`t=${t.toFixed(1)}s`, 20, 30);
  },
  loadRecording: async (): Promise<Project> => ({ ...mockProject() }),
  getAudioBuffer: async () => null,
  exportProject: async () => new Blob(["mock"], { type: "video/mp4" }),
};
