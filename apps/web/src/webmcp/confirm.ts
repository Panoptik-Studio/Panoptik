/**
 * OWNER: DEV B — ROADMAP-B.md Task 5.1.
 * Custom-event + portal pattern: dispatches "webmcp-confirm",
 * ConfirmDialog.tsx resolves via the promise.
 * Escape / backdrop click → false.
 */

export function showConfirmDialog(opts: {
  message: string;
  diff?: {
    added: string[];
    removed: string[];
    totalCount: number;
  };
}): Promise<boolean> {
  return new Promise((resolve) => {
    const event = new CustomEvent("webmcp-confirm", {
      detail: {
        message: opts.message,
        diff: opts.diff,
        resolve,
      },
    });
    window.dispatchEvent(event);
  });
}
