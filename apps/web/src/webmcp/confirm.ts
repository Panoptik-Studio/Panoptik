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
    // Resolve at most once, and default to "no". If no dialog is mounted to
    // answer, the write must not silently proceed — nor hang the caller
    // forever waiting for a confirmation that can never arrive.
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const event = new CustomEvent("webmcp-confirm", {
      detail: {
        message: opts.message,
        diff: opts.diff,
        resolve: settle,
      },
    });
    window.dispatchEvent(event);

    // dispatchEvent is synchronous, so a mounted dialog has already claimed
    // this by now. Nothing claimed it means nothing can answer.
    if (!(event.detail as { claimed?: boolean }).claimed) {
      settle(false);
    }
  });
}
