"use client";

import React from "react";

interface CloudConsentModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onUseLocal: () => void;
  onCancel: () => void;
  audioSizeMb?: number;
}

export function CloudConsentModal({
  isOpen,
  onConfirm,
  onUseLocal,
  onCancel,
  audioSizeMb = 2.8,
}: CloudConsentModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900 dark:text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Enable Cloud AI for this Project?</h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Sub-second Whisper transcription & AI auto-director</p>
          </div>
        </div>

        <div className="my-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
          <p className="font-medium text-zinc-900 dark:text-white">🔒 Panoptik Privacy Guarantee:</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li><strong>Video frames never leave your device</strong> (100% local WebCodecs rendering).</li>
            <li>Only isolated 16kHz mono audio (~{audioSizeMb.toFixed(1)} MB) is processed via secure zero-retention cloud APIs.</li>
            <li>No data is saved to disk or used for AI model training.</li>
          </ul>
        </div>

        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <button
            onClick={onUseLocal}
            className="rounded-xl border border-zinc-300 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Use Local Offline AI
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl px-3.5 py-2 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
          >
            Enable for this Project
          </button>
        </div>
      </div>
    </div>
  );
}
