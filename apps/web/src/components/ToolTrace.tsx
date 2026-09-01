"use client";

import { useEffect, useState } from "react";

type TraceEntry = { timestamp: number; toolName: string; input: unknown; output: unknown; durationMs: number; };

export function ToolTrace() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<TraceEntry>).detail;
      setEntries((prev) => [...prev.slice(-9), detail]);
    };
    window.addEventListener("webmcp-tool-call", handler as EventListener);
    return () => window.removeEventListener("webmcp-tool-call", handler as EventListener);
  }, []);

  return (
    <div className="flex flex-col bg-white p-5">
      <h3 className="pk-eyebrow mb-3">Agent tool trace</h3>
      {entries.length === 0 ? (
        <div className="flex items-center justify-center rounded-[12px] border px-4 py-8" style={{ borderColor: "#ebebeb", background: "#f8f8f8" }}>
          <p className="max-w-[200px] text-center text-xs leading-5" style={{ color: "#888" }}>No agent calls yet. Open in ChatGPT browser and ask the agent to edit your project.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.slice().reverse().map((entry, i) => (
            <div key={`${entry.timestamp}-${i}`} className="rounded-lg border bg-white p-2.5" style={{ borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.02) inset, 0 1px 2px rgba(0,0,0,0.04)" }}>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs font-medium" style={{ color: "#0070f3" }}>{entry.toolName}</span>
                <span className="font-mono text-[10px]" style={{ color: "#888" }}>{entry.durationMs}ms</span>
              </div>
              <pre className="overflow-x-auto rounded bg-[#fafafa] p-2 font-mono text-[10px] leading-4" style={{ color: "#4d4d4d", border: "1px solid #ebebeb" }}>{JSON.stringify(entry.output, null, 2).slice(0, 280)}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
