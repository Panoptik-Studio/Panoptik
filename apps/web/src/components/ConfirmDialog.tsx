/**
 * OWNER: DEV B — ROADMAP-B.md Task 4.2.
 * Confirmation dialog: portal-rendered modal, Escape/backdrop → false, focus trap.
 * Used by both WebMCP tools and plain UI buttons.
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type ConfirmRequest = {
  message: string;
  diff?: {
    added: string[];
    removed: string[];
    totalCount: number;
  };
  resolve: (result: boolean) => void;
};

export function ConfirmDialog() {
  const [request, setRequest] =
    useState<ConfirmRequest | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ConfirmRequest>;
      setRequest(customEvent.detail);
    };
    window.addEventListener(
      "webmcp-confirm",
      handler as EventListener,
    );
    return () =>
      window.removeEventListener(
        "webmcp-confirm",
        handler as EventListener,
      );
  }, []);

  // Focus confirm button on open
  useEffect(() => {
    if (request) {
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
    }
  }, [request]);

  // Escape key
  useEffect(() => {
    if (!request) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        request.resolve(false);
        setRequest(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () =>
      window.removeEventListener("keydown", handler);
  }, [request]);

  const handleConfirm = useCallback(() => {
    if (!request) return;
    request.resolve(true);
    setRequest(null);
  }, [request]);

  const handleCancel = useCallback(() => {
    if (!request) return;
    request.resolve(false);
    setRequest(null);
  }, [request]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleCancel();
      }
    },
    [handleCancel],
  );

  if (!request) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div
        ref={dialogRef}
        className="mx-4 w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6"
        role="dialog"
        aria-modal="true"
      >
        <h3 className="mb-3 text-lg font-semibold text-white">
          Confirm Action
        </h3>
        <p className="mb-4 text-sm text-gray-300 whitespace-pre-wrap">
          {request.message}
        </p>

        {request.diff &&
          request.diff.totalCount > 0 && (
            <div className="mb-4 max-h-48 overflow-y-auto rounded bg-gray-800 p-3">
              <p className="mb-2 text-[10px] text-gray-500">
                Staged changes (
                {request.diff.totalCount}):
              </p>
              <ul className="space-y-1">
                {request.diff.added.map((item, i) => (
                  <li
                    key={i}
                    className="font-mono text-xs text-green-400"
                  >
                    + {item}
                  </li>
                ))}
                {request.diff.removed.map((item, i) => (
                  <li
                    key={i}
                    className="font-mono text-xs text-red-400"
                  >
                    - {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

        <div className="flex justify-end gap-2">
          <button
            onClick={handleCancel}
            className="rounded px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            ref={confirmBtnRef}
            onClick={handleConfirm}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
