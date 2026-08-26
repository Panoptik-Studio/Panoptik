/**
 * OWNER: DEV A. Single registration entry point.
 * editor/page.tsx calls this in a mount effect and unregisterAllTools() on cleanup.
 */
import { registerEditingTools } from "./tools-b";
import { registerEngineTools } from "./tools-a";

export { unregisterAllTools } from "./lifecycle";

export function registerAllTools(): void {
  registerEngineTools();
  registerEditingTools();
}
