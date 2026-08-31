import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampNumber, safeColor } from "./tools-b";
import { getRegisteredTools, registerAllTools, unregisterAllTools } from "./index";
import { useProjectStore } from "../stores/projectStore";
import type { Project } from "@panoptik/schema";

const sampleProject: Project = {
  id: "test-proj",
  media: [{ id: "m1", src: "blob:test", duration: 10, width: 1920, height: 1080 }],
  clickLog: [
    { t: 1.5, x: 0.2, y: 0.3, type: "click" },
    { t: 4.2, x: 0.7, y: 0.8, type: "click" },
  ],
  segments: [
    {
      id: "seg-1",
      mediaId: "m1",
      srcStart: 0,
      srcEnd: 5,
      speed: 1,
      stagePadding: 0,
      aspectPreset: "16:9",
      background: { kind: "solid", color: "#000000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [],
    },
    {
      id: "seg-2",
      mediaId: "m1",
      srcStart: 5,
      srcEnd: 10,
      speed: 1,
      stagePadding: 0,
      aspectPreset: "16:9",
      background: { kind: "solid", color: "#000000" },
      facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
      zoomPoints: [],
      stagedZoomPoints: [],
      textOverlays: [],
      stagedTextOverlays: [],
    },
  ],
  audioTracks: [
    {
      id: "track-1",
      kind: "music",
      name: "Background Music",
      src: "blob:audio",
      duration: 10,
      startT: 0,
      volume: 0.8,
    },
  ],
};

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

describe("WebMCP Tool Suite & Lifecycle", () => {
  beforeEach(() => {
    unregisterAllTools();
    useProjectStore.setState({
      project: JSON.parse(JSON.stringify(sampleProject)),
      selectedSegmentId: "seg-1",
      selectedSegmentIds: ["seg-1"],
    });
  });

  it("registers all WebMCP tools and unregisters on cleanup", () => {
    registerAllTools();
    const tools = getRegisteredTools();
    expect(tools.length).toBeGreaterThanOrEqual(10);

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("get_project_state");
    expect(toolNames).toContain("list_scenes");
    expect(toolNames).toContain("get_click_log");
    expect(toolNames).toContain("export_clip");
    expect(toolNames).toContain("propose_zoom_points");
    expect(toolNames).toContain("add_text_overlay");
    expect(toolNames).toContain("set_background");
    expect(toolNames).toContain("split_segment");
    expect(toolNames).toContain("set_speed");
    expect(toolNames).toContain("set_aspect");
    expect(toolNames).toContain("commit_staged_changes");
    expect(toolNames).toContain("discard_staged_changes");

    unregisterAllTools();
    expect(getRegisteredTools()).toHaveLength(0);
  });

  it("get_project_state returns accurate project summary", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "get_project_state")!;
    const state = (await tool.execute({})) as Record<string, any>;

    expect(state.durationSeconds).toBe(10);
    expect(state.segmentCount).toBe(2);
    expect(state.clickLogCount).toBe(2);
    expect(state.audioTracks).toHaveLength(1);
    expect(state.aspectPreset).toBe("16:9");
  });

  it("list_scenes returns segments with chronological timeline bounds", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "list_scenes")!;
    const res = (await tool.execute({})) as Record<string, any>;

    expect(res.totalScenes).toBe(2);
    expect(res.scenes[0].timelineStart).toBe(0);
    expect(res.scenes[0].timelineEnd).toBe(5);
    expect(res.scenes[1].timelineStart).toBe(5);
    expect(res.scenes[1].timelineEnd).toBe(10);
  });

  it("get_click_log returns recorded interaction points", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "get_click_log")!;
    const res = (await tool.execute({})) as Record<string, any>;

    expect(res.count).toBe(2);
    expect(res.clicks[0].t).toBe(1.5);
    expect(res.suggestedZoomTimestamps).toContain(1.5);
  });

  it("propose_zoom_points stages ghost zoom keyframes", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "propose_zoom_points")!;
    const res = (await tool.execute({ timestamps: [2.0, 3.5], scale: 2.5 })) as Record<string, any>;

    expect(res.stagedCount).toBe(2);

    const seg = useProjectStore.getState().project!.segments[0]!;
    expect(seg.zoomPoints).toHaveLength(2);
    expect(seg.zoomPoints[0]!.to.scale).toBe(2.5);
  });

  it("add_text_overlay stages pending annotations", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "add_text_overlay")!;
    const res = (await tool.execute({ text: "Demo step 1", timestamp: 1.0, position: "top" })) as Record<string, any>;

    expect(res.staged).toBe(true);

    const seg = useProjectStore.getState().project!.segments[0]!;
    expect(seg.textOverlays).toHaveLength(1);
    expect(seg.textOverlays[0]!.text).toBe("Demo step 1");
    expect(seg.textOverlays[0]!.position).toBe("top");
  });

  it("set_background stages background gradient", async () => {
    registerAllTools();
    const tool = getRegisteredTools().find((t) => t.name === "set_background")!;
    const res = (await tool.execute({ kind: "gradient", stops: ["#007cf0", "#7928ca"] })) as Record<string, any>;

    expect(res.staged).toBe(true);
    expect(res.background.kind).toBe("gradient");
  });

  it("discard_staged_changes clears staged proposals", async () => {
    registerAllTools();
    const discardTool = getRegisteredTools().find((t) => t.name === "discard_staged_changes")!;
    const res = (await discardTool.execute({})) as Record<string, any>;

    expect(res.discarded).toBe(true);
  });

  it("dispatches webmcp-tool-call trace events on tool execution", async () => {
    registerAllTools();
    const traceHandler = vi.fn();
    const eventTarget = typeof window !== "undefined" ? window : (globalThis as unknown as EventTarget);
    if (typeof eventTarget?.addEventListener === "function") {
      eventTarget.addEventListener("webmcp-tool-call", traceHandler as EventListener);
    }

    const tool = getRegisteredTools().find((t) => t.name === "get_click_log")!;
    await tool.execute({});

    if (typeof eventTarget?.addEventListener === "function") {
      expect(traceHandler).toHaveBeenCalledTimes(1);
      const event = traceHandler.mock.calls[0]![0] as CustomEvent;
      expect(event.detail.toolName).toBe("get_click_log");
      expect(event.detail.durationMs).toBeGreaterThanOrEqual(0);
      eventTarget.removeEventListener("webmcp-tool-call", traceHandler as EventListener);
    }
  });
});
