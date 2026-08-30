/**
 * WebMCP Tool Suite Entrypoint.
 * Mounts in editor/page.tsx on startup.
 */

import { registerEditingTools } from "./tools-b";
import { registerEngineTools } from "./tools-a";

export { unregisterAllTools, getRegisteredTools, registerToolWithLifecycle } from "./lifecycle";
export type { ToolConfig, TraceEntry } from "./lifecycle";

export function registerAllTools(): void {
  registerEngineTools();
  registerEditingTools();
}
