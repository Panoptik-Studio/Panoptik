/**
 * Dedicated Captions & Subtitles Inspector Panel.
 * Automatically transcribes audio in ~2s via Groq Whisper Large v3 Turbo,
 * formats words into natural subtitle phrases, and syncs timestamped caption overlays
 * to the preview canvas and video export.
 */
"use client";

import React, { useState, useEffect } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { decodeViaAudioContext } from "@panoptik/engine";
import type { TextOverlay } from "@panoptik/schema";
import {
  CAPTION_PRESETS,
  packStreamWordsAdditively,
  transcribeTrackAudio,
} from "@/lib/captions";
import type { CaptionStylePreset, CaptionTrackWord } from "@/lib/captions";

// Re-exported so existing imports from this panel keep working.
export type { CaptionStylePreset };
export { CAPTION_PRESETS };

const LANGUAGE_OPTIONS = [
  { value: "hinglish", label: "Hinglish (Mixed Hindi + English)" },
  { value: "auto", label: "Auto Detect (Multilingual Slices)" },
  { value: "hi", label: "Hindi (हिन्दी)" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish (Español)" },
  { value: "fr", label: "French (Français)" },
  { value: "de", label: "German (Deutsch)" },
  { value: "ja", label: "Japanese (日本語)" },
  { value: "zh", label: "Chinese (中文)" },
];

export function CaptionsPanel() {
  const project = useProjectStore((s) => s.project);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const currentTime = useProjectStore((s) => s.currentTime);
  const seek = useProjectStore((s) => s.seek);
  const addTextOverlay = useProjectStore((s) => s.addTextOverlay);
  const updateTextOverlay = useProjectStore((s) => s.updateTextOverlay);
  const removeTextOverlay = useProjectStore((s) => s.removeTextOverlay);
  const setSegmentTextOverlays = useProjectStore((s) => s.setSegmentTextOverlays);

  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeStatus, setTranscribeStatus] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>("viral");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("hinglish");
  const [includeSpeakerLabels, setIncludeSpeakerLabels] = useState<boolean>(true);
  const [speakerFontSize, setSpeakerFontSize] = useState<number>(36);
  const [screenFontSize, setScreenFontSize] = useState<number>(28);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentSegment =
    project?.segments.find((s) => s.id === selectedSegmentId) ?? project?.segments[0];

  const captions = currentSegment
    ? currentSegment.textOverlays.filter((t) => t.kind === "caption")
    : [];

  // Sync initial sizes from existing segment captions if present
  useEffect(() => {
    if (!currentSegment) return;
    const speakerCap = currentSegment.textOverlays.find(
      (c) => c.kind === "caption" && (c.speaker === "Speaker" || c.text?.startsWith("Speaker:") || (!c.speaker && !c.text?.startsWith("Screen:")))
    );
    if (speakerCap?.fontSize) {
      setSpeakerFontSize(speakerCap.fontSize);
    }
    const screenCap = currentSegment.textOverlays.find(
      (c) => c.kind === "caption" && (c.speaker === "Screen" || c.text?.startsWith("Screen:"))
    );
    if (screenCap?.fontSize) {
      setScreenFontSize(screenCap.fontSize);
    }
  }, [currentSegment?.id]);

  const handleSpeakerSizeChange = (newSize: number) => {
    setSpeakerFontSize(newSize);
    if (!currentSegment) return;
    const updated = currentSegment.textOverlays.map((c) => {
      if (c.kind !== "caption") return c;
      const isSpeaker =
        c.speaker === "Speaker" ||
        c.text?.startsWith("Speaker:") ||
        (!c.speaker && !c.text?.startsWith("Screen:"));
      if (isSpeaker) {
        return { ...c, fontSize: newSize };
      }
      return c;
    });
    setSegmentTextOverlays(currentSegment.id, updated);
  };

  const handleScreenSizeChange = (newSize: number) => {
    setScreenFontSize(newSize);
    if (!currentSegment) return;
    const updated = currentSegment.textOverlays.map((c) => {
      if (c.kind !== "caption") return c;
      const isScreen = c.speaker === "Screen" || c.text?.startsWith("Screen:");
      if (isScreen) {
        return { ...c, fontSize: newSize };
      }
      return c;
    });
    setSegmentTextOverlays(currentSegment.id, updated);
  };

  if (!project) {
    return (
      <div className="pk-panel space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0070f3]/10 text-[#0070f3]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="M7 15h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z" />
            </svg>
          </div>
          <h3 className="pk-panel-title">Captions & Subtitles</h3>
        </div>
        <p className="pk-help">Import or record a video clip to generate timestamped captions.</p>
      </div>
    );
  }

  // ── Auto-generate Captions with Separate STT Requests ──
  const handleAutoGenerate = async () => {
    if (!project || !currentSegment) return;
    setIsTranscribing(true);
    setErrorMsg(null);

    try {
      setTranscribeStatus("Decoding separate audio tracks (Camera/Mic & Screen)...");

      const media = project.media.find((m) => m.id === currentSegment.mediaId) ?? project.media[0];
      const screenSrc = media?.src;
      const speakerSrc = currentSegment.facecam?.src || project.audioSrc;

      const decodeSrc = async (src: string | null | undefined, label: string): Promise<AudioBuffer | null> => {
        if (!src) return null;
        try {
          const res = await fetch(src);
          if (!res.ok) return null;
          const blob = await res.blob();
          if (blob.size === 0) return null;
          const buf = await decodeViaAudioContext(blob);
          if (buf && buf.duration > 0) {
            console.log(`[Captions] Decoded ${label} audio buffer: ${buf.duration.toFixed(2)}s, ${buf.numberOfChannels}ch`);
            return buf;
          }
        } catch (e) {
          console.warn(`[Captions] Failed to decode ${label} audio`, e);
        }
        return null;
      };

      const [decodedSpeaker, decodedScreen] = await Promise.all([
        decodeSrc(speakerSrc, "camera/mic"),
        decodeSrc(screenSrc, "screen"),
      ]);

      if (!decodedSpeaker && !decodedScreen) {
        throw new Error("No decodable audio track found in screen or camera recording.");
      }

      setTranscribeStatus("Sending separate STT API requests for Camera/Mic & Screen...");

      // Fire separate STT API requests in parallel!
      const trackTasks: { label: "Speaker" | "Screen"; promise: Promise<CaptionTrackWord[]> }[] = [];

      if (decodedSpeaker) {
        trackTasks.push({
          label: "Speaker",
          promise: transcribeTrackAudio(decodedSpeaker, "Speaker", selectedLanguage, (s) => setTranscribeStatus(s)),
        });
      }

      if (decodedScreen && decodedScreen !== decodedSpeaker) {
        trackTasks.push({
          label: "Screen",
          promise: transcribeTrackAudio(decodedScreen, "Screen", selectedLanguage, (s) => setTranscribeStatus(s)),
        });
      }

      const results = await Promise.all(trackTasks.map((t) => t.promise));
      const preset = CAPTION_PRESETS.find((p) => p.id === selectedPresetId) ?? CAPTION_PRESETS[0]!;
      const generatedOverlays: TextOverlay[] = [];

      trackTasks.forEach((task, idx) => {
        const words = results[idx] ?? [];
        if (words.length > 0) {
          const fontSize = task.label === "Speaker" ? speakerFontSize : screenFontSize;
          const streamOverlays = packStreamWordsAdditively(
            words,
            task.label,
            preset,
            includeSpeakerLabels,
            fontSize,
          );
          generatedOverlays.push(...streamOverlays);
        }
      });

      if (generatedOverlays.length === 0) {
        setErrorMsg("No spoken words detected in the audio tracks. You can add subtitles manually using \"+ Add at Playhead\".");
        setTranscribeStatus(null);
        return;
      }

      // Sort all generated caption overlays chronologically
      generatedOverlays.sort((a, b) => a.timestamp - b.timestamp);

      // Preserve non-caption text overlays, replacing only captions
      const nonCaptionOverlays = currentSegment.textOverlays.filter((t) => t.kind !== "caption");
      setSegmentTextOverlays(currentSegment.id, [...nonCaptionOverlays, ...generatedOverlays]);
      setTranscribeStatus(null);
    } catch (err: any) {
      console.warn("Caption generation error:", err);
      const msg = err.message || "Failed to generate captions.";
      if (msg.includes("No active Panoptik Pro session or BYOK API key")) {
        setErrorMsg("Groq API key required for transcription. Click 'AI Settings' below to configure your key.");
      } else {
        setErrorMsg(msg);
      }
      setTranscribeStatus(null);
    } finally {
      setIsTranscribing(false);
    }
  };

  // ── Apply Style Preset to All Captions ──
  const applyPreset = (preset: CaptionStylePreset) => {
    if (!currentSegment) return;
    setSelectedPresetId(preset.id);

    const updated = currentSegment.textOverlays.map((c) => {
      if (c.kind !== "caption") return c; // keep non-caption text overlays intact
      const isScreen = c.speaker === "Screen" || c.text?.startsWith("Screen:");
      const resolvedFontSize = isScreen ? screenFontSize : speakerFontSize;

      return {
        ...c,
        fontSize: resolvedFontSize,
        fontFamily: preset.fontFamily,
        fontWeight: preset.fontWeight,
        color: preset.color,
        backgroundColor: preset.backgroundColor,
        backgroundPadding: preset.backgroundPadding,
        borderRadius: preset.borderRadius,
        borderWidth: preset.borderWidth,
        borderColor: preset.borderColor,
        shadowColor: preset.shadowColor,
        shadowBlur: preset.shadowBlur,
        animation: c.animation === "none" ? "none" : preset.animation,
      };
    });

    setSegmentTextOverlays(currentSegment.id, updated);
  };

  // ── Add Manual Caption at Playhead ──
  const handleAddManualCaption = () => {
    if (!currentSegment) return;
    const preset = CAPTION_PRESETS.find((p) => p.id === selectedPresetId) ?? CAPTION_PRESETS[0]!;

    const relTime = Math.max(
      0,
      Math.min(currentSegment.srcEnd - currentSegment.srcStart, currentTime),
    );

    addTextOverlay({
      kind: "caption",
      speaker: "Speaker",
      text: "New Subtitle",
      timestamp: Number(relTime.toFixed(2)),
      duration: 2.0,
      position: "custom",
      x: 0.5,
      y: 0.89,
      fontSize: speakerFontSize,
      fontFamily: preset.fontFamily,
      fontWeight: preset.fontWeight,
      color: preset.color,
      backgroundColor: preset.backgroundColor,
      backgroundPadding: preset.backgroundPadding,
      borderRadius: preset.borderRadius,
      borderWidth: preset.borderWidth,
      borderColor: preset.borderColor,
      shadowColor: preset.shadowColor,
      shadowBlur: preset.shadowBlur,
      animation: preset.animation,
    });
  };

  // ── Clear All Captions ──
  const handleClearAll = () => {
    if (!currentSegment) return;
    if (confirm("Clear all captions for this clip?")) {
      const nonCaptionOverlays = currentSegment.textOverlays.filter((t) => t.kind !== "caption");
      setSegmentTextOverlays(currentSegment.id, nonCaptionOverlays);
    }
  };

  return (
    <div className="pk-panel space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#0070f3]/10 text-[#0070f3]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="M7 15h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z" />
              </svg>
            </div>
            <h3 className="pk-panel-title">Captions & Subtitles</h3>
          </div>
          <span className="pk-chip">
            {captions.length} {captions.length === 1 ? "subtitle" : "subtitles"}
          </span>
        </div>
        <p className="pk-help mt-1">
          Auto-transcribe speech into timestamped captions that animate on the canvas at 60fps.
        </p>
      </div>

      {/* Whisper AI Auto Transcribe Card */}
      <div className="rounded-[13px] border border-pk-hairline bg-pk-surface-soft p-3 space-y-2.5 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0070f3]">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            <span className="text-xs font-semibold text-pk-ink">Speech-to-Text AI</span>
          </div>
          <span className="pk-chip pk-chip-blue text-[10px]">
            Groq Whisper ~2s
          </span>
        </div>

        {/* Language Selector */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <label className="text-[11px] font-medium text-pk-body flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-pk-muted">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>Audio Language</span>
          </label>
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            disabled={isTranscribing}
            className="rounded-lg border border-pk-hairline bg-white px-2 py-1 text-[11px] font-medium text-pk-ink outline-none focus:border-[#0070f3] cursor-pointer max-w-[170px]"
          >
            {LANGUAGE_OPTIONS.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Speaker Labeling Toggle */}
        <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-pk-hairline/60">
          <label className="text-[11px] font-medium text-pk-body flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeSpeakerLabels}
              onChange={(e) => setIncludeSpeakerLabels(e.target.checked)}
              disabled={isTranscribing}
              className="h-3.5 w-3.5 rounded border-pk-hairline text-[#0070f3] focus:ring-[#0070f3]"
            />
            <span className="flex items-center gap-1">
              <span>Speaker Prefix</span>
              <span className="pk-chip text-[9px] py-0 px-1 font-mono font-bold text-pk-ink">Speaker:</span>
            </span>
          </label>
          <span className="text-[10px] text-pk-muted">
            {includeSpeakerLabels ? "Enabled" : "Off"}
          </span>
        </div>

        <button
          onClick={handleAutoGenerate}
          disabled={isTranscribing || !currentSegment}
          className="pk-btn pk-btn-primary pk-btn-md w-full"
        >
          {isTranscribing ? (
            <>
              <svg className="h-3.5 w-3.5 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>{transcribeStatus || "Transcribing speech..."}</span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
              <span>Auto-Generate Subtitles</span>
            </>
          )}
        </button>

        {errorMsg && (
          <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
            <div className="flex items-start gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-red-600">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="flex-1">{errorMsg}</span>
            </div>
            <div className="flex items-center gap-2 pt-1 border-t border-red-200/60 text-[11px]">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("open-ai-settings-modal"))}
                className="inline-flex items-center gap-1 font-semibold text-red-800 hover:text-red-950 underline"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>AI Settings & Keys</span>
              </button>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-zinc-500 hover:text-zinc-800 ml-auto"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Style Presets */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="pk-label">Caption Style Presets</span>
          <span className="pk-value">
            {CAPTION_PRESETS.find((p) => p.id === selectedPresetId)?.name}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_PRESETS.map((preset) => {
            const isSelected = selectedPresetId === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset)}
                className={`group relative flex flex-col justify-between rounded-[13px] border p-2.5 text-left transition-all cursor-pointer ${
                  isSelected
                    ? "border-[#0070f3] bg-[#0070f3]/5 shadow-sm ring-1.5 ring-[#0070f3]"
                    : "border-pk-hairline bg-white hover:border-[#0070f3]/60 hover:bg-pk-surface-soft/60"
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1.5">
                  <span className="text-[12px] font-semibold text-pk-ink truncate">
                    {preset.name}
                  </span>
                  {isSelected ? (
                    <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0070f3] text-white shadow-xs">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-zinc-500 uppercase">
                      {preset.badge}
                    </span>
                  )}
                </div>

                {/* Visual Typography & Pill Preview */}
                <div
                  className="mt-2.5 flex h-9 w-full items-center justify-center overflow-hidden rounded-[8px] px-2 relative"
                  style={{
                    background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.35)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: preset.fontFamily,
                      color: preset.color,
                      backgroundColor: preset.backgroundColor === "transparent" ? "transparent" : preset.backgroundColor,
                      padding: preset.backgroundColor === "transparent" ? "0px" : "3px 8px",
                      borderRadius: `${preset.borderRadius ? Math.min(preset.borderRadius, 6) : 0}px`,
                      border:
                        preset.borderWidth && preset.borderColor && preset.backgroundColor !== "transparent"
                          ? `${preset.borderWidth}px solid ${preset.borderColor}`
                          : undefined,
                      textShadow:
                        preset.id === "outline"
                          ? "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px rgba(0,0,0,0.8)"
                          : preset.id === "electric"
                          ? "0 0 8px rgba(56, 189, 248, 0.9)"
                          : preset.shadowColor
                          ? `0 1px ${preset.shadowBlur ? preset.shadowBlur / 2 : 2}px ${preset.shadowColor}`
                          : undefined,
                      fontSize: preset.id === "outline" ? "14px" : "12px",
                      fontWeight:
                        preset.fontWeight === "normal"
                          ? 400
                          : preset.fontWeight === "900" || preset.fontWeight === "800"
                          ? 800
                          : 700,
                      letterSpacing: preset.id === "outline" ? "0.04em" : "normal",
                    }}
                    className="truncate max-w-full text-center leading-none select-none"
                  >
                    Aa Subtitle
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Group Caption Sizing Controls */}
      <div className="rounded-[13px] border border-pk-hairline bg-pk-surface-soft p-3 space-y-3 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#0070f3]">
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" x2="15" y1="20" y2="20" />
              <line x1="12" x2="12" y1="4" y2="20" />
            </svg>
            <span className="text-xs font-semibold text-pk-ink">Caption Sizing by Group</span>
          </div>
          <span className="pk-chip text-[10px]">Independent</span>
        </div>

        <div className="space-y-3 pt-0.5">
          {/* Speaker Captions Size */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-pk-ink flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0070f3]" />
                <span>Speaker Caption Size</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-pk-body bg-white px-2 py-0.5 rounded border border-pk-hairline">
                {speakerFontSize}px
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={18}
                max={72}
                step={2}
                value={speakerFontSize}
                onChange={(e) => handleSpeakerSizeChange(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-[#0070f3]"
              />
            </div>
          </div>

          {/* Screen Captions Size */}
          <div className="space-y-1.5 pt-2 border-t border-pk-hairline/60">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-pk-ink flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />
                <span>Screen Caption Size</span>
              </span>
              <span className="font-mono text-[11px] font-semibold text-pk-body bg-white px-2 py-0.5 rounded border border-pk-hairline">
                {screenFontSize}px
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={18}
                max={72}
                step={2}
                value={screenFontSize}
                onChange={(e) => handleScreenSizeChange(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleAddManualCaption}
          className="pk-btn pk-btn-ghost pk-btn-sm flex-1"
          title="Add a new subtitle overlay at current playhead position"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Add at {currentTime.toFixed(1)}s</span>
        </button>
        {captions.length > 0 && (
          <button
            onClick={handleClearAll}
            className="pk-btn pk-btn-danger pk-btn-sm"
            title="Clear all captions for this clip"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Clear All</span>
          </button>
        )}
      </div>

      {/* Subtitles Timeline List */}
      <div className="space-y-2 pt-2 border-t border-pk-hairline">
        <div className="flex items-center justify-between">
          <span className="pk-label">Timeline Subtitles ({captions.length})</span>
          {captions.length > 0 && (
            <span className="pk-value text-[10px]">Click timestamp to seek</span>
          )}
        </div>

        {captions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-[12px] border border-dashed border-pk-hairline p-5 text-center bg-pk-surface-soft/40">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-pk-surface-soft text-pk-faint mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="M7 15h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Zm7 0h3a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1Z" />
              </svg>
            </div>
            <p className="text-xs font-medium text-pk-body">No captions added yet</p>
            <p className="text-[11px] text-pk-muted mt-0.5 max-w-[200px]">
              Use &quot;Auto-Generate Subtitles&quot; or &quot;Add at Playhead&quot; to begin.
            </p>
          </div>
        ) : (
          <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1">
            {captions.map((cap) => {
              const start = cap.timestamp;
              const duration = cap.duration ?? 2.0;
              const end = start + duration;
              const isActive = currentTime >= start && currentTime <= end;

              return (
                <div
                  key={cap.id}
                  onClick={() => seek(start)}
                  className={`group relative flex items-start gap-2.5 rounded-[11px] border p-2 text-xs transition-all cursor-pointer ${
                    isActive
                      ? "border-[#0070f3] bg-[#0070f3]/6 shadow-xs ring-1 ring-[#0070f3]/25"
                      : "border-pk-hairline bg-pk-surface-soft/60 hover:border-pk-subtle hover:bg-white"
                  }`}
                >
                  {/* Timestamp Pill / Seek Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      seek(start);
                    }}
                    className={`mt-0.5 flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition-colors shrink-0 ${
                      isActive
                        ? "border-[#0070f3] bg-[#0070f3] text-white"
                        : "border-pk-hairline bg-white text-pk-body hover:border-[#0070f3] hover:text-[#0070f3]"
                    }`}
                    title={`Seek to ${start.toFixed(1)}s`}
                  >
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    <span>{start.toFixed(1)}s</span>
                  </button>

                  {/* Caption Content & Metadata */}
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={cap.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateTextOverlay(cap.id, { text: e.target.value })}
                      className="w-full bg-transparent font-medium text-pk-ink outline-none focus:bg-white focus:ring-1 focus:ring-[#0070f3] focus:px-1.5 rounded transition-all text-xs"
                      placeholder="Subtitle text..."
                    />
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-pk-muted">
                      <span>{duration.toFixed(1)}s duration</span>
                      <span>·</span>
                      <span className="capitalize">{cap.animation ?? "fade"}</span>
                      {cap.position && (
                        <>
                          <span>·</span>
                          <span className="capitalize">{cap.position}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Delete Caption Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTextOverlay(cap.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 flex h-6 w-6 shrink-0 items-center justify-center rounded text-pk-faint hover:bg-red-50 hover:text-red-600 transition-all"
                    title="Delete caption"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
