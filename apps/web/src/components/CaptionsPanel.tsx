/**
 * OWNER: DEV B — CaptionsPanel.
 * Generate button → progress bar → staged captions list.
 * Connects to whisperWorker for transcription.
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { extractMono16k } from "@/lib/audio16k";
import { postProcessCaptions } from "@/lib/captionChunker";

export function CaptionsPanel() {
  // Selectors only — a full-store subscription re-renders this 60x/s in playback.
  const project = useProjectStore((s) => s.project);
  const stageCaptions = useProjectStore((s) => s.stageCaptions);
  const clearStagedCaptions = useProjectStore((s) => s.clearStagedCaptions);
  const whisperProgress = useProjectStore((s) => s.whisperProgress);
  const [localProgress, setLocalProgress] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Use local progress when generating locally, store progress when agent-triggered
  const progress = localProgress ?? whisperProgress;

  const handleGenerate = useCallback(async () => {
    if (!project) return;
    setLocalProgress(0);
    setError(null);

    try {
      // Get audio buffer — try engine first, fallback to AudioContext
      let audioBuffer: AudioBuffer | null = null;

      try {
        const { engine } = await import(
          "@/lib/engineProvider"
        );
        audioBuffer = await engine.getAudioBuffer(project);
      } catch {
        // Fallback: decode from blob URL
        try {
          const response = await fetch(project.clip.src);
          const arrayBuf = await response.arrayBuffer();
          const ctx = new AudioContext();
          audioBuffer = await ctx.decodeAudioData(arrayBuf);
          ctx.close();
        } catch {
          // no audio
        }
      }

      if (!audioBuffer) {
        setError("No audio track found in clip.");
        setLocalProgress(null);
        return;
      }

      // Resample to 16kHz mono
      const pcm = await extractMono16k(audioBuffer);

      // Spawn worker — use a simple wrapper that defers @xenova/transformers
      const workerCode = `
        let transcriber = null;
        self.onmessage = async (e) => {
          if (e.data.type !== 'transcribe' || !e.data.audio) return;
          try {
            if (!transcriber) {
              const { pipeline } = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
              transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
                progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'progress', progress: p.progress }); },
              });
            }
            self.postMessage({ type: 'progress', progress: -1 });
            const out = await transcriber(e.data.audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
            self.postMessage({ type: 'result', captions: out.chunks.map((c) => ({ text: String(c.text).trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.5 })) });
          } catch (err) {
            self.postMessage({ type: 'error', error: String(err) });
          }
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      const worker = new Worker(URL.createObjectURL(blob));
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setLocalProgress(msg.progress);
        }
        if (msg.type === "result") {
          stageCaptions(postProcessCaptions(msg.captions));
          setLocalProgress(null);
          worker.terminate();
          workerRef.current = null;
        }
        if (msg.type === "error") {
          setError(msg.error);
          setLocalProgress(null);
          worker.terminate();
          workerRef.current = null;
        }
      };

      worker.postMessage({
        type: "transcribe",
        audio: pcm,
      });
    } catch (err) {
      setError(String(err));
      setLocalProgress(null);
    }
  }, [project, stageCaptions]);

  if (!project)
    return (
      <div className="border-b border-gray-800 p-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-300">
          Captions
        </h3>
        <p className="text-xs text-gray-500">
          Import a clip to generate captions from its
          audio.
        </p>
      </div>
    );

  const stagedCaptions = project.stagedCaptions;
  const committedCaptions = project.captions;

  return (
    <div className="border-b border-gray-800 p-4">
      <h3 className="mb-2 text-sm font-semibold text-gray-300">
        Captions
      </h3>

      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={progress !== null}
          className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {progress !== null
            ? progress === -1
              ? "Transcribing..."
              : `Loading model... ${Math.round(progress)}%`
            : "Generate Captions"}
        </button>
        {stagedCaptions.length > 0 && (
          <button
            onClick={clearStagedCaptions}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-600"
          >
            Clear Staged
          </button>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-400">
          {error}
        </p>
      )}

      {progress !== null && progress > 0 && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}

      {/* Staged captions */}
      {stagedCaptions.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] text-amber-400">
            {stagedCaptions.length} staged (pending commit)
          </p>
          {stagedCaptions.slice(0, 5).map((c, i) => (
            <div
              key={`staged-${i}`}
              className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
            >
              <span className="font-mono text-[10px] text-amber-500">
                {c.start.toFixed(1)}s
              </span>{" "}
              {c.text}
            </div>
          ))}
          {stagedCaptions.length > 5 && (
            <p className="text-[10px] text-gray-500">
              +{stagedCaptions.length - 5} more
            </p>
          )}
        </div>
      )}

      {/* Committed captions */}
      {committedCaptions.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] text-gray-500">
            {committedCaptions.length} committed
          </p>
          {committedCaptions.slice(0, 3).map((c, i) => (
            <div
              key={`committed-${i}`}
              className="rounded px-2 py-1 text-xs text-gray-400"
            >
              <span className="font-mono text-[10px] text-gray-600">
                {c.start.toFixed(1)}s
              </span>{" "}
              {c.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
