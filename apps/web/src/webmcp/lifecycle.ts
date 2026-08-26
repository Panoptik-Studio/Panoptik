/**
 * OWNER: DEV A — ROADMAP-A.md Task 5.1 (deliver by Day 5, 09:30 — B is blocked on it).
 * Wraps document.modelContext.registerTool with AbortController lifecycle and
 * dispatches window CustomEvent "webmcp-tool-call" (detail: TraceEntry) after
 * every execute. Import "@mcp-b/global" as polyfill fallback when wiring up.
 */

export type ToolConfig = {
  name: string;
  description: string; // positive language: what it CAN do + when to use it
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

export function registerToolWithLifecycle(_cfg: ToolConfig): void {
  throw new Error("TODO(DEV-A): implement in ROADMAP-A Task 5.1");
}

export function unregisterAllTools(): void {
  throw new Error("TODO(DEV-A): implement in ROADMAP-A Task 5.1");
}
