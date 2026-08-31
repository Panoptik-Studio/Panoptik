"use client";

import React, { useEffect, useState } from "react";
import { getSessionInfo } from "../lib/ai/authClient";
import { DEFAULT_GROQ_KEY } from "../lib/ai/providers";

interface AISettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AISettingsModal({ isOpen, onClose }: AISettingsModalProps) {
  const [session, setSession] = useState(getSessionInfo());
  const [airGapped, setAirGapped] = useState(false);
  const [groqKey, setGroqKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSession(getSessionInfo());
      setAirGapped(localStorage.getItem("panoptik:air_gapped") === "true");
      try {
        const byok = JSON.parse(localStorage.getItem("panoptik:byok_keys") || "{}");
        setGroqKey(byok.groq || DEFAULT_GROQ_KEY);
      } catch {
        setGroqKey(DEFAULT_GROQ_KEY);
      }
    }
  }, [isOpen]);

  const onSave = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("panoptik:air_gapped", airGapped ? "true" : "false");
      const byok = {
        groq: groqKey.trim() || DEFAULT_GROQ_KEY,
      };
      localStorage.setItem("panoptik:byok_keys", JSON.stringify(byok));
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 600);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-[16px] border border-pk-hairline bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-pk-hairline pb-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0070f3]/10 text-[#0070f3]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <h3 className="pk-panel-title text-base font-semibold">AI Settings & Transcription</h3>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-pk-faint hover:bg-pk-surface-soft hover:text-pk-ink transition-colors">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="mt-4 space-y-3.5 text-xs">
          {/* Air-Gapped Mode Toggle */}
          <div className="flex items-center justify-between rounded-[12px] border border-pk-hairline bg-pk-surface-soft p-3.5">
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-pk-ink">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pk-muted">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Air-Gapped / Offline-Only Mode</span>
              </div>
              <p className="text-pk-muted text-[11px] mt-0.5">Strictly blocks all network API calls and uses local offline processing only.</p>
            </div>
            <input
              type="checkbox"
              checked={airGapped}
              onChange={(e) => setAirGapped(e.target.checked)}
              className="h-4 w-4 rounded border-pk-hairline text-[#0070f3] focus:ring-[#0070f3]"
            />
          </div>

          {/* Groq Whisper v3 Turbo Section */}
          <div className="rounded-[12px] border border-[#0070f3]/25 bg-[#0070f3]/5 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-pk-ink">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0070f3]">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                <span>Groq Whisper Large v3 Turbo</span>
              </div>
              <span className="pk-chip pk-chip-blue text-[10px]">
                28,800 sec/day Free
              </span>
            </div>
            <p className="text-pk-muted text-[11px] mt-1">
              Ultra-fast speech transcription (~2.5s) with word-level timestamps on Groq&apos;s free tier.
            </p>

            <div className="mt-2.5">
              <label className="block text-pk-body mb-1 font-medium text-[11px]">Groq API Key (BYOK):</label>
              <input
                type="password"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                className="w-full rounded-lg border border-pk-hairline bg-white px-3 py-1.5 text-xs text-pk-ink font-mono outline-none focus:border-[#0070f3] focus:ring-1 focus:ring-[#0070f3]"
              />
            </div>
          </div>

          {/* BYO-LLM WebMCP Notice */}
          <div className="rounded-[12px] border border-pk-hairline bg-pk-surface-soft p-3">
            <div className="flex items-center gap-1.5 font-semibold text-pk-ink">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pk-muted">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" />
                <line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" />
                <line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" />
                <line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" />
                <line x1="1" y1="14" x2="4" y2="14" />
              </svg>
              <span>Bring Your Own LLM (WebMCP)</span>
            </div>
            <p className="text-pk-muted text-[11px] mt-1">
              When running inside ChatGPT, Codex, or Claude, the AI editor reasons directly over the video digest via WebMCP tools.
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2 border-t border-pk-hairline pt-3">
          <button
            onClick={onClose}
            className="pk-btn pk-btn-ghost pk-btn-sm"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            className="pk-btn pk-btn-primary pk-btn-sm"
          >
            {saved ? "Saved" : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
