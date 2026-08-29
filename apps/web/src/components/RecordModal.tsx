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

import { primaryMedia } from "@panoptik/schema";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { PiPWindow } from "@/components/PiPWindow";
import { isPipSupported, usePiPWindow } from "@/hooks/usePiPWindow";
import { startRecording as engineStartRecording, type RecordingHandles } from "@panoptik/engine";

type RecordingLayout = "screenOnly" | "screenAndCamera" | "cameraOnly";
type RecordingShape = "circle" | "square";
type RecordingState = "idle" | "countingDown" | "recording" | "stopping";
type CameraCorner = "bottomRight" | "bottomLeft" | "topRight" | "topLeft";

/** Where the camera bubble sits in the exported frame, as facecam x/y (top-left, 0-1). */
const CORNER_ANCHORS: Record<CameraCorner, { x: number; y: number }> = {
  bottomRight: { x: 0.97, y: 0.97 },
  bottomLeft: { x: 0.03, y: 0.97 },
  topRight: { x: 0.97, y: 0.03 },
  topLeft: { x: 0.03, y: 0.03 },
};

const CORNER_LABELS: Record<CameraCorner, string> = {
  bottomRight: "Bottom right",
  bottomLeft: "Bottom left",
  topRight: "Top right",
  topLeft: "Top left",
};

/** Webcam tracks are 16:9; the PiP keeps that aspect while `size` scales its width. */
const CAMERA_ASPECT = 16 / 9;

/**
 * The PiP's height as a fraction of canvas height. `size` is a fraction of canvas
 * *width*, so converting to a height fraction goes through both aspects.
 */
export function facecamHeightFraction(size: number, canvasAspect: number): number {
  return size * canvasAspect;
}

/**
 * Convert a corner + size into facecam x/y. `x`/`y` are the PiP's top-left, so a
 * bottom or right anchor has to be pulled back by the PiP's own extent.
 */
function facecamPlacement(corner: CameraCorner, size: number, canvasAspect: number) {
  const a = CORNER_ANCHORS[corner];
  const hFrac = facecamHeightFraction(size, canvasAspect);
  return {
    x: a.x > 0.5 ? Math.max(0, a.x - size) : a.x,
    y: a.y > 0.5 ? Math.max(0, a.y - hFrac) : a.y,
    size,
  };
}

async function startRecording(opts: {
  layout: RecordingLayout;
  shape: RecordingShape;
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  cameraStream?: MediaStream | null;
}): Promise<RecordingHandles> {
  return engineStartRecording(opts);
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
  const [corner, setCorner] = useState<CameraCorner>(() => {
    if (typeof window !== "undefined") {
      const v = localStorage.getItem("panoptik:corner") as CameraCorner | null;
      if (v && v in CORNER_ANCHORS) return v;
    }
    return "bottomRight";
  });
  const [camSize, setCamSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const v = Number(localStorage.getItem("panoptik:camSize"));
      if (v >= 0.1 && v <= 0.4) return v;
    }
    return 0.2;
  });
  useEffect(() => { localStorage.setItem("panoptik:layout", layout); }, [layout]);
  useEffect(() => { localStorage.setItem("panoptik:shape", shape); }, [shape]);
  useEffect(() => { localStorage.setItem("panoptik:corner", corner); }, [corner]);
  useEffect(() => { localStorage.setItem("panoptik:camSize", String(camSize)); }, [camSize]);

  // Floating camera bubble — a Document PiP window so your face stays visible
  // over the desktop and other tabs, not just inside this one.
  const { pipWindow, requestPipWindow, closePipWindow } = usePiPWindow();
  const pipSupported = isPipSupported();
  // The single camera stream, shared by the preview, the bubble and the take.
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  // While a take is running the recorder closes the camera track, so the
  // effect that opened it must not also close it.
  const recordingOwnsCameraRef = useRef(false);
  // The live preview camera. Held in a ref rather than only in the opening
  // effect's closure: the device has to be releasable from the stop handler
  // too, and a closure that has already been cleaned up cannot do that.
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  // Set when the floating bubble had to be closed because the whole screen is
  // being captured and it would have been recorded.
  const [bubbleSuppressed, setBubbleSuppressed] = useState(false);

  // Device prefs
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState<string>("");
  const [selectedMic, setSelectedMic] = useState<string>("");

  // Whether the camera is needed at all, and whether it also gets a corner slot
  // in the composed frame. Declared before the effects that depend on them.
  const wantsCameraSlot = layout !== "screenOnly" && cameraEnabled;
  const hasCameraSlotInFrame = layout === "screenAndCamera" && cameraEnabled;

  // Preview + recording refs
  const handlesRef = useRef<RecordingHandles | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const screenPreviewRef = useRef<HTMLVideoElement>(null);
  const screenLiveRef = useRef<HTMLVideoElement>(null);
  const facecamLiveRef = useRef<HTMLVideoElement>(null);

  // Callback refs — ensure srcObject stays attached even when moving between desktop / tab
  const setCameraPreviewCb = useCallback((el: HTMLVideoElement | null) => {
    (cameraPreviewRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (el && cameraStream) {
      el.srcObject = cameraStream;
      el.play().catch(() => {});
    }
  }, [cameraStream]);
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

  // Never leave a floating bubble behind if the editor unmounts mid-take.
  useEffect(() => closePipWindow, [closePipWindow]);

  // Keyboard shortcuts when open (reference: E=camera, D=mic)
  useEffect(() => {
    if (!isOpen || state === "countingDown" || state === "recording") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key.toLowerCase() === "e") { e.preventDefault(); setCameraEnabled((v) => !v); }
      if (e.key.toLowerCase() === "d") { e.preventDefault(); setMicEnabled((v) => !v); }
      if (e.key === "Escape") {
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

  // ── Explicit mic permission prompt (so the browser shows the Allow dialog) ──
  useEffect(() => {
    if (!isOpen || !micEnabled || !wantsCameraSlot) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (!cancelled) s.getTracks().forEach((t) => t.stop());
      })
      .catch(() => {
        if (!cancelled) {
          setMicEnabled(false);
          setError("Microphone permission denied — recording without mic. Enable in browser settings to include audio.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, micEnabled, wantsCameraSlot]);

  // ── The camera: opened once, shared by everything ──
  // Deliberately not keyed on recording state. The preview, the floating bubble
  // and the MediaRecorder all read this one stream; re-acquiring the device on
  // the idle -> recording transition is what stuttered the picture, and made
  // the take inherit the preview's low preview-grade resolution.
  useEffect(() => {
    if (!isOpen || !wantsCameraSlot) {
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
      .catch(() => { /* no camera: the slot shows its placeholder */ });
    return () => {
      cancelled = true;
      setCameraStream(null);
      // The recorder holds this same track while a take is running and closes
      // it when the take ends, so releasing it here would cut the recording.
      if (opened && !recordingOwnsCameraRef.current) {
        opened.stop();
        if (cameraTrackRef.current === opened) cameraTrackRef.current = null;
      }
    };
  }, [isOpen, wantsCameraSlot, selectedCam]);

  /**
   * Close the preview camera and turn the hardware light off.
   *
   * startRecording() borrows this track rather than reopening the device, and
   * it only stops tracks it opened itself — so nothing in the engine will ever
   * close this one. It has to be released here.
   */
  const releaseCamera = useCallback(() => {
    const track = cameraTrackRef.current;
    cameraTrackRef.current = null;
    track?.stop();
    setCameraStream(null);
  }, []);

  // Last resort. The opening effect declines to stop the track while a take is
  // running, so that a re-render cannot cut the recording — but on unmount
  // there is no take left to protect, and no later cleanup to fall back on.
  useEffect(
    () => () => {
      cameraTrackRef.current?.stop();
      cameraTrackRef.current = null;
    },
    [],
  );

  // Keep preview video srcObject in sync when layout toggles
  useEffect(() => {
    if (cameraPreviewRef.current && cameraStream) {
      cameraPreviewRef.current.srcObject = cameraStream;
    }
  }, [layout]);

  // Timer RAF during recording
  useEffect(() => {
    if (state !== "recording") return;
    startTimeRef.current = performance.now() - elapsedRef.current * 1000;
    // The readout is MM:SS, so it only needs to change once a second. Driving
    // this from rAF re-rendered the modal — and the PiP portal's <video> with
    // it — 60 times a second, which is what made the bubble flicker.
    const tick = () => {
      const sec = (performance.now() - startTimeRef.current) / 1000;
      elapsedRef.current = sec;
      setElapsed((prev) => (Math.floor(sec) === Math.floor(prev) ? prev : sec));
    };
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [state]);

  // Keep facecam/screen playing when tab loses focus or moves to desktop (fixes facecam removed)
  useEffect(() => {
    if (state !== "recording") return;
    // Only nudge elements that actually stalled. Calling play() on a playing
    // video every second is enough to make the picture hitch.
    const keepPlaying = () => {
      for (const el of [screenLiveRef.current, facecamLiveRef.current, cameraPreviewRef.current]) {
        if (el && el.paused && el.srcObject) el.play().catch(() => {});
      }
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

      // getDisplayMedia and requestPipWindow BOTH require transient activation
      // from the same click — only one can consume it. Prioritize screen capture
      // (the core feature); PiP is best-effort and will silently fail if the
      // activation is already spent, falling back to inline preview.
      // Also: no dynamic import — that await would itself break the activation.
      handlesRef.current = await startRecording({
        layout,
        shape,
        cameraDeviceId: selectedCam || undefined,
        microphoneDeviceId: selectedMic || undefined,
        cameraEnabled: wantsCameraSlot,
        microphoneEnabled: micEnabled,
        cameraStream,
      });
      recordingOwnsCameraRef.current = wantsCameraSlot;

      // Try floating PiP after — if activation is spent it will reject, we catch.
      if (wantsCameraSlot && pipSupported) {
        try {
          await requestPipWindow(Math.round(camSize * 1400));
        } catch {
          // PiP needs activation too — if screen picker consumed it, just stay inline.
        }
      }

      // Countdown 3-2-1 (now safe — streams already acquired)
      setState("countingDown");
      for (let n = 3; n >= 1; n--) {
        setCountdown(n);
        await new Promise((r) => setTimeout(r, 700));
      }
      setCountdown(null);

      // Encoding starts here, not at acquisition: the picker, the permission
      // prompts and the 3-2-1 above would otherwise all land at the head of
      // the take as several seconds of dead footage.
      await handlesRef.current.begin();

      setState("recording");
      elapsedRef.current = 0;
      setElapsed(0);
      startTimeRef.current = performance.now();

      // Sharing a whole monitor captures the floating bubble along with it, so
      // the take would show the camera twice: once burned into the screen
      // track, once composited as the PiP. Close the bubble in that case — the
      // camera is still recorded separately and composited on top.
      const surface = handlesRef.current.screenStream
        .getVideoTracks()[0]
        ?.getSettings?.() as { displaySurface?: string } | undefined;
      if (surface?.displaySurface === "monitor") {
        closePipWindow();
        setBubbleSuppressed(true);
      }

      requestAnimationFrame(() => {
        if (screenLiveRef.current && handlesRef.current?.screenStream.getTracks().length)
          screenLiveRef.current.srcObject = handlesRef.current.screenStream;
        if (facecamLiveRef.current && handlesRef.current?.facecamStream.getTracks().length)
          facecamLiveRef.current.srcObject = handlesRef.current.facecamStream;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // No take is running, so the camera goes back to being the effect's.
      recordingOwnsCameraRef.current = false;
      setState("idle");
      setCountdown(null);
      closePipWindow();
    }
  }, [layout, shape, selectedCam, selectedMic, wantsCameraSlot, micEnabled, camSize, pipSupported, cameraStream, requestPipWindow, closePipWindow]);

  const handleStop = useCallback(async () => {
    if (!handlesRef.current) return;
    setState("stopping");
    closePipWindow();
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
      const hasFacecamMedia = facecamBlob.size > 0;
      const project = await engine.loadRecording(
        layout === "cameraOnly" ? facecamBlob : screenBlob,
        // Only a screen+camera take gets a picture-in-picture.
        layout === "screenAndCamera" && hasFacecamMedia ? facecamBlob : null,
        // The mic is narration only when there is no facecam video (screen-only layout)
        layout === "screenOnly" && hasFacecamMedia ? facecamBlob : null,
      );
      // Carry the chosen shape and corner through to the composed frame, so the
      // exported video puts the camera where the recorder UI said it would.
      // The facecam lives on the (single) segment in the v1.2 model.
      const seg = project.segments[0];
      if (seg) {
        seg.facecam = {
          ...seg.facecam,
          ...facecamPlacement(corner, camSize, primaryMedia(project).width / primaryMedia(project).height),
          shape,
        };
      }
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
      recordingOwnsCameraRef.current = false;
      setBubbleSuppressed(false);
      // The take is over, so the preview is finished with the camera too.
      // Waiting for the opening effect to unmount is not enough: on the error
      // path the modal stays open, its deps never change, and the cleanup that
      // would have stopped the device never runs.
      releaseCamera();
    }
  }, [setProject, layout, shape, corner, camSize, closePipWindow, releaseCamera]);

  const handleClose = useCallback(() => {
    if (state === "recording" || state === "countingDown") return;
    setIsOpen(false);
    setError(null);
    setCountdown(null);
    // Dismissing the modal without recording still has to give the device back.
    releaseCamera();
  }, [state, releaseCamera]);

  if (!isOpen) return null;

  // Exactly one live camera view at a time. Once the floating window owns the
  // camera, the modal shows a placeholder instead of a second <video> — two
  // copies is confusing, and the in-modal one renders as a black square while
  // the bubble holds the stream.
  const cameraIsFloating = pipWindow !== null;
  const showPiP = hasCameraSlotInFrame && !cameraIsFloating;
  // One source of truth for "is there a picture": the shared camera stream.
  const pipHasVideo = !!cameraStream?.getVideoTracks().some((t) => t.readyState === "live");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Floating camera bubble — stays on top of the desktop and other tabs */}
      <PiPWindow
        pipWindow={pipWindow}
        stream={cameraStream}
        shape={shape}
        elapsed={elapsed}
        isRecording={state === "recording"}
        onStop={handleStop}
      />
      <div className="pk-shadow-xl flex max-h-[94vh] w-full max-w-[1120px] flex-col overflow-hidden rounded-[var(--radius-pk-card)] border border-pk-hairline bg-pk-surface">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-pk-hairline bg-pk-surface px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-pk-inner)] bg-pk-ink-strong text-white">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
            </div>
            <div>
              <h2 className="pk-panel-title leading-none">Record</h2>
              <p className="pk-help mt-1">Screen + camera · Local only · No upload</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state === "recording" && (
              <span className="pk-chip pk-chip-red hidden tabular-nums sm:inline-flex">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pk-red" />
                {formatTimer(elapsed)} · {layout === "cameraOnly" ? "Camera" : layout === "screenOnly" ? "Screen" : "Screen + Cam"}
              </span>
            )}
            <button
              onClick={handleClose}
              disabled={state === "recording" || state === "countingDown"}
              className="pk-icon-btn"
              title="Close"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
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
                  <div className="flex h-full max-h-[480px] w-full max-w-[880px] flex-col overflow-hidden rounded-[var(--radius-pk-card)] border shadow-2xl" style={{ background: "#0F1012", borderColor: "rgba(255,255,255,0.08)" }}>
                    <div className="relative flex h-7 items-center gap-1.5 border-b px-3" style={{ background: "#1A1C21", borderColor: "rgba(255,255,255,0.06)" }}>
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#EF4444" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#F59E0B" }} />
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#10B981" }} />
                      <span className="pk-ui pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] text-white/45">screen preview — select a window after clicking Record</span>
                    </div>
                    <div className="flex flex-1 items-center justify-center p-6">
                      <div className="text-center">
                        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "#d3e5ff", color: "#0070f3", border: "1px solid #d3e5ff" }}>
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21l8-10 4 4" /></svg>
                        </div>
                        <p className="pk-ui text-[13px] font-medium text-white/85">Your screen will appear here</p>
                        <p className="pk-ui mt-1 text-[11px] text-white/45">Pick a window or tab</p>
                        {wantsCameraSlot && pipSupported && (
                          <p className="pk-ui mx-auto mt-2.5 max-w-[34ch] text-[11px] leading-4 text-white/40">
                            Sharing the entire screen also captures the floating camera,
                            which records as a black box. Your camera is composited
                            separately, so share a single window or tab instead.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* PiP camera — mirrored, circle/square — light placeholder when no video (fixes black patch) */}
            {showPiP && (
              <div
                // Never bg-black: a video that has not painted its first frame
                // would show through as a black disc.
                className="absolute overflow-hidden border-[2.5px] bg-white shadow-[0_12px_32px_rgba(0,0,0,0.22)]"
                style={{
                  // Mirrors the corner picker so the preview shows where the
                  // camera will actually sit in the finished video.
                  ...(corner === "bottomRight" ? { right: 22, bottom: 22 } : {}),
                  ...(corner === "bottomLeft" ? { left: 22, bottom: 22 } : {}),
                  ...(corner === "topRight" ? { right: 22, top: 22 } : {}),
                  ...(corner === "topLeft" ? { left: 22, top: 22 } : {}),
                  width: Math.round(camSize * 1080),
                  height: Math.round(camSize * 1080),
                  borderRadius: shape === "circle" ? "50%" : 12,
                  borderColor: pipHasVideo ? "#ffffff" : "var(--color-pk-hairline)",
                  boxShadow: pipHasVideo ? "0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.9) inset" : "0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.06) inset",
                }}
              >
                {/* Backdrop, always mounted: whatever the video is doing, the
                    slot reads as a camera rather than a black hole. */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-pk-canvas p-4 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-pk-hairline bg-white">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-pk-faint)" strokeWidth="1.7"><path d="M16 16l4 4M2 12a10 10 0 1 0 20 0 10 10 0 0 0-20 0z" /><path d="M10 10a2 2 0 1 1 4 0 2 2 0 0 1-4 0z" /></svg>
                  </div>
                  <p className="pk-ui text-[11px] font-medium text-pk-body">
                    {pipHasVideo ? "Starting camera…" : "No camera"}
                  </p>
                  {!pipHasVideo && (
                    <p className="pk-help text-[10px]">Enable camera or check permissions</p>
                  )}
                </div>
                {pipHasVideo && (
                  state === "recording" ? (
                    <video key="live" ref={setFacecamLiveCb} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  ) : (
                    <video key="preview" ref={setCameraPreviewCb} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
                  )
                )}
              </div>
            )}

            {/* Camera moved to the floating window — mark the spot it will
                occupy in the finished video, without a second live view. */}
            {wantsCameraSlot && cameraIsFloating && (
              <div
                className="pointer-events-none absolute flex flex-col items-center justify-center gap-1.5 border-2 border-dashed text-center"
                style={{
                  ...(corner === "bottomRight" ? { right: 22, bottom: 22 } : {}),
                  ...(corner === "bottomLeft" ? { left: 22, bottom: 22 } : {}),
                  ...(corner === "topRight" ? { right: 22, top: 22 } : {}),
                  ...(corner === "topLeft" ? { left: 22, top: 22 } : {}),
                  width: Math.round(camSize * 1080),
                  height: Math.round(camSize * 1080),
                  borderRadius: shape === "circle" ? "50%" : 12,
                  borderColor: "rgba(255,255,255,0.32)",
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.7">
                  <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" />
                </svg>
                <p className="px-3 text-[11px] font-medium leading-tight" style={{ color: "rgba(255,255,255,0.72)" }}>
                  Camera is in the floating window
                </p>
              </div>
            )}

            {/* Countdown overlay */}
            {countdown !== null && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/55 backdrop-blur-[1px]">
                <div
                  key={countdown}
                  className="flex h-24 w-24 items-center justify-center rounded-full text-5xl font-black text-white shadow-2xl animate-[ping_700ms_ease-out]"
                  style={{ background: "var(--color-pk-ink-strong)", boxShadow: "0 0 48px var(--color-accent-glow)", animation: "countPulse 700ms ease-out" }}
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
                  <span className="pk-glass-label">Teleprompter — drag to move</span>
                  <button onClick={() => setTeleOpen(false)} className="pk-glass-btn h-6 w-6 !p-0" title="Close teleprompter" aria-label="Close teleprompter">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="relative h-[180px] overflow-hidden">
                  <div className="absolute inset-0 overflow-hidden px-5 py-4">
                    <div className="whitespace-pre-wrap text-center text-[15px] leading-7" style={{ color: "white", transform: `translateY(${-teleOffset}px)`, textShadow: "0 1px 10px rgba(0,0,0,0.6)" }}>{teleText}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t px-3 py-2" style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.35)" }}>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setTeleOffset((o) => Math.max(0, o - 60))} className="pk-glass-btn">Rewind</button>
                    <button onClick={() => setTelePlaying((p) => !p)} className="pk-glass-btn" data-active={telePlaying}>{telePlaying ? "Pause" : "Play"}</button>
                    <button onClick={() => setTeleOffset((o) => o + 60)} className="pk-glass-btn">Forward</button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setTeleSpeed((s) => Math.max(0.1, +(s - 0.1).toFixed(1)))} className="pk-glass-btn h-6 w-6 !p-0" aria-label="Slower">−</button>
                    <span className="min-w-[36px] text-center font-mono text-xs text-white">{teleSpeed.toFixed(1)}×</span>
                    <button onClick={() => setTeleSpeed((s) => Math.min(2, +(s + 0.1).toFixed(1)))} className="pk-glass-btn h-6 w-6 !p-0" aria-label="Faster">+</button>
                    <button onClick={() => setTeleOffset(0)} className="pk-glass-btn ml-1">Reset</button>
                  </div>
                </div>
              </div>
            )}

            {/* Floating layout switcher — idle only, centered bottom — reference pattern: grid pill, blur, icons */}
            {state === "idle" && (
              <div className="pk-shadow-md absolute bottom-6 left-1/2 z-10 grid -translate-x-1/2 grid-flow-col auto-cols-fr gap-1 rounded-[var(--radius-pk-card)] border border-pk-hairline bg-white/95 p-1.5 backdrop-blur-[6px]">
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
                      className="pk-ui grid justify-items-center gap-[10px] rounded-[var(--radius-pk-btn)] border-0 px-4 pb-3 pt-[18px] text-[12px] font-medium leading-4 transition-colors hover:text-pk-blue"
                      style={{
                        background: isActive ? "var(--color-pk-blue-soft)" : "transparent",
                        color: isActive ? "var(--color-pk-blue)" : "var(--color-pk-faint)",
                      }}
                      aria-pressed={isActive}
                    >
                      <span
                        className="flex h-5 w-8 items-center justify-center rounded-[7px] p-1"
                        style={{
                          border: `1px solid ${isActive ? "var(--color-pk-blue)" : "var(--color-pk-hairline)"}`,
                          background: "var(--color-pk-surface)",
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
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-pk-hairline bg-pk-surface px-4 py-3">
            {/* Left: device & shape */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Camera */}
              <div className="flex items-center gap-1.5 rounded-[var(--radius-pk-btn)] border border-pk-hairline bg-pk-canvas p-1">
                <button
                  onClick={() => setCameraEnabled((v) => !v)}
                  disabled={layout === "screenOnly"}
                  className="pk-icon-btn h-7 w-7"
                  data-active={cameraEnabled && layout !== "screenOnly"}
                  title={cameraEnabled ? "Camera on (click to mute)" : "Camera off"}
                  aria-pressed={cameraEnabled}
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
                  className="pk-select max-w-[150px] border-0 bg-transparent"
                  aria-label="Camera device"
                >
                  {cameras.length === 0 && <option>No cameras</option>}
                  {cameras.map((c) => (
                    <option key={c.deviceId} value={c.deviceId}>
                      {c.label || `Camera ${c.deviceId.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mic */}
              <div className="flex items-center gap-1.5 rounded-[var(--radius-pk-btn)] border border-pk-hairline bg-pk-canvas p-1">
                <button
                  onClick={() => setMicEnabled((v) => !v)}
                  className="pk-icon-btn h-7 w-7"
                  data-active={micEnabled}
                  title={micEnabled ? "Mic on" : "Mic muted"}
                  aria-pressed={micEnabled}
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
                  className="pk-select max-w-[150px] border-0 bg-transparent"
                  aria-label="Microphone device"
                >
                  {mics.length === 0 && <option>No mics</option>}
                  {mics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      {m.label || `Mic ${m.deviceId.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Shape */}
              <div className="hidden items-center gap-1.5 rounded-[var(--radius-pk-btn)] border border-pk-hairline bg-pk-canvas p-1 sm:flex">
                <span className="pk-label pl-1.5">Shape</span>
                <button onClick={() => setShape("square")} className="pk-icon-btn h-7 w-7" data-active={shape === "square"} title="Square camera" aria-pressed={shape === "square"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="2" /></svg>
                </button>
                <button onClick={() => setShape("circle")} className="pk-icon-btn h-7 w-7" data-active={shape === "circle"} title="Circle camera" aria-pressed={shape === "circle"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="8" /></svg>
                </button>
              </div>

              {/* Camera position — where the bubble lands in the finished video */}
              {layout === "screenAndCamera" && cameraEnabled && (
                <div className="hidden items-center gap-2 rounded-[var(--radius-pk-btn)] border border-pk-hairline bg-pk-canvas p-1 md:flex">
                  <span className="pk-label pl-1.5">Camera</span>
                  <div className="grid grid-cols-2 gap-[3px] rounded-[7px] border border-pk-hairline bg-pk-surface p-[4px]">
                    {(["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setCorner(c)}
                        title={CORNER_LABELS[c]}
                        aria-label={CORNER_LABELS[c]}
                        aria-pressed={corner === c}
                        className="h-[9px] w-[13px] rounded-[2px] transition-colors hover:opacity-80"
                        style={{
                          background: corner === c ? "var(--color-pk-ink-strong)" : "var(--color-pk-hairline)",
                        }}
                      />
                    ))}
                  </div>
                  <input
                    type="range"
                    min={0.12}
                    max={0.36}
                    step={0.02}
                    value={camSize}
                    onChange={(e) => setCamSize(Number(e.target.value))}
                    className="pk-range w-16"
                    title="Camera size"
                    aria-label="Camera size"
                  />
                </div>
              )}

              {/* Teleprompter toggle */}
              <button
                onClick={() => setTeleOpen((v) => !v)}
                className="pk-seg hidden sm:inline-flex items-center gap-1.5"
                data-active={teleOpen}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
                Teleprompter
              </button>
            </div>

            {/* Center: main record */}
            <div className="flex items-center gap-2">
              {state === "idle" && (
                <>
                  <button onClick={handleClose} className="pk-btn pk-btn-ghost pk-btn-md">
                    Cancel
                  </button>
                  <button onClick={handleStart} className="pk-btn pk-btn-record pk-btn-md" style={{ boxShadow: "0 6px 20px rgba(225,29,72,0.28)" }}>
                    <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
                    Record
                  </button>
                </>
              )}
              {state === "countingDown" && (
                <div className="pk-chip pk-chip-red">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pk-red" />
                  Starting…
                </div>
              )}
              {state === "recording" && (
                <button onClick={handleStop} className="pk-btn pk-btn-ghost pk-btn-md">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-pk-red" />
                  Stop & Import
                </button>
              )}
              {state === "stopping" && (
                <div className="pk-chip">Processing…</div>
              )}
            </div>

            {/* Right: hint */}
            <div className="pk-help hidden items-center gap-2 lg:flex">
              {bubbleSuppressed ? (
                <span>Floating camera closed — it would be captured in a full-screen share</span>
              ) : layout !== "screenOnly" && cameraEnabled ? (
                pipSupported ? (
                  <span>Camera floats above other apps · share a window, not the whole screen</span>
                ) : (
                  <span>Floating camera needs Chrome or Edge</span>
                )
              ) : (
                <span>Local only</span>
              )}
              <span className="h-1 w-1 rounded-full bg-pk-faint" />
              <span className="hidden sm:inline">No upload</span>
            </div>
          </div>

          {/* Teleprompter editor when open and idle (show textarea) */}
          {teleOpen && state === "idle" && (
            <div className="border-t border-pk-hairline bg-pk-canvas p-3">
              <textarea
                value={teleText}
                onChange={(e) => setTeleText(e.target.value)}
                placeholder="Paste your script here…"
                rows={3}
                className="w-full resize-none rounded-[var(--radius-pk-inner)] border border-pk-hairline bg-pk-surface p-3 font-sans text-sm leading-relaxed text-pk-body outline-none transition placeholder:text-pk-faint focus:border-pk-blue"
              />
            </div>
          )}

          {error && (
            <div className="pk-ui border-t border-pk-hairline bg-[#fff1f4] px-4 py-2.5 text-xs font-medium text-pk-red">
              {error}
            </div>
          )}

          <div className="pk-help shrink-0 border-t border-pk-hairline bg-pk-surface px-4 py-2.5 text-center">
            Press <span className="pk-kbd">E</span> camera · <span className="pk-kbd">D</span> mic · <span className="pk-kbd">Esc</span> close
          </div>
        </div>
      </div>
    </div>
  );
}
