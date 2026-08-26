/**
 * OWNER: DEV B — dual-stream capture (ROADMAP-B.md Task 2.5).
 * Supports layout modes + device selection, like the reference recorder
 * but on our stack (getDisplayMedia / getUserMedia / MediaRecorder only).
 * screenOnly → screenStream + no facecam
 * screenAndCamera → screenStream + facecam (video + mic)
 * cameraOnly → facecam only (no screen)
 * Blobs become a project via engine.loadRecording(...) — DEV A's decode.ts handles demux.
 */

export type RecordingLayout = "screenOnly" | "screenAndCamera" | "cameraOnly";
export type RecordingShape = "circle" | "square";

export type RecordingHandles = {
  screenStream: MediaStream;
  facecamStream: MediaStream;
  layout: RecordingLayout;
  shape: RecordingShape;
  stop: () => Promise<{
    screenBlob: Blob;
    facecamBlob: Blob;
  }>;
};

export type StartRecordingOpts = {
  layout?: RecordingLayout;
  shape?: RecordingShape;
  cameraDeviceId?: string;
  microphoneDeviceId?: string;
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
};

export async function startRecording(opts: StartRecordingOpts = {}): Promise<RecordingHandles> {
  const {
    layout = "screenAndCamera",
    shape = "circle",
    cameraDeviceId,
    microphoneDeviceId,
    cameraEnabled = true,
    microphoneEnabled = true,
  } = opts;

  let screenStream: MediaStream | null = null;
  let facecamStream: MediaStream | null = null;

  // ── Screen capture (skip for cameraOnly) ──
  if (layout !== "cameraOnly") {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, cursor: "always" } as any,
      audio: false,
    });
    // If user cancelled screen share, getDisplayMedia will have thrown already.
    // Auto-stop if track ends (user clicks browser "Stop sharing").
    screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      // Caller can listen via onended if needed; we just let the stream end.
    });
  } else {
    screenStream = new MediaStream();
  }

  // ── Camera + mic (skip for screenOnly or when disabled) ──
  if (layout !== "screenOnly" && cameraEnabled) {
    try {
      facecamStream = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceId
          ? { deviceId: { exact: cameraDeviceId }, width: 1280, height: 720, facingMode: "user" }
          : { width: 1280, height: 720, facingMode: "user" },
        audio: microphoneEnabled
          ? microphoneDeviceId
            ? { deviceId: { exact: microphoneDeviceId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true }
          : false,
      });
    } catch {
      // Fallback: try without exact deviceId (permission or over-constrained)
      try {
        facecamStream = await navigator.mediaDevices.getUserMedia({
          video: cameraEnabled ? { width: 640, height: 360 } : false,
          audio: microphoneEnabled ? true : false,
        } as MediaStreamConstraints);
      } catch {
        facecamStream = new MediaStream();
      }
    }
  } else if (layout !== "screenOnly" && !cameraEnabled && microphoneEnabled) {
    // Camera off but mic on → audio-only facecam stream
    try {
      facecamStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: microphoneDeviceId
          ? { deviceId: { exact: microphoneDeviceId } }
          : true,
      });
    } catch {
      facecamStream = new MediaStream();
    }
  } else {
    facecamStream = new MediaStream();
  }

  const screen = screenStream!;
  const facecam = facecamStream!;

  // ── MediaRecorders — pick best supported mime ──
  const screenMime =
    ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) || "video/webm";

  const facecamMime =
    ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) || "video/webm";

  // Only create recorders for non-empty streams
  let screenRecorder: MediaRecorder | null = null;
  let facecamRecorder: MediaRecorder | null = null;
  const screenChunks: Blob[] = [];
  const facecamChunks: Blob[] = [];

  if (screen.getTracks().length > 0) {
    screenRecorder = new MediaRecorder(
      screen,
      MediaRecorder.isTypeSupported(screenMime) ? { mimeType: screenMime } : {},
    );
    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };
    screenRecorder.start(100);
  }

  if (facecam.getTracks().length > 0) {
    facecamRecorder = new MediaRecorder(
      facecam,
      MediaRecorder.isTypeSupported(facecamMime) ? { mimeType: facecamMime } : {},
    );
    facecamRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) facecamChunks.push(e.data);
    };
    facecamRecorder.start(100);
  }

  // If both recorders are null (shouldn't happen), throw early
  if (!screenRecorder && !facecamRecorder) {
    // Still return handles so caller can stop tracks
    return {
      screenStream: screen,
      facecamStream: facecam,
      layout,
      shape,
      stop: async () => {
        screen.getTracks().forEach((t) => t.stop());
        facecam.getTracks().forEach((t) => t.stop());
        return { screenBlob: new Blob([], { type: "video/webm" }), facecamBlob: new Blob([], { type: "video/webm" }) };
      },
    };
  }

  return {
    screenStream: screen,
    facecamStream: facecam,
    layout,
    shape,
    stop: async () => {
      if (screenRecorder && screenRecorder.state !== "inactive") screenRecorder.stop();
      if (facecamRecorder && facecamRecorder.state !== "inactive") facecamRecorder.stop();

      screen.getTracks().forEach((t) => t.stop());
      facecam.getTracks().forEach((t) => t.stop());

      // Wait for flush
      await new Promise<void>((resolve) => {
        const check = () => {
          const sDone = !screenRecorder || screenRecorder.state === "inactive";
          const fDone = !facecamRecorder || facecamRecorder.state === "inactive";
          if (sDone && fDone) resolve();
          else setTimeout(check, 50);
        };
        check();
      });

      return {
        screenBlob: new Blob(screenChunks, { type: screenRecorder?.mimeType || "video/webm" }),
        facecamBlob: new Blob(facecamChunks, { type: facecamRecorder?.mimeType || "video/webm" }),
      };
    },
  };
}
