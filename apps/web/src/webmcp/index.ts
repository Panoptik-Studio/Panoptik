/**
 * WebMCP Tool Suite Entrypoint.
 * Mounts in editor/page.tsx on startup.
 */

import { registerEditingTools } from "./tools-b";
import { registerEngineTools } from "./tools-a";
import { registerBatchTools } from "./tools-batch";

export { unregisterAllTools, getRegisteredTools, registerToolWithLifecycle } from "./lifecycle";
export { setAnalysisCache } from "./tools-batch";
export { snapAndRebaseEditOps } from "./snapping";
export { executeBatchOps } from "./batchExecutor";
export type { ToolConfig, TraceEntry } from "./lifecycle";
export type { EditOp, SnappedBatchResult, SnappedOp } from "./snapping";

export function registerAllTools(): void {
  registerEngineTools();
  registerEditingTools();
  registerBatchTools();
}

