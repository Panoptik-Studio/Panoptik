import { describe, expect, it } from "vitest";

/**
 * Mirrors the guards in tools-b.ts. Tool arguments come from a model, so they
 * are untrusted: the JSON schema advertises bounds but nothing enforces them.
 */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const clampNumber = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const safeColor = (v: unknown, fallback: string) =>
  typeof v === "string" && HEX_COLOR.test(v.trim()) ? v.trim() : fallback;

describe("clampNumber", () => {
  it("keeps in-range values", () => {
    expect(clampNumber(2.2, 1, 5, 2.2)).toBe(2.2);
  });

  it("clamps out-of-range values instead of trusting the schema", () => {
    expect(clampNumber(1e9, 1, 5, 2.2)).toBe(5);
    expect(clampNumber(-40, 1, 5, 2.2)).toBe(1);
  });

  it("falls back for NaN, Infinity and non-numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity, "3", null, undefined, {}]) {
      expect(clampNumber(bad, 1, 5, 2.2)).toBe(2.2);
    }
  });
});

describe("safeColor", () => {
  it("accepts six-digit hex", () => {
    expect(safeColor("#0070f3", "#000000")).toBe("#0070f3");
    expect(safeColor("  #ABCDEF  ", "#000000")).toBe("#ABCDEF");
  });

  it("rejects anything that could smuggle CSS into the stage gradient", () => {
    // These land in an inline style and in canvas fillStyle.
    for (const bad of [
      "url(https://evil.example/pixel)",
      "red; background-image: url(https://evil.example/x)",
      "#fff",
      "rgb(0,0,0)",
      "expression(alert(1))",
      "",
      null,
      42,
    ]) {
      expect(safeColor(bad, "#000000")).toBe("#000000");
    }
  });
});

describe("proposal bounds", () => {
  const MAX_PROPOSALS = 200;

  it("caps how many keyframes one call can stage", () => {
    const timestamps = Array.from({ length: 10_000 }, (_, i) => i * 0.001);
    const accepted = timestamps
      .filter((t) => Number.isFinite(t) && t >= 0 && t <= 10)
      .slice(0, MAX_PROPOSALS);
    expect(accepted).toHaveLength(MAX_PROPOSALS);
  });

  it("drops non-finite and out-of-range timestamps", () => {
    const duration = 10;
    const accepted = ([NaN, Infinity, -1, 5, 11, 0] as number[]).filter(
      (t) => typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= duration,
    );
    expect(accepted).toEqual([5, 0]);
  });
});
