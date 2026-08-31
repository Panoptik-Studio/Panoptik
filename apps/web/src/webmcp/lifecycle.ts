/**
 * WebMCP Tool Registration Lifecycle.
 * Wraps document.modelContext.registerTool with AbortController lifecycle,
 * provides global fallback tool discovery, and dispatches "webmcp-tool-call" events.
 */

export type ToolConfig = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: any) => Promise<unknown>;
};

export type TraceEntry = {
  timestamp: number;
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
};

// Track active AbortControllers so unregisterAllTools() cleanly cleans up.
const activeControllers: AbortController[] = [];
const registeredToolMap = new Map<string, ToolConfig>();

declare global {
  interface Document {
    modelContext?: {
      registerTool: (config: ToolConfig & { signal?: AbortSignal }) => void;
      unregisterTool?: (name: string) => void;
    };
  }
  interface Window {
    modelContext?: {
      registerTool: (config: ToolConfig & { signal?: AbortSignal }) => void;
      unregisterTool?: (name: string) => void;
    };
    __panoptik_webmcp_tools?: Record<string, ToolConfig>;
    __panoptik_call_tool?: (name: string, input?: any) => Promise<unknown>;
  }
}

export function registerToolWithLifecycle(cfg: ToolConfig): AbortController {
  const controller = new AbortController();
  activeControllers.push(controller);
  registeredToolMap.set(cfg.name, cfg);

  // Maintain window helper for manual testing / agent bridges
  if (typeof window !== "undefined") {
    window.__panoptik_webmcp_tools = window.__panoptik_webmcp_tools || {};
    window.__panoptik_webmcp_tools[cfg.name] = cfg;
    window.__panoptik_call_tool = async (name: string, input: any = {}) => {
      const tool = registeredToolMap.get(name);
      if (!tool) throw new Error(`WebMCP Tool "${name}" not found.`);
      return tool.execute(input);
    };
  }

  const wrappedExecute = async (input: any) => {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    let output: unknown;
    try {
      output = await cfg.execute(input);
      return output;
    } catch (err) {
      output = { error: err instanceof Error ? err.message : String(err) };
      return output;
    } finally {
      const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
      const durationMs = Math.round(t1 - t0);
      if (typeof window !== "undefined") {
        const trace: TraceEntry = {
          timestamp: Date.now(),
          toolName: cfg.name,
          input,
          output,
          durationMs,
        };
        window.dispatchEvent(
          new CustomEvent<TraceEntry>("webmcp-tool-call", { detail: trace }),
        );
      }
    }
  };

  const toolWithLifecycle = {
    ...cfg,
    execute: wrappedExecute,
    signal: controller.signal,
  };

  // Register on document.modelContext or window.modelContext if available (e.g. ChatGPT / WebMCP host environments)
  if (typeof document !== "undefined" && typeof document.modelContext?.registerTool === "function") {
    try {
      const ret = document.modelContext.registerTool(toolWithLifecycle) as unknown;
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch((e) => {
          console.warn(`[WebMCP] document.modelContext.registerTool rejected for "${cfg.name}":`, e);
        });
      }
    } catch (e) {
      console.warn(`[WebMCP] Failed to register tool "${cfg.name}" on document.modelContext:`, e);
    }
  } else if (typeof window !== "undefined" && typeof window.modelContext?.registerTool === "function") {
    try {
      const ret = window.modelContext.registerTool(toolWithLifecycle) as unknown;
      if (ret && typeof (ret as Promise<unknown>).then === "function") {
        (ret as Promise<unknown>).catch((e) => {
          console.warn(`[WebMCP] window.modelContext.registerTool rejected for "${cfg.name}":`, e);
        });
      }
    } catch (e) {
      console.warn(`[WebMCP] Failed to register tool "${cfg.name}" on window.modelContext:`, e);
    }
  }

  controller.signal.addEventListener("abort", () => {
    registeredToolMap.delete(cfg.name);
    if (typeof window !== "undefined" && window.__panoptik_webmcp_tools) {
      delete window.__panoptik_webmcp_tools[cfg.name];
    }
  });

  return controller;
}

export function unregisterAllTools(): void {
  for (const c of activeControllers) {
    if (!c.signal.aborted) {
      c.abort();
    }
  }
  activeControllers.length = 0;
  registeredToolMap.clear();
  if (typeof window !== "undefined") {
    window.__panoptik_webmcp_tools = {};
  }
}

export function getRegisteredTools(): ToolConfig[] {
  return Array.from(registeredToolMap.values());
}
