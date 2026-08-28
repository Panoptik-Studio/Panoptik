/**
 * OWNER: DEV B — ReshootModal.
 * Dedicated workflow for reshooting / re-recording the facecam (webcam + mic)
 * without re-recording the screen. Plays the canvas timeline in real-time from
 * the current slider/playhead position so the user can narrate along with the screen video.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { projectDuration, startRecording, type RecordingHandles } from "@panoptik/engine";

type RecordingState = "idle" | "countingDown" | "recording" | "stopping";

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

function formatSimpleTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ReshootModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const project = useProjectStore((s) => s.project);
  const currentTime = useProjectStore((s) => s.currentTime);
  const play = useProjectStore((s) => s.play);
  const pause = useProjectStore((s) => s.pause);
  const seek = useProjectStore((s) => s.seek);
  const replaceFacecamMedia = useProjectStore((s) => s.replaceFacecamMedia);

  // Snapshot of timeline coordinate when reshoot is initiated
  const [reshootStartT, setReshootStartT] = useState(0);

  // Hardware devices
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");
  const [micEnabled, setMicEnabled] = useState(true);
  const [isMirrored, setIsMirrored] = useState(true);

  // Teleprompter state
  const [teleOpen, setTeleOpen] = useState(false);
  const [teleText, setTeleText] = useState(
    "Welcome to this demo!\nHere I am explaining the key points while watching the screen playback...\nKeep your eyes on the camera and speak naturally!",
  );
  const [teleSpeed, setTeleSpeed] = useState(1);
  const [telePlaying, setTelePlaying] = useState(false);
  const [teleOffset, setTeleOffset] = useState(0);

  // Recording handles & refs
  const handlesRef = useRef<RecordingHandles | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);
  const livePreviewRef = useRef<HTMLVideoElement | null>(null);
  const hudPreviewRef = useRef<HTMLVideoElement | null>(null);
  const startTimeRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const teleRafRef = useRef<number>(0);

  // Total project duration
  const totalDuration = project ? projectDuration(project) : 0;

  // Listen for open-reshoot-modal event
  useEffect(() => {
    const onOpen = () => {
      // Park start time at current playhead slider position
      const t = useProjectStore.getState().currentTime;
      setReshootStartT(t);
      setIsOpen(true);
      setState("idle");
      setError(null);
      setElapsed(0);
    };
    window.addEventListener("open-reshoot-modal", onOpen);
    return () => window.removeEventListener("open-reshoot-modal", onOpen);
  }, []);

  // Enumerate camera / mic devices
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function getDevices() {
      try {
        const devs = await navigator.mediaDevices?.enumerateDevices?.();
        if (cancelled || !devs) return;
        const video = devs.filter((d) => d.kind === "videoinput");
        const audio = devs.filter((d) => d.kind === "audioinput");
        setCameras(video);
        setMics(audio);
        if (!selectedCam && video[0]) setSelectedCam(video[0].deviceId);
        if (!selectedMic && audio[0]) setSelectedMic(audio[0].deviceId);
      } catch {
        /* ignore */
      }
    }
    getDevices();
    const onChange = () => getDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
    };
  }, [isOpen, selectedCam, selectedMic]);

  // Open camera preview stream
  useEffect(() => {
    if (!isOpen) {
      setCameraStream(null);
      return;
    }
    let cancelled = false;
    let opened: MediaStreamTrack | null = null;
    import("@panoptik/engine")
      .then(({ openCameraTrack }) => openCameraTrack(selectedCam || undefined))
      .then((track) => {
        if (!track) return;
        if (cancelled) {
          track.stop();
          return;
        }
        opened = track;
        cameraTrackRef.current = track;
        setCameraStream(new MediaStream([track]));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      setCameraStream(null);
      if (opened && state !== "recording") {
        opened.stop();
        if (cameraTrackRef.current === opened) cameraTrackRef.current = null;
      }
    };
  }, [isOpen, selectedCam, state]);

  // Sync video elements with camera stream
  useEffect(() => {
    if (cameraStream) {
      if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = cameraStream;
      if (livePreviewRef.current) livePreviewRef.current.srcObject = cameraStream;
      if (hudPreviewRef.current) hudPreviewRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, state]);

  // Teleprompter animation
  useEffect(() => {
    if (!telePlaying || !teleOpen) {
      cancelAnimationFrame(teleRafRef.current);
      return;
    }
    const step = () => {
      setTeleOffset((o) => o + teleSpeed);
      teleRafRef.current = requestAnimationFrame(step);
    };
    teleRafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(teleRafRef.current);
  }, [telePlaying, teleOpen, teleSpeed]);

  // Timer loop during recording
  useEffect(() => {
    if (state !== "recording") return;
    startTimeRef.current = performance.now() - elapsedRef.current * 1000;
    const tick = () => {
      const sec = (performance.now() - startTimeRef.current) / 1000;
      elapsedRef.current = sec;
      setElapsed(sec);

      // Auto-stop if reached end of timeline
      const curT = useProjectStore.getState().currentTime;
      const dur = project ? projectDuration(project) : 0;
      if (dur > 0 && curT >= dur - 0.05) {
        handleStopReshoot();
      }
    };
    const id = window.setInterval(tick, 100);
    return () => clearInterval(id);
  }, [state, project]);

  // Start Reshoot
  const handleStartReshoot = useCallback(async () => {
    try {
      setError(null);
      setState("countingDown");

      // Acquire camera + mic recorder via engine
      handlesRef.current = await startRecording({
        layout: "cameraOnly",
        cameraDeviceId: selectedCam || undefined,
        microphoneDeviceId: selectedMic || undefined,
        cameraEnabled: true,
        microphoneEnabled: micEnabled,
        cameraStream,
      });

      // 3-2-1 Countdown
      for (let n = 3; n >= 1; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 650));
      }
      setCountdown(null);

      // Begin recording take
      await handlesRef.current.begin();

      // Seek canvas to reshootStartT and start canvas playback
      seek(reshootStartT);
      play();

      setState("recording");
      elapsedRef.current = 0;
      setElapsed(0);
      startTimeRef.current = performance.now();
      if (teleOpen) setTelePlaying(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
      setCountdown(null);
    }
  }, [selectedCam, selectedMic, micEnabled, cameraStream, reshootStartT, seek, play, teleOpen]);

  // Stop Reshoot and Apply
  const handleStopReshoot = useCallback(async () => {
    if (!handlesRef.current || state === "stopping") return;
    setState("stopping");
    pause();
    if (teleOpen) setTelePlaying(false);

    try {
      const { facecamBlob } = await handlesRef.current.stop();
      if (facecamBlob.size < 512) {
        throw new Error("Recorded camera take was too short or empty. Please try again.");
      }

      // Update engine facecam & audio
      const { engine } = await import("@/lib/engineProvider");
      const facecamSrc = await engine.setFacecamBlob(facecamBlob, facecamBlob);

      // Update project store with startT
      replaceFacecamMedia(facecamSrc, facecamSrc, reshootStartT);

      // Pre-decode initial frame so preview canvas displays immediately
      await engine.prepareAllFrames(reshootStartT, 0);

      // Seek back to start of take so user can inspect immediately
      seek(reshootStartT);

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("panoptik:frame-dirty"));
      }

      // Cleanup
      cameraTrackRef.current?.stop();
      cameraTrackRef.current = null;
      setCameraStream(null);
      setIsOpen(false);
      setState("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
    }
  }, [state, pause, teleOpen, replaceFacecamMedia, seek, reshootStartT]);

  const handleCancel = useCallback(() => {
    if (state === "recording") {
      pause();
      handlesRef.current?.stop().catch(() => {});
    }
    cameraTrackRef.current?.stop();
    cameraTrackRef.current = null;
    setCameraStream(null);
    setIsOpen(false);
    setState("idle");
  }, [state, pause]);

  if (!isOpen) return null;

  return (
    <>
      {/* HUD OVERLAY DURING ACTIVE RECORDING */}
      {state === "recording" && (
        <div className="fixed inset-x-0 top-4 z-50 flex items-center justify-center pointer-events-none px-4">
          <div className="pointer-events-auto flex items-center gap-4 rounded-2xl border border-red-500/30 bg-[#111]/90 px-5 py-3 text-white shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-3">
            {/* Live Camera Thumbnail */}
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-red-500 shadow-md">
              <video
                ref={hudPreviewRef}
                autoPlay
                muted
                playsInline
                className={`h-full w-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
              />
              <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
            </div>

            {/* Status & Timer */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-red-500" />
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">Reshooting Facecam</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-sm font-semibold text-white">
                <span>{formatTimer(elapsed)}</span>
                <span className="text-xs text-white/50">/ {formatSimpleTimer(Math.max(0, totalDuration - reshootStartT))} remaining</span>
              </div>
            </div>

            <div className="h-6 w-px bg-white/20" />

            {/* Actions */}
            <button
              onClick={handleStopReshoot}
              className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white shadow-lg transition-all hover:bg-red-500 active:scale-95"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
              <span>Finish & Apply Take</span>
            </button>

            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-medium text-white/80 transition-all hover:bg-white/20 hover:text-white"
            >
              <span>Cancel</span>
            </button>
          </div>
        </div>
      )}

      {/* SETUP / COUNTDOWN MODAL */}
      {state !== "recording" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-[#333] bg-[#141416] text-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#252528] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/20 text-red-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="8" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Reshoot Facecam Take</h3>
                  <p className="text-xs text-[#888]">Re-record camera & mic synchronized to your canvas</p>
                </div>
              </div>
              <button
                onClick={handleCancel}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#333] text-[#888] transition-all hover:border-[#555] hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-4 p-6">
              {/* Timeline Position Notice */}
              <div className="flex items-center justify-between rounded-2xl border border-blue-500/30 bg-blue-950/30 px-4 py-3 text-xs text-blue-200">
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>
                    Starting from playhead coordinate: <strong className="font-mono text-white">{formatSimpleTimer(reshootStartT)}</strong>
                  </span>
                </div>
                <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 font-semibold text-blue-300">
                  Screen plays in sync
                </span>
              </div>

              {/* Live Camera Viewport */}
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[#2a2a2e] bg-black">
                {cameraStream ? (
                  <video
                    ref={cameraPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className={`h-full w-full object-cover ${isMirrored ? "-scale-x-100" : ""}`}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#666]">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 7l-7 5 7 5V7z" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <span className="text-xs">Accessing camera device...</span>
                  </div>
                )}

                {/* Mirror toggle button */}
                <button
                  onClick={() => setIsMirrored((m) => !m)}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-xl border border-white/20 bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white/90 shadow-md backdrop-blur-md transition-all hover:bg-black/80"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 3 21 3 21 8" />
                    <line x1="4" y1="20" x2="21" y2="3" />
                    <polyline points="21 16 21 21 16 21" />
                    <line x1="15" y1="15" x2="21" y2="21" />
                    <line x1="4" y1="4" x2="9" y2="9" />
                  </svg>
                  <span>{isMirrored ? "Mirrored" : "Original"}</span>
                </button>

                {/* Countdown Overlay */}
                {countdown !== null && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in">
                    <span className="font-mono text-7xl font-black text-white animate-ping">{countdown}</span>
                  </div>
                )}
              </div>

              {/* Hardware Device Pickers */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#888]">Camera</label>
                  <select
                    value={selectedCam}
                    onChange={(e) => setSelectedCam(e.target.value)}
                    className="w-full rounded-xl border border-[#2a2a2e] bg-[#1a1a1d] px-3 py-2 text-xs text-white outline-none focus:border-[#0070f3]"
                  >
                    {cameras.map((c) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.label || `Camera ${c.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#888]">Microphone</label>
                  <select
                    value={selectedMic}
                    onChange={(e) => setSelectedMic(e.target.value)}
                    className="w-full rounded-xl border border-[#2a2a2e] bg-[#1a1a1d] px-3 py-2 text-xs text-white outline-none focus:border-[#0070f3]"
                  >
                    {mics.map((m) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label || `Microphone ${m.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Teleprompter Accordion */}
              <div className="rounded-2xl border border-[#2a2a2e] bg-[#1a1a1d] p-3">
                <button
                  onClick={() => setTeleOpen((o) => !o)}
                  className="flex w-full items-center justify-between text-xs font-semibold text-[#ccc] hover:text-white"
                >
                  <div className="flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>Teleprompter Script (Optional)</span>
                  </div>
                  <span>{teleOpen ? "▲" : "▼"}</span>
                </button>

                {teleOpen && (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={teleText}
                      onChange={(e) => setTeleText(e.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-[#333] bg-[#111] p-2.5 text-xs text-white outline-none focus:border-[#0070f3]"
                      placeholder="Type or paste your narration script here..."
                    />
                    <div className="flex items-center gap-3 text-xs text-[#888]">
                      <span>Scroll Speed:</span>
                      <input
                        type="range"
                        min="0.5"
                        max="3"
                        step="0.5"
                        value={teleSpeed}
                        onChange={(e) => setTeleSpeed(Number(e.target.value))}
                        className="h-1.5 flex-1 accent-[#0070f3]"
                      />
                      <span>{teleSpeed}×</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Error readout */}
              {error && (
                <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs text-red-300">
                  {error}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 border-t border-[#252528] bg-[#111] px-6 py-4">
              <button
                onClick={handleCancel}
                className="rounded-xl border border-[#333] px-4 py-2 text-xs font-semibold text-[#888] transition-all hover:border-[#555] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleStartReshoot}
                disabled={state === "countingDown"}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg transition-all hover:bg-red-500 active:scale-95 disabled:opacity-50"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="8" />
                </svg>
                <span>Start Reshooting Facecam</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
