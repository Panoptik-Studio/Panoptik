/**
 * OWNER: DEV B — CaptionsPanel.
 * Vercel card-soft style: white card, hairline, pill buttons (black→blue hover).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { extractMono16k } from "@/lib/audio16k";
import { postProcessCaptions } from "@/lib/captionChunker";

export function CaptionsPanel() {
  const project = useProjectStore((s) => s.project);
  const stageCaptions = useProjectStore((s) => s.stageCaptions);
  const clearStagedCaptions = useProjectStore((s) => s.clearStagedCaptions);
  const whisperProgress = useProjectStore((s) => s.whisperProgress);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Transcription runs a Whisper model; leaving it running after the panel is
  // gone pins hundreds of megabytes and keeps burning CPU.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );
  const progress = localProgress ?? whisperProgress;

  const handleGenerate = useCallback(async () => {
    if (!project) return;
    setLocalProgress(0); setError(null);
    try {
      let audioBuffer: AudioBuffer | null = null;
      try {
        const { engine } = await import("@/lib/engineProvider");
        audioBuffer = await engine.getAudioBuffer(project);
      } catch {
        try {
          const response = await fetch(project.clip.src);
          const arrayBuf = await response.arrayBuffer();
          const ctx = new AudioContext();
          try {
            audioBuffer = await ctx.decodeAudioData(arrayBuf);
          } finally {
            // Every AudioContext holds an audio thread until closed.
            void ctx.close();
          }
        } catch { /* no audio */ }
      }
      if (!audioBuffer) { setError("No audio track found in clip."); setLocalProgress(null); return; }
      const pcm = await extractMono16k(audioBuffer);
      const workerCode = `
        let transcriber = null;
        self.onmessage = async (e) => {
          if (e.data.type !== 'transcribe' || !e.data.audio) return;
          try {
            if (!transcriber) {
              const { pipeline } = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
              transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'progress', progress: p.progress }); } });
            }
            self.postMessage({ type: 'progress', progress: -1 });
            const out = await transcriber(e.data.audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
            self.postMessage({ type: 'result', captions: out.chunks.map((c) => ({ text: String(c.text).trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.5 })) });
          } catch (err) { self.postMessage({ type: 'error', error: String(err) }); }
        };
      `;
      const blob = new Blob([workerCode], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);
      // The Worker keeps its own copy of the script once constructed, so the
      // URL can go immediately rather than leaking one per run.
      URL.revokeObjectURL(workerUrl);
      workerRef.current = worker;
      worker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "progress") setLocalProgress(msg.progress);
        if (msg.type === "result") { stageCaptions(postProcessCaptions(msg.captions)); setLocalProgress(null); worker.terminate(); workerRef.current = null; }
        if (msg.type === "error") { setError(msg.error); setLocalProgress(null); worker.terminate(); workerRef.current = null; }
      };
      worker.postMessage({ type: "transcribe", audio: pcm });
    } catch (err) { setError(String(err)); setLocalProgress(null); }
  }, [project, stageCaptions]);

  if (!project)
    return (
      <div className="pk-panel">
        <h3 className="pk-panel-title mb-1">Captions</h3>
        <p className="pk-help">Import a clip to generate captions from its audio.</p>
      </div>
    );

  const stagedCaptions = project.stagedCaptions;
  const committedCaptions = project.captions;

  return (
    <div className="pk-panel">
      <h3 className="pk-panel-title mb-2">Captions</h3>
      <div className="flex gap-2">
        <button
          onClick={handleGenerate}
          disabled={progress !== null}
          className="pk-btn pk-btn-primary pk-btn-sm"
        >
          {progress !== null ? (progress === -1 ? "Transcribing…" : `Loading ${Math.round(progress)}%`) : "Generate Captions"}
        </button>
        {stagedCaptions.length > 0 && (
          <button onClick={clearStagedCaptions} className="rounded-full border bg-white px-3 py-1.5 text-xs font-medium transition-colors" style={{ borderColor: "#ebebeb", color: "#171717" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#0070f3"; e.currentTarget.style.color = "#0070f3"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#ebebeb"; e.currentTarget.style.color = "#171717"; }}>
            Clear
          </button>
        )}
      </div>

      {error && <p className="mt-2 rounded-md border bg-[#f7d4d6] px-2.5 py-1.5 text-xs" style={{ borderColor: "#ee0000", color: "#c50000" }}>{error}</p>}

      {progress !== null && progress > 0 && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "#ebebeb" }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(progress, 100)}%`, background: "#0070f3" }} />
        </div>
      )}

      {stagedCaptions.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="font-mono text-[10px] tracking-widest" style={{ color: "#0070f3" }}>{stagedCaptions.length} STAGED · PENDING COMMIT</p>
          {stagedCaptions.slice(0, 5).map((c, i) => (
            <div key={`staged-${i}`} className="rounded-md border bg-[#fafafa] px-2.5 py-1.5 text-xs" style={{ borderColor: "#ebebeb", color: "#171717" }}>
              <span className="font-mono text-[10px]" style={{ color: "#0070f3" }}>{c.start.toFixed(1)}s</span> {c.text}
            </div>
          ))}
          {stagedCaptions.length > 5 && <p className="font-mono text-[10px]" style={{ color: "#888" }}>+{stagedCaptions.length - 5} more</p>}
        </div>
      )}

      {committedCaptions.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="font-mono text-[10px] tracking-widest" style={{ color: "#888" }}>{committedCaptions.length} COMMITTED</p>
          {committedCaptions.slice(0, 3).map((c, i) => (
            <div key={`committed-${i}`} className="rounded-md border bg-white px-2.5 py-1.5 text-xs" style={{ borderColor: "#ebebeb", color: "#4d4d4d" }}>
              <span className="font-mono text-[10px]" style={{ color: "#888" }}>{c.start.toFixed(1)}s</span> {c.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
