import { describe, it, expect, vi } from "vitest";
import { draw3x3GridOverlay } from "./probe";

function makeMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("Probe Snapshot & 3x3 Grid Overlay", () => {
  it("draws 3x3 alphanumeric grid lines and badges without throwing", () => {
    const ctx = makeMockCtx();
    expect(() => draw3x3GridOverlay(ctx, 960, 540)).not.toThrow();
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
