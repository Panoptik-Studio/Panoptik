/**
 * OWNER: DEV B — ROADMAP-B.md Task 4.2.
 * ex-modal-card — white, rounded lg, Level 5 shadow, pill buttons (black→blue).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmRequest = {
  message: string;
  diff?: { added: string[]; removed: string[]; totalCount: number };
  resolve: (result: boolean) => void;
  /** Set here so the caller can tell a dialog was mounted to answer it. */
  claimed?: boolean;
};

export function ConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConfirmRequest>).detail;
      detail.claimed = true;
      setRequest(detail);
    };
    window.addEventListener("webmcp-confirm", handler as EventListener);
    return () => window.removeEventListener("webmcp-confirm", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!request) return;
    const id = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [request]);

  // Unmounting with a question still open denies it rather than stranding the
  // caller on a promise that can no longer be answered.
  const pendingRef = useRef<ConfirmRequest | null>(null);
  pendingRef.current = request;
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  useEffect(() => {
    if (!request) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { request.resolve(false); setRequest(null); }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0]!, last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [request]);

  const handleConfirm = useCallback(() => { if (!request) return; request.resolve(true); setRequest(null); }, [request]);
  const handleCancel = useCallback(() => { if (!request) return; request.resolve(false); setRequest(null); }, [request]);
  const handleBackdrop = useCallback((e: React.MouseEvent) => { if (e.target === e.currentTarget) handleCancel(); }, [handleCancel]);

  if (!request) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={handleBackdrop}>
      <div ref={dialogRef} className="w-full max-w-md rounded-xl border bg-white p-6" style={{ borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.08) inset, 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)" }} role="dialog" aria-modal="true">
        <h3 className="mb-2 text-[16px] font-semibold" style={{ color: "#171717", letterSpacing: "-0.02em" }}>Confirm action</h3>
        <p className="mb-4 whitespace-pre-wrap text-sm leading-6" style={{ color: "#4d4d4d" }}>{request.message}</p>
        {request.diff && request.diff.totalCount > 0 && (
          <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border bg-[#fafafa] p-3" style={{ borderColor: "#ebebeb" }}>
            <p className="mb-2 font-mono text-[10px] tracking-widest" style={{ color: "#888" }}>STAGED CHANGES ({request.diff.totalCount})</p>
            <ul className="space-y-1">
              {request.diff.added.map((item, i) => <li key={i} className="font-mono text-xs" style={{ color: "#0070f3" }}>+ {item}</li>)}
              {request.diff.removed.map((item, i) => <li key={i} className="font-mono text-xs" style={{ color: "#ee0000" }}>− {item}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={handleCancel} className="pk-btn pk-btn-ghost pk-btn-md">
            Cancel
          </button>
          <button ref={confirmBtnRef} onClick={handleConfirm} className="pk-btn pk-btn-primary pk-btn-md">
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
