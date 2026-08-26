/**
 * OWNER: DEV B — RecordModal.
 * Source-picker explainer, webcam preview tile, Start/Stop.
 * Opens via window CustomEvent "open-record-modal".
 */
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useProjectStore } from "@/stores/projectStore";

type RecordingState = "idle" | "recording" | "stopping";

type RecordingHandles = {
  screenStream: MediaStream;
  facecamStream: MediaStream;
  stop: () => Promise<{
    screenBlob: Blob;
    facecamBlob: Blob;
  }>;
};

async function startRecording(): Promise<RecordingHandles> {
  const { startRecording: startRec } = await import("@panoptik/engine");
  return startRec();
}

export function RecordModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] =
    useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const handlesRef = useRef<Awaited<
    ReturnType<typeof startRecording>
  > | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const { setProject } = useProjectStore();

  // Listen for open event from Toolbar
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(
      "open-record-modal",
      handler,
    );
    return () =>
      window.removeEventListener(
        "open-record-modal",
        handler,
      );
  }, []);

  // Start webcam preview when modal opens
  useEffect(() => {
    if (!isOpen || state !== "idle") return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 320, height: 180 }, audio: false })
      .then((s) => {
        stream = s;
        previewStreamRef.current = s;
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = s;
        }
      })
      .catch(() => {
        // Webcam not available — preview stays blank
      });
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    };
  }, [isOpen, state]);

  const handleStart = useCallback(async () => {
    try {
      setError(null);
      // Stop preview stream before starting real recording
      previewStreamRef.current?.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
      setState("recording");
      handlesRef.current = await startRecording();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : String(err),
      );
      setState("idle");
    }
  }, []);

  const handleStop = useCallback(async () => {
    if (!handlesRef.current) return;
    setState("stopping");
    try {
      const { screenBlob, facecamBlob } =
        await handlesRef.current.stop();
      console.log("[Record] blobs", { screen: `${screenBlob.type} ${screenBlob.size} bytes`, facecam: `${facecamBlob.type} ${facecamBlob.size} bytes` });
      if (screenBlob.size < 1024) {
        throw new Error(`Recording produced an empty file (${screenBlob.size} bytes). Try recording for 3+ seconds and ensure you shared a screen/window.`);
      }
      const { engine } = await import(
        "@/lib/engineProvider"
      );
      const project = await engine.loadRecording(
        screenBlob,
        facecamBlob.size > 0 ? facecamBlob : null,
        null,
      );
      setProject(project);
      setIsOpen(false);
    } catch (err) {
      console.error("[Record] loadRecording failed", err);
      setError(
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setState("idle");
      handlesRef.current = null;
    }
  }, [setProject]);

  const handleClose = useCallback(() => {
    if (state === "recording") return; // don't close while recording
    setIsOpen(false);
    setError(null);
  }, [state]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg border border-gray-700 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Record Screen
        </h2>

        {state === "idle" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              This will capture your screen and optionally
              your webcam + microphone.
            </p>
            <div className="overflow-hidden rounded-lg bg-gray-800">
              <video
                ref={previewVideoRef}
                autoPlay
                muted
                playsInline
                className="mx-auto w-full max-w-[320px] rounded-lg bg-black"
              />
            </div>
            <div className="rounded-lg bg-gray-800 p-4">
              <p className="text-xs text-gray-500">
                You&apos;ll be asked to select which screen
                or window to share. The webcam and mic
                will activate automatically.
              </p>
            </div>
            {error && (
              <p className="text-xs text-red-400">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={handleClose}
                className="rounded px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleStart}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Start Recording
              </button>
            </div>
          </div>
        )}

        {state === "recording" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
              <p className="text-sm text-gray-300">
                Recording in progress...
              </p>
            </div>
            <p className="text-xs text-gray-500">
              When you&apos;re done, click Stop to end the
              recording and import it into the editor.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleStop}
                className="rounded bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-200"
              >
                Stop & Import
              </button>
            </div>
          </div>
        )}

        {state === "stopping" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-400">
              Processing recording...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
