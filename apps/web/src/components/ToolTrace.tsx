/**
 * OWNER: DEV B — ToolTrace panel.
 * Listens for "webmcp-tool-call" CustomEvents dispatched by lifecycle.ts.
 * Shows last 10 entries: tool name, duration, truncated JSON output.
 */
"use client";

import { useEffect, useState } from "react";

type TraceEntry = {
  timestamp: number;
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
};

export function ToolTrace() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TraceEntry>).detail;
      setEntries((prev) => [...prev.slice(-9), detail]);
    };
    window.addEventListener(
      "webmcp-tool-call",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "webmcp-tool-call",
        handler as EventListener,
      );
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-900 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-300">
        Agent Tool Trace
      </h3>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="max-w-[200px] text-center text-xs text-gray-600">
            No agent calls yet. Open in ChatGPT browser
            and ask the agent to edit your project.
          </p>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {entries
            .slice()
            .reverse()
            .map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="rounded bg-gray-800 p-2"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs text-green-400">
                    {entry.toolName}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {entry.durationMs}ms
                  </span>
                </div>
                <pre className="overflow-x-auto text-[10px] text-gray-400">
                  {JSON.stringify(
                    entry.output,
                    null,
                    2,
                  ).slice(0, 200)}
                </pre>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
