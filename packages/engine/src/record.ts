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

/** Longest we wait for a recorder's final chunk before giving up on it. */
const FLUSH_TIMEOUT_MS = 4000;

/** Stop a recorder and resolve once its last chunk has been delivered. */
function flushRecorder(rec: MediaRecorder | null): Promise<void> {
  if (!rec || rec.state === "inactive") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, FLUSH_TIMEOUT_MS);
    rec.addEventListener("stop", done, { once: true });
    try {
      rec.stop();
    } catch {
      done();
    }
  });
}

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

  // ── Screen capture (skip for cameraOnly) — high quality, minimal padding (native res, no extra bars)
  if (layout !== "cameraOnly") {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 },
        cursor: "always",
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        displaySurface: "monitor",
      } as unknown as MediaTrackConstraints,
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

  // ── Camera + mic (skip for screenOnly or when disabled) — high quality 1080p
  if (layout !== "screenOnly" && cameraEnabled) {
    try {
      facecamStream = await navigator.mediaDevices.getUserMedia({
        video: cameraDeviceId
          ? { deviceId: { exact: cameraDeviceId }, width: 1920, height: 1080, frameRate: { ideal: 30 }, facingMode: "user" }
          : { width: 1920, height: 1080, frameRate: { ideal: 30 }, facingMode: "user" },
        audio: microphoneEnabled
          ? microphoneDeviceId
            ? { deviceId: { exact: microphoneDeviceId }, echoCancellation: true, noiseSuppression: true }
            : { echoCancellation: true, noiseSuppression: true }
          : false,
      });
    } catch {
      // Fallback: try without exact deviceId (permission or over-constrained) — still high quality
      try {
        facecamStream = await navigator.mediaDevices.getUserMedia({
          video: cameraEnabled ? { width: 1280, height: 720, frameRate: { ideal: 30 } } : false,
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

  // ── MediaRecorders — high quality: vp9 preferred, 8 Mbps screen, 2.5 Mbps cam
  const screenMime =
    ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) || "video/webm";

  const facecamMime =
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
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
      MediaRecorder.isTypeSupported(screenMime)
        ? { mimeType: screenMime, videoBitsPerSecond: 8_000_000 }
        : { videoBitsPerSecond: 8_000_000 } as Record<string, unknown>,
    );
    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };
    screenRecorder.start(100);
  }

  if (facecam.getTracks().length > 0) {
    facecamRecorder = new MediaRecorder(
      facecam,
      MediaRecorder.isTypeSupported(facecamMime)
        ? { mimeType: facecamMime, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 } as unknown as MediaRecorderOptions
        : { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 } as unknown as MediaRecorderOptions,
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
      // Wait for the "stop" event, which the spec fires only after the final
      // dataavailable. Polling `state` instead would resolve immediately —
      // `stop()` flips it to "inactive" synchronously — and drop the last chunk.
      await Promise.all([flushRecorder(screenRecorder), flushRecorder(facecamRecorder)]);

      // Only now release the devices; stopping tracks first can truncate the tail.
      screen.getTracks().forEach((t) => t.stop());
      facecam.getTracks().forEach((t) => t.stop());

      return {
        screenBlob: new Blob(screenChunks, { type: screenRecorder?.mimeType || "video/webm" }),
        facecamBlob: new Blob(facecamChunks, { type: facecamRecorder?.mimeType || "video/webm" }),
      };
    },
  };
}
