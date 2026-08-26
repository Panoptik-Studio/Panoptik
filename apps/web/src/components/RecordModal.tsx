/**
 * OWNER: DEV B — RecordModal.
 * Inspired by the reference recorder (screen+camera PiP, layout modes, shape, teleprompter)
 * but built on our stack: Next.js + Zustand + Tailwind, no MUI/framer.
 * Features: layout switcher (screen/screen+cam/cam only), circle/square PiP,
 * camera/mic device pickers with mute, mirrored preview, 3-2-1 countdown,
 * live timer, draggable teleprompter, and import into editor.
 * Opens via window CustomEvent "open-record-modal".
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

type RecordingLayout = "screenOnly" | "screenAndCamera" | "cameraOnly";
type RecordingShape = "circle" | "square";
type RecordingState = "idle" | "countingDown" | "recording" | "stopping";

type RecordingHandles = {
  screenStream: MediaStream;
  facecamStream: MediaStream;
  layout: RecordingLayout;
  shape: RecordingShape;
  stop: () => Promise<{ screenBlob: Blob; facecamBlob: Blob }>;
};

async function startRecording(opts: {
  layout: RecordingLayout;
  shape: RecordingShape;
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
}): Promise<RecordingHandles> {
  const { startRecording: startRec } = await import("@panoptik/engine");
  return startRec(opts);
}

function formatTimer(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function RecordModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<RecordingState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Layout / shape — persisted
  const [layout, setLayout] = useState<RecordingLayout>(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("panoptik:layout") as RecordingLayout | null;
      if (v && ["screenOnly", "screenAndCamera", "cameraOnly"].includes(v)) return v;
    }
    return "screenAndCamera";
  });
  const [shape, setShape] = useState<RecordingShape>(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("panoptik:shape") as RecordingShape | null;
      if (v === "square" || v === "circle") return v;
    }
    return "circle";
  });
  useEffect(() => { localStorage.setItem("panoptik:layout", layout); }, [layout]);
  useEffect(() => { localStorage.setItem("panoptik:shape", shape); }, [shape]);

  // Device prefs
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");

  // Preview + recording refs
  const handlesRef = useRef<RecordingHandles | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const screenPreviewRef = useRef<HTMLVideoElement>(null);
  const cameraPreviewStreamRef = useRef<MediaStream | null>(null);
  const screenLiveRef = useRef<HTMLVideoElement>(null);
  const facecamLiveRef = useRef<HTMLVideoElement>(null);
  const [hasPreviewVideo, setHasPreviewVideo] = useState(false);

  // Callback refs — ensure srcObject stays attached even when moving between desktop / tab
  const setCameraPreviewCb = useCallback((el: HTMLVideoElement | null) => {
    (cameraPreviewRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && cameraPreviewStreamRef.current) {
      el.srcObject = cameraPreviewStreamRef.current;
      el.play().catch(() => {});
    }
  }, []);
  const setScreenLiveCb = useCallback((el: HTMLVideoElement | null) => {
    (screenLiveRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && handlesRef.current?.screenStream?.getVideoTracks().length) {
      el.srcObject = handlesRef.current.screenStream;
      el.play().catch(() => {});
    }
  }, []);
  const setFacecamLiveCb = useCallback((el: HTMLVideoElement | null) => {
    (facecamLiveRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && handlesRef.current?.facecamStream?.getVideoTracks().length) {
      el.srcObject = handlesRef.current.facecamStream;
      el.play().catch(() => {});
    }
  }, []);

  // Countdown + timer
  const [countdown, setCountdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);

  // Teleprompter
  const [teleOpen, setTeleOpen] = useState(false);
  const [teleText, setTeleText] = useState("Welcome to Panoptik — your demo, beautifully framed. Paste your script here and use the controls to scroll while you record.");
  const [telePlaying, setTelePlaying] = useState(false);
  const [teleSpeed, setTeleSpeed] = useState(0.6);
  const [teleOffset, setTeleOffset] = useState(0);
  const teleRafRef = useRef<number>(0);
  const telePosRef = useRef({ x: 0, y: 0 });
  const teleDragRef = useRef<HTMLDivElement>(null);

  const { setProject } = useProjectStore();

  // Listen for open event
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("open-record-modal", handler);
    return () => window.removeEventListener("open-record-modal", handler);
  }, []);

  // Keyboard shortcuts when open (reference: E=camera, D=mic)
  useEffect(() => {
    if (!isOpen || state === "countingDown" || state === "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === "e") { e.preventDefault(); setCameraEnabled((v) => !v); }
      if (e.key.toLowerCase() === "d") { e.preventDefault(); setMicEnabled((v) => !v); }
      if (e.key === "Escape") {
        cameraPreviewStreamRef.current?.getTracks().forEach((t) => t.stop());
        cameraPreviewStreamRef.current = null;
        setIsOpen(false);
        setError(null);
        setCountdown(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, state]);

  // Enumerate devices on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    async function enumerate() {
      try {
        // Need permission to get labels — request a short-lived stream
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          tmp.getTracks().forEach((t) => t.stop());
        } catch { /* ignore */ }
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cams = devices.filter((d) => d.kind === "videoinput");
        const ms = devices.filter((d) => d.kind === "audioinput");
        setCameras(cams);
        setMics(ms);
        if (cams.length && !selectedCam) setSelectedCam(cams[0]!.deviceId);
        if (ms.length && !selectedMic) setSelectedMic(ms[0]!.deviceId);
      } catch { /* ignore */ }
    }
    enumerate();
    const onChange = () => enumerate();
    navigator.mediaDevices.addEventListener?.("devicechange", onChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", onChange);
    };
  }, [isOpen, selectedCam, selectedMic]);

  // Camera preview for idle (mirrored) — sets hasPreviewVideo for PiP placeholder logic
  useEffect(() => {
    if (!isOpen || state !== "idle" || layout === "screenOnly" || !cameraEnabled) {
      setHasPreviewVideo(false);
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    const constraints: MediaStreamConstraints = {
      video: selectedCam ? { deviceId: { exact: selectedCam }, width: 1280, height: 720 } : { width: 1280, height: 720, facingMode: "user" },
      audio: false,
    };
    setHasPreviewVideo(false);
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        cameraPreviewStreamRef.current = s;
        if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = s;
        setHasPreviewVideo(true);
      })
      .catch(() => {
        if (cancelled) return;
        navigator.mediaDevices
          .getUserMedia({ video: { width: 640, height: 360 }, audio: false })
          .then((s2) => {
            if (cancelled) { s2.getTracks().forEach((t) => t.stop()); return; }
            stream = s2;
            cameraPreviewStreamRef.current = s2;
            if (cameraPreviewRef.current) cameraPreviewRef.current.srcObject = s2;
            setHasPreviewVideo(true);
          })
          .catch(() => { if (!cancelled) setHasPreviewVideo(false); });
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (cameraPreviewStreamRef.current === stream) cameraPreviewStreamRef.current = null;
      setHasPreviewVideo(false);
    };
  }, [isOpen, state, layout, cameraEnabled, selectedCam]);

  // Keep preview video srcObject in sync when layout toggles
  useEffect(() => {
    if (cameraPreviewRef.current && cameraPreviewStreamRef.current) {
      cameraPreviewRef.current.srcObject = cameraPreviewStreamRef.current;
    }
  }, [layout]);

  // Timer RAF during recording
  useEffect(() => {
    if (state !== "recording") {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    startTimeRef.current = performance.now() - elapsedRef.current * 1000;
    const tick = () => {
      const sec = (performance.now() - startTimeRef.current) / 1000;
      elapsedRef.current = sec;
      setElapsed(sec);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state]);

  // Keep facecam/screen playing when tab loses focus or moves to desktop (fixes facecam removed)
  useEffect(() => {
    if (state !== "recording") return;
    const keepPlaying = () => {
      screenLiveRef.current?.play().catch(() => {});
      facecamLiveRef.current?.play().catch(() => {});
      cameraPreviewRef.current?.play().catch(() => {});
    };
    const onVisibility = () => { if (document.visibilityState === "visible") keepPlaying(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", keepPlaying);
    window.addEventListener("blur", keepPlaying);
    // Also re-attach srcObject if it was cleared
    const iv = window.setInterval(keepPlaying, 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", keepPlaying);
      window.removeEventListener("blur", keepPlaying);
      clearInterval(iv);
    };
  }, [state]);

  // Teleprompter auto-scroll
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

  // Attach live streams to video elements when recording
  useEffect(() => {
    if (state !== "recording" || !handlesRef.current) return;
    const { screenStream, facecamStream } = handlesRef.current;
    if (screenLiveRef.current && screenStream.getTracks().length) screenLiveRef.current.srcObject = screenStream;
    if (facecamLiveRef.current && facecamStream.getTracks().length) facecamLiveRef.current.srcObject = facecamStream;
  }, [state]);

  const handleStart = useCallback(async () => {
    try {
      setError(null);
      // Stop preview stream before countdown
      cameraPreviewStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraPreviewStreamRef.current = null;

      // Countdown 3-2-1
      setState("countingDown");
      for (let n = 3; n >= 1; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 700));
      }
      setCountdown(null);
      setState("recording");
      elapsedRef.current = 0;
      setElapsed(0);

      handlesRef.current = await startRecording({
        layout,
        shape,
        cameraDeviceId: selectedCam || undefined,
        microphoneDeviceId: selectedMic || undefined,
        cameraEnabled: layout !== "screenOnly" && cameraEnabled,
        microphoneEnabled: micEnabled,
      });

      requestAnimationFrame(() => {
        if (screenLiveRef.current && handlesRef.current?.screenStream.getTracks().length)
          screenLiveRef.current.srcObject = handlesRef.current.screenStream;
        if (facecamLiveRef.current && handlesRef.current?.facecamStream.getTracks().length)
          facecamLiveRef.current.srcObject = handlesRef.current.facecamStream;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("idle");
      setCountdown(null);
    }
  }, [layout, shape, selectedCam, selectedMic, cameraEnabled, micEnabled]);

  const handleStop = useCallback(async () => {
    if (!handlesRef.current) return;
    setState("stopping");
    cancelAnimationFrame(rafRef.current);
    try {
      const { screenBlob, facecamBlob } = await handlesRef.current.stop();
      console.log("[Record] blobs", { screen: `${screenBlob.type} ${screenBlob.size} bytes`, facecam: `${facecamBlob.type} ${facecamBlob.size} bytes` });
      // Validate only if we expected a screen blob
      if (layout !== "cameraOnly" && screenBlob.size < 1024) {
        throw new Error(`Recording produced an empty file (${screenBlob.size} bytes). Try recording for 3+ seconds and ensure you shared a screen/window.`);
      }
      if (layout === "cameraOnly" && facecamBlob.size < 1024) {
        throw new Error(`Camera recording is empty (${facecamBlob.size} bytes). Check camera permissions.`);
      }
      const { engine } = await import("@/lib/engineProvider");
      const project = await engine.loadRecording(
        layout === "cameraOnly" ? facecamBlob : screenBlob,
        layout === "screenAndCamera" && facecamBlob.size > 0 ? facecamBlob : null,
        null,
      );
      // Persist shape so export shows same circle/rectangle as preview PiP
      (project.facecam as { shape?: string }).shape = shape;
      setProject(project);
      setIsOpen(false);
    } catch (err) {
      console.error("[Record] loadRecording failed", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState("idle");
      setCountdown(null);
      elapsedRef.current = 0;
      setElapsed(0);
      handlesRef.current = null;
    }
  }, [setProject, layout]);

  const handleClose = useCallback(() => {
    if (state === "recording" || state === "countingDown") return;
    cameraPreviewStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraPreviewStreamRef.current = null;
    setIsOpen(false);
    setError(null);
    setCountdown(null);
  }, [state]);

  if (!isOpen) return null;

  const showPiP = layout === "screenAndCamera" && cameraEnabled;
  const pipHasVideo =
    state === "recording"
      ? !!handlesRef.current?.facecamStream?.getVideoTracks().some((t) => t.readyState === "live")
      : hasPreviewVideo;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="flex w-full max-w-[1120px] max-h-[94vh] flex-col overflow-hidden rounded-[18px] border shadow-[0_24px_80px_rgba(0,0,0,0.6),0_1px_0_rgba(255,255,255,0.06)_inset]"
        style={{ background: "#ffffff", borderColor: "#ebebeb", boxShadow: "0 0 0 1px rgba(0,0,0,0.08) inset, 0px 8px 32px rgba(0,0,0,0.12)" }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "#ebebeb", background: "#ffffff" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: "#171717", color: "white" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            </div>
            <div>
              <h2 className="text-[13px] font-semibold leading-none" style={{ color: "#171717" }}>Record</h2>
              <p className="text-[11px]" style={{ color: "#888" }}>Screen + camera · Local only · No upload</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state === "recording" && (
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums" style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.12)", color: "#FCA5A5" }}>
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]" />
                {formatTimer(elapsed)} · {layout === "cameraOnly" ? "Camera" : layout === "screenOnly" ? "Screen" : "Screen + Cam"}
              </span>
            )}
            <button onClick={handleClose} disabled={state === "recording" || state === "countingDown"} className="flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition hover:bg-white/[0.06] disabled:opacity-40" style={{ borderColor: "#ebebeb", color: "#4d4d4d" }}>✕</button>
          </div>
        </div>

        {/* Preview stage — larger for clarity */}
        <div className="relative flex min-h-[560px] flex-1 flex-col bg-black lg:min-h-[620px]">
          {/* Screen / camera preview */}
          <div className="relative flex flex-1 items-center justify-center overflow-hidden" style={{ background: "radial-gradient(ellipse 1100px 620px at 50% 38%, rgba(99,102,241,0.08) 0%, #050507 62%)" }}>
            {/* Screen placeholder / live */}
            {state === "recording" ? (
              layout === "cameraOnly" ? (
                <video ref={setFacecamLiveCb} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
              ) : (
                <video ref={setScreenLiveCb} autoPlay muted playsInline className="h-full w-full object-contain" />
              )
            ) : layout === "cameraOnly" ? (
              <video ref={setCameraPreviewCb} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
            ) : (
              <>
                {/* fake screen — gradient card */}
                <div className="absolute inset-0 flex items-center justify-center p-10">
                  <div className="flex h-full max-h-[480px] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border shadow-2xl" style={{ background: "#0F1012", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="flex h-7 items-center gap-1.5 border-b px-3" style={{ background: "#1A1C21", borderColor: "rgba(255,255,255,0.06)" }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#EF4444" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#10B981" }} />
                      <span className="ml-3 text-[10px] font-mono" style={{ color: "#888" }}>screen preview — select a window after clicking Record</span>
                    </div>
                    <div className="flex flex-1 items-center justify-center p-6">
                      <div className="text-center">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#d3e5ff", color: "#0070f3", border: "1px solid #d3e5ff" }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21l8-10 4 4" /></svg>
                        </div>
                        <p className="text-xs font-medium" style={{ color: "#4d4d4d" }}>Your screen will appear here</p>
                        <p className="mt-1 text-[11px]" style={{ color: "#888" }}>Pick a tab, window or entire screen</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* PiP camera — mirrored, circle/square — light placeholder when no video (fixes black patch) */}
            {showPiP && (
              <div
                className={`absolute overflow-hidden border-[2.5px] ${pipHasVideo ? "bg-black" : "bg-white"} shadow-[0_12px_32px_rgba(0,0,0,0.22)]`}
                style={{
                  right: 22,
                  bottom: 22,
                  width: 216,
                  height: 216,
                  borderRadius: shape === "circle" ? "50%" : 12,
                  borderColor: pipHasVideo ? "#ffffff" : "#ebebeb",
                  boxShadow: pipHasVideo ? "0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.9) inset" : "0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06) inset",
                }}
              >
                {pipHasVideo ? (
                  state === "recording" ? (
                    <video ref={setFacecamLiveCb} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  ) : (
                    <video ref={setCameraPreviewCb} autoPlay muted playsInline className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  )
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#fafafa] p-4 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border bg-white" style={{ borderColor: "#ebebeb" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.7"><path d="M16 16l4 4M2 12a10 10 0 1 0 20 0 10 10 0 0 0-20 0z" /><path d="M10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" /></svg>
                    </div>
                    <p className="text-[11px] font-medium" style={{ color: "#4d4d4d" }}>No camera</p>
                    <p className="font-mono text-[10px]" style={{ color: "#888" }}>Enable camera or check permissions</p>
                  </div>
                )}

              </div>
            )}

            {/* Countdown overlay */}
            {countdown !== null && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[1px]">
                <div
                  key={countdown}
                  className="flex h-24 w-24 items-center justify-center rounded-full text-5xl font-black text-white shadow-2xl animate-[ping_700ms_ease-out]"
                  style={{ background: "#171717", boxShadow: "0 0 48px var(--color-accent-glow)", animation: "countPulse 700ms ease-out" }}
                >
                  {countdown}
                </div>
                <p className="text-xs font-medium tracking-widest text-white/90">GET READY</p>
                <style>{`@keyframes countPulse { 0% { transform: scale(0.6); opacity: 0.7 } 50% { transform: scale(1.08); opacity: 1 } 100% { transform: scale(1); opacity: 1 } }`}</style>
              </div>
            )}

            {/* Timer top-left during recording */}
            {state === "recording" && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border bg-black/55 px-3 py-1.5 backdrop-blur-md" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]" />
                <span className="font-mono text-xs font-semibold tracking-wide text-white">{formatTimer(elapsed)}</span>
                <span className="text-[10px] tracking-widest text-white/60">REC</span>
              </div>
            )}

            {/* Teleprompter overlay — draggable */}
            {teleOpen && (
              <div
                ref={teleDragRef}
                className="absolute z-20 flex max-h-[52%] w-[86%] max-w-[560px] flex-col overflow-hidden rounded-xl border shadow-2xl"
                style={{
                  left: "50%",
                  top: "12%",
                  transform: `translateX(-50%) translate(${telePosRef.current.x}px, ${telePosRef.current.y}px)`,
                  background: "rgba(12,14,18,0.88)",
                  borderColor: "rgba(255,255,255,0.10)",
                  backdropFilter: "blur(10px)",
                }}
                onMouseDown={(e) => {
                  const startX = e.clientX - telePosRef.current.x;
                  const startY = e.clientY - telePosRef.current.y;
                  const onMove = (ev: MouseEvent) => {
                    telePosRef.current = { x: ev.clientX - startX, y: ev.clientY - startY };
                    if (teleDragRef.current) teleDragRef.current.style.transform = `translateX(-50%) translate(${telePosRef.current.x}px, ${telePosRef.current.y}px)`;
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              >
                <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}>
                  <span className="text-[11px] font-semibold tracking-wide" style={{ color: "#4d4d4d" }}>Teleprompter — drag to move</span>
                  <button onClick={() => setTeleOpen(false)} className="rounded-md px-2 py-1 text-xs hover:bg-white/10" style={{ color: "#4d4d4d" }}>✕</button>
                </div>
                <div className="relative h-[180px] overflow-hidden">
                  <div className="absolute inset-0 overflow-hidden px-5 py-4">
                    <div className="whitespace-pre-wrap text-center text-[15px] leading-7" style={{ color: "white", transform: `translateY(${-teleOffset}px)`, textShadow: "0 1px 10px rgba(0,0,0,0.6)" }}>{teleText}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.35)" }}>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setTeleOffset((o) => Math.max(0, o - 60))} className="rounded-md border px-2 py-1 text-xs hover:bg-white/10" style={{ borderColor: "#ebebeb", color: "white" }}>Rewind</button>
                    <button onClick={() => setTelePlaying((p) => !p)} className="rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors" style={{ background: telePlaying ? "#E11D48" : "#171717" }} onMouseEnter={(e) => { if (!telePlaying) e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { if (!telePlaying) e.currentTarget.style.background = "#171717"; }}>{telePlaying ? "Pause" : "Play"}</button>
                    <button onClick={() => setTeleOffset((o) => o + 60)} className="rounded-md border px-2 py-1 text-xs hover:bg-white/10" style={{ borderColor: "#ebebeb", color: "white" }}>Forward</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setTeleSpeed((s) => Math.max(0.1, +(s - 0.1).toFixed(1)))} className="h-6 w-6 rounded-md border text-xs hover:bg-white/10" style={{ borderColor: "#ebebeb", color: "white" }}>−</button>
                    <span className="min-w-[36px] text-center font-mono text-xs text-white">{teleSpeed.toFixed(1)}×</span>
                    <button onClick={() => setTeleSpeed((s) => Math.min(2, +(s + 0.1).toFixed(1)))} className="h-6 w-6 rounded-md border text-xs hover:bg-white/10" style={{ borderColor: "#ebebeb", color: "white" }}>+</button>
                    <button onClick={() => setTeleOffset(0)} className="ml-1 rounded-md border px-2 py-1 text-[11px] hover:bg-white/10" style={{ borderColor: "#ebebeb", color: "white" }}>Reset</button>
                  </div>
                </div>
              </div>
            )}

            {/* Floating layout switcher — idle only, centered bottom — reference pattern: grid pill, blur, icons */}
            {state === "idle" && (
              <div className="absolute bottom-6 left-1/2 z-10 grid -translate-x-1/2 grid-flow-col auto-cols-fr gap-0 rounded-[16px] border p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-[6px]" style={{ background: "rgba(255,255,255,0.92)", borderColor: "#ebebeb" }}>
                {([
                  ["screenOnly", "Screen only", "M1"],
                  ["screenAndCamera", "Screen + camera", "M2"],
                  ["cameraOnly", "Camera only", "M3"],
                ] as const).map(([v, label]) => {
                  const isActive = layout === v;
                  return (
                    <button
                      key={v}
                      onClick={() => setLayout(v)}
                      className="grid justify-items-center gap-[10px] rounded-[16px] border-0 px-4 pb-3 pt-[18px] text-[12px] font-medium leading-4 transition-colors"
                      style={{ background: isActive ? "transparent" : "transparent", color: isActive ? "#171717" : "#888" }}
                    >
                      <span
                        className="flex h-5 w-8 items-center justify-center rounded-lg p-1"
                        style={{
                          boxShadow: isActive ? "0 0 0 2px rgba(255,255,255,0.7), 0 0 0 1px #ebebeb" : "0 0 0 1px #ebebeb",
                          background: isActive ? "#171717" : "#ffffff",
                          filter: isActive ? "invert(1) brightness(1.175)" : "none",
                        }}
                      >
                        {v === "screenOnly" && <svg width="16" height="12" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="1" y="1" width="22" height="12" rx="1.5" /></svg>}
                        {v === "screenAndCamera" && <svg width="16" height="12" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="1" y="1" width="18" height="10" rx="1.2" /><circle cx="18" cy="10" r="4" fill="currentColor" stroke="none" opacity="0.9" /></svg>}
                        {v === "cameraOnly" && <svg width="16" height="12" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="14" height="10" rx="1.5" /><path d="M17 7l4-2v6l-4-2z" /></svg>}
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Controls bar */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: "#ebebeb", background: "#ffffff" }}>
            {/* Left: device & shape */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Camera */}
              <div className="flex items-center gap-1 rounded-full border px-1 py-1" style={{ background: "#fafafa", borderColor: "#ebebeb" }}>
                <button
                  onClick={() => setCameraEnabled((v) => !v)}
                  disabled={layout === "screenOnly"}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs transition disabled:opacity-30"
                  style={{ background: cameraEnabled && layout !== "screenOnly" ? "#171717" : "transparent", color: cameraEnabled ? "#ffffff" : "#888", border: `1px solid ${cameraEnabled ? "rgba(0,112,243,0.2)" : "transparent"}` }}
                  onMouseEnter={(e) => { if (cameraEnabled && layout !== "screenOnly") e.currentTarget.style.background = "#0070f3"; }}
                  onMouseLeave={(e) => { if (cameraEnabled && layout !== "screenOnly") e.currentTarget.style.background = "#171717"; }}
                  title={cameraEnabled ? "Camera on (click to mute)" : "Camera off"}
                >
                  {cameraEnabled ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M16 16l4 4M2 2l20 20M9 9a2 2 0 0 1 4 0v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2" /></svg>
                  )}
                </button>
                <select
                  value={selectedCam}
                  onChange={(e) => setSelectedCam(e.target.value)}
                  disabled={!cameras.length || !cameraEnabled}
                  className="max-w-[130px] bg-transparent pr-6 text-xs outline-none disabled:opacity-40"
                  style={{ color: "#4d4d4d" }}
                >
                  {cameras.length === 0 && <option>No cameras</option>}
                  {cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId} className="bg-gray-900">
                      {c.label || `Camera ${c.deviceId.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mic */}
              <div className="flex items-center gap-1 rounded-full border px-1 py-1" style={{ background: "#fafafa", borderColor: "#ebebeb" }}>
                <button
                  onClick={() => setMicEnabled((v) => !v)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs transition"
                  style={{ background: micEnabled ? "#171717" : "transparent", color: micEnabled ? "#ffffff" : "#888", border: `1px solid ${micEnabled ? "rgba(0,112,243,0.2)" : "transparent"}` }}
                  onMouseEnter={(e) => { if (micEnabled) e.currentTarget.style.background = "#0070f3"; }}
                  onMouseLeave={(e) => { if (micEnabled) e.currentTarget.style.background = "#171717"; }}
                  title={micEnabled ? "Mic on" : "Mic muted"}
                >
                  {micEnabled ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" /><path d="M19 10a7 7 0 0 1-14 0" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V5a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 10M12 19v3" /></svg>
                  )}
                </button>
                <select
                  value={selectedMic}
                  onChange={(e) => setSelectedMic(e.target.value)}
                  disabled={!mics.length || !micEnabled}
                  className="max-w-[130px] bg-transparent pr-6 text-xs outline-none disabled:opacity-40"
                  style={{ color: "#4d4d4d" }}
                >
                  {mics.length === 0 && <option>No mics</option>}
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId} className="bg-gray-900">
                      {m.label || `Mic ${m.deviceId.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Shape */}
              <div className="hidden sm:flex items-center gap-1 rounded-full border p-1" style={{ background: "#fafafa", borderColor: "#ebebeb" }}>
                <span className="px-2 text-[10px] font-semibold tracking-widest" style={{ color: "#888" }}>SHAPE</span>
                <button onClick={() => setShape("square")} className={`rounded-full p-1.5 transition ${shape === "square" ? "text-white" : "hover:bg-white/10"}`} style={{ background: shape === "square" ? "#171717" : "transparent", color: shape === "square" ? "white" : "#4d4d4d" }} onMouseEnter={(e) => { if (shape === "square") e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { if (shape === "square") e.currentTarget.style.background = "#171717"; }} title="Square PiP">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                </button>
                <button onClick={() => setShape("circle")} className={`rounded-full p-1.5 transition ${shape === "circle" ? "text-white" : "hover:bg-white/10"}`} style={{ background: shape === "circle" ? "#171717" : "transparent", color: shape === "circle" ? "white" : "#4d4d4d" }} onMouseEnter={(e) => { if (shape === "circle") e.currentTarget.style.background = "#0070f3"; }} onMouseLeave={(e) => { if (shape === "circle") e.currentTarget.style.background = "#171717"; }} title="Circle PiP">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8" /></svg>
                </button>
              </div>

              {/* Teleprompter toggle */}
              <button
                onClick={() => setTeleOpen((v) => !v)}
                className={`hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${teleOpen ? "text-white" : "hover:bg-white/10"}`}
                style={{ background: teleOpen ? "#171717" : "#fafafa", borderColor: teleOpen ? "#0070f3" : "#ebebeb", color: teleOpen ? "white" : "#4d4d4d" }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                Teleprompter
              </button>
            </div>

            {/* Center: main record */}
            <div className="flex items-center gap-2">
              {state === "idle" && (
                <>
                  <button onClick={handleClose} className="rounded-full border px-4 py-2 text-xs font-medium hover:bg-white/[0.06]" style={{ borderColor: "#ebebeb", color: "#4d4d4d" }}>
                    Cancel
                  </button>
                  <button onClick={handleStart} className="inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-bold tracking-wide text-white shadow-lg transition hover:brightness-[1.07] active:scale-[0.98]" style={{ background: "#E11D48", boxShadow: "0 6px 20px rgba(225,29,72,0.35), inset 0 1px 0 rgba(255,255,255,0.18)" }}>
                    <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
                    Record
                  </button>
                </>
              )}
              {state === "countingDown" && (
                <div className="rounded-full bg-white/10 px-5 py-2 text-xs font-medium tracking-widest text-white">COUNTDOWN…</div>
              )}
              {state === "recording" && (
                <button onClick={handleStop} className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-bold tracking-wide text-gray-900 shadow-lg transition hover:bg-gray-100 active:scale-[0.98]">
                  <span className="h-3 w-3 rounded-[3px] bg-red-600" />
                  Stop & Import
                </button>
              )}
              {state === "stopping" && (
                <div className="rounded-full bg-white/10 px-5 py-2 text-xs font-medium text-white">Processing…</div>
              )}
            </div>

            {/* Right: hint */}
            <div className="hidden lg:flex items-center gap-2 text-[11px]" style={{ color: "#888" }}>
              <span className="hidden xl:inline">Chrome recommended · </span>
              <span>Local only</span>
              <span className="h-1 w-1 rounded-full" style={{ background: "#888" }} />
              <span className="hidden sm:inline">No upload</span>
            </div>
          </div>

          {/* Teleprompter editor when open and idle (show textarea) */}
          {teleOpen && state === "idle" && (
            <div className="border-t p-3" style={{ borderColor: "#ebebeb", background: "rgba(255,255,255,0.02)" }}>
              <textarea
                value={teleText}
                onChange={(e) => setTeleText(e.target.value)}
                placeholder="Paste your script here…"
                rows={3}
                className="w-full resize-none rounded-lg border bg-black/40 p-3 text-sm leading-relaxed outline-none placeholder:text-white/30"
                style={{ borderColor: "#ebebeb", color: "white" }}
              />
            </div>
          )}

          {error && (
            <div className="border-t bg-red-500/10 px-4 py-2.5 text-xs" style={{ borderColor: "rgba(239,68,68,0.2)", color: "#FCA5A5" }}>
              {error}
            </div>
          )}

          <div className="shrink-0 border-t px-4 py-2 text-center text-[10px] tracking-wide" style={{ borderColor: "#ebebeb", color: "#888" }}>
            Press <span className="rounded border px-1 py-px font-mono text-[10px]" style={{ borderColor: "#ebebeb", background: "#fafafa" }}>E</span> camera · <span className="rounded border px-1 py-px font-mono text-[10px]" style={{ borderColor: "#ebebeb", background: "#fafafa" }}>D</span> mic · <span className="rounded border px-1 py-px font-mono text-[10px]" style={{ borderColor: "#ebebeb", background: "#fafafa" }}>Esc</span> close
          </div>
        </div>
      </div>
    </div>
  );
}
