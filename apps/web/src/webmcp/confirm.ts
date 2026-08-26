/**
 * OWNER: DEV B — ROADMAP-B.md Task 5.1 (deliver by Day 5, 09:30 — A is blocked on it).
 * Custom-event + portal pattern: dispatches "webmcp-confirm", ConfirmDialog resolves.
 * Escape / backdrop click → false.
 */
export function showConfirmDialog(_opts: {
  message: string;
  diff?: { added: string[]; removed: string[]; totalCount: number };
}): Promise<boolean> {
  return Promise.reject(new Error("TODO(DEV-B): implement in ROADMAP-B Task 5.1"));
}
