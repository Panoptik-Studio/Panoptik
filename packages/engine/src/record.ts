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
  /**
   * Begin encoding. Separate from acquisition because the permission prompts
   * have to happen up front, while the countdown runs afterwards — encoding
   * from acquisition would put the countdown at the head of every take.
   */
  begin: () => Promise<void>;
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
  systemAudioDeviceId?: string;
  cameraEnabled?: boolean;
  microphoneEnabled?: boolean;
  systemAudioEnabled?: boolean;
  /**
   * An already-open camera stream to record from. Opening a second stream to
   * the same physical camera makes the device renegotiate, which drops frames
   * in every view of it. The caller keeps ownership: stop() will not close it.
   */
  cameraStream?: MediaStream | null;
};

/** Longest we wait for a recorder's final chunk before giving up on it. */
const FLUSH_TIMEOUT_MS = 4000;

/**
 * Longest we wait for the captured surface to settle. The OS compositor takes a
 * moment to spin up; beyond this we start anyway rather than leave the user
 * staring at a dead Record button.
 */
const FIRST_FRAME_TIMEOUT_MS = 5000;

/**
 * How many frames must arrive before we call the surface ready.
 *
 * Waiting for a single frame is not enough: macOS delivers frame one almost
 * immediately and then takes seconds over frame two, so the recording opens on
 * one still image held for the whole ramp-up. Requiring a few consecutive
 * frames means the pipeline is genuinely producing before anything is encoded.
 */
const WARMUP_FRAMES = 3;

/**
 * Resolve once the stream is genuinely producing frames.
 *
 * getDisplayMedia resolves as soon as the user picks a surface, but the capture
 * pipeline is not running yet: the first frame can be seconds behind, and the
 * next few seconds behind that. The camera and microphone are live well before
 * either, so starting every encoder together opened the take on a frozen
 * picture over live audio. Waiting for the surface to settle lines them up.
 */
async function waitForFirstFrame(stream: MediaStream): Promise<void> {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof document === "undefined") return;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  // Detached elements are not reliably driven, so park it out of sight.
  video.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, FIRST_FRAME_TIMEOUT_MS);

      const rvfc = (video as unknown as {
        requestVideoFrameCallback?: (cb: () => void) => number;
      }).requestVideoFrameCallback;
      if (typeof rvfc === "function") {
        // Each callback is a genuinely presented frame. Chain a few so we know
        // the surface is delivering at rate, not just once.
        let seen = 0;
        const onFrame = () => {
          if (++seen >= WARMUP_FRAMES) done();
          else rvfc.call(video, onFrame);
        };
        rvfc.call(video, onFrame);
      } else {
        video.addEventListener("loadeddata", done, { once: true });
      }
      video.play().catch(done);
    });
  } finally {
    video.srcObject = null;
    video.remove();
  }
}

/**
 * Ask for far more than any webcam provides and let the browser settle on the
 * device's best mode — naming 1280x720 pins it there even on a 4K camera.
 */
export const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 3840 },
  height: { ideal: 2160 },
  aspectRatio: 16 / 9,
  frameRate: { ideal: 30 },
  facingMode: "user",
};

/** Open the camera, falling back to an unpinned device if the exact id fails. */
export async function openCameraTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
  const attempts: MediaStreamConstraints[] = [
    { video: deviceId ? { ...CAMERA_CONSTRAINTS, deviceId: { exact: deviceId } } : CAMERA_CONSTRAINTS, audio: false },
    { video: CAMERA_CONSTRAINTS, audio: false },
    { video: true, audio: false },
  ];
  for (const constraints of attempts) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      const track = s.getVideoTracks()[0];
      if (track) return track;
      s.getTracks().forEach((t) => t.stop());
    } catch { /* try the next, looser attempt */ }
  }
  return null;
}

/**
 * Bits per second for a track, from its real frame size: bitsPerPixelPerFrame
 * times pixels times fps, clamped. Falls back to `min` when the track has not
 * reported settings yet.
 */
function bitrateFor(
  track: MediaStreamTrack | undefined,
  bitsPerPixelPerFrame: number,
  min: number,
  max: number,
): number {
  const s = track?.getSettings?.();
  if (!s?.width || !s?.height) return min;
  const fps = s.frameRate && s.frameRate > 0 ? s.frameRate : 30;
  const estimate = s.width * s.height * fps * bitsPerPixelPerFrame;
  return Math.round(Math.min(max, Math.max(min, estimate)));
}

export async function openMicrophoneTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  for (const constraints of [{ audio, video: false }, { audio: true, video: false }]) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
      const track = s.getAudioTracks()[0];
      if (track) return track;
      s.getTracks().forEach((t) => t.stop());
    } catch { /* try the next, looser attempt */ }
  }
  return null;
}

/**
 * Opens a system desktop audio monitor / loopback track with zero DSP filtering.
 * CRITICAL: Must ONLY open a verified monitor / loopback input device.
 * Never opens the default microphone if no monitor device is found.
 */
export async function openSystemAudioTrack(deviceId?: string): Promise<MediaStreamTrack | null> {
  if (!deviceId || deviceId === "none") return null;

  const audio: MediaTrackConstraints = {
    deviceId: { exact: deviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
  };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    const track = s.getAudioTracks()[0];
    if (track) return track;
    s.getTracks().forEach((t) => t.stop());
  } catch (err) {
    console.warn("[Record] Failed to open system audio monitor device", err);
  }
  return null;
}

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
    systemAudioDeviceId,
    cameraEnabled = true,
    microphoneEnabled = true,
    systemAudioEnabled = true,
  } = opts;

  let screenStream: MediaStream | null = null;
  let facecamStream: MediaStream | null = null;

  // Tracks this call opened, and is therefore responsible for closing. A camera
  // handed in by the caller is shared with the preview and the bubble, so
  // stopping it here would kill their picture.
  const ownedTracks = new Set<MediaStreamTrack>();

  // ── Screen capture (skip for cameraOnly) ──
  if (layout !== "cameraOnly") {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 },
        // No width/height cap: asking for 1920x1080 downscales a retina
        // display. Take the surface at whatever it natively is.
        cursor: "always",
        // Prefer a window over the whole monitor. Capturing the monitor also
        // captures the floating camera bubble, and the compositor renders that
        // window's video as a solid black rectangle in the capture.
        displaySurface: "window",
      } as unknown as MediaTrackConstraints,
      audio: true,
      // Keep this tab out of the picker: capturing it would recurse the
      // recorder UI into its own recording.
      selfBrowserSurface: "exclude",
    } as DisplayMediaStreamOptions);
    screenStream.getTracks().forEach((t) => ownedTracks.add(t));

    // Check if getDisplayMedia returned an audio track natively (e.g. Chrome tab share)
    const existingAudio = screenStream.getAudioTracks()[0];

    // If system audio monitor is requested or needed when getDisplayMedia has no audio (e.g. Linux full screen/window)
    if (systemAudioEnabled) {
      if (systemAudioDeviceId || !existingAudio) {
        const sysTrack = await openSystemAudioTrack(systemAudioDeviceId);
        if (sysTrack) {
          // If a custom monitor device was explicitly selected, prefer it over default tab audio
          if (existingAudio && systemAudioDeviceId) {
            screenStream.removeTrack(existingAudio);
            existingAudio.stop();
            ownedTracks.delete(existingAudio);
          }
          screenStream.addTrack(sysTrack);
          ownedTracks.add(sysTrack);
          console.log("[Record] Attached system audio monitor track to screen stream");
        }
      }
    }

    // If user cancelled screen share, getDisplayMedia will have thrown already.
    // Auto-stop if track ends (user clicks browser "Stop sharing").
    screenStream.getVideoTracks()[0]?.addEventListener("ended", () => {
      // Caller can listen via onended if needed; we just let the stream end.
    });
  } else {
    screenStream = new MediaStream();
  }

  // ── Camera + mic (skip for screenOnly or when disabled) ──
  // The camera and mic are gathered as individual tracks and only then wrapped
  // in a stream, so the caller's camera object is never mutated or re-opened.
  facecamStream = new MediaStream();
  const wantsCamera = layout !== "screenOnly" && cameraEnabled;

  if (wantsCamera) {
    const shared = opts.cameraStream?.getVideoTracks().find((t) => t.readyState === "live");
    if (shared) {
      // Reuse the caller's camera. Opening the same device twice makes it
      // renegotiate, which stutters every view of it.
      facecamStream.addTrack(shared);
    } else {
      const camTrack = await openCameraTrack(cameraDeviceId);
      if (camTrack) {
        facecamStream.addTrack(camTrack);
        ownedTracks.add(camTrack);
      }
    }
  }

  // Narration is wanted for every layout, including screen-only — the mic is
  // not tied to the camera.
  if (microphoneEnabled) {
    const micTrack = await openMicrophoneTrack(microphoneDeviceId);
    if (micTrack) {
      facecamStream.addTrack(micTrack);
      ownedTracks.add(micTrack);
    }
  }

  const screen = screenStream!;
  const facecam = facecamStream!;

  // ── MediaRecorders ──
  // Bitrate is scaled to the pixels actually being captured: a fixed 8 Mbps is
  // generous for 720p and visibly lossy for a 4K screen full of text.
  const screenBitrate = bitrateFor(screen.getVideoTracks()[0], 0.12, 8_000_000, 60_000_000);
  const facecamBitrate = bitrateFor(facecam.getVideoTracks()[0], 0.1, 4_000_000, 24_000_000);

  // Prefer HW-encode (H264/HEVC/AVC) — VP8 is SW-only on Mesa renoir (about:support VP8 HW Unsupported)
  // so 1920p60 vp8 → 13fps SW, while avc1 → 60fps HW. Keep webm fallback for browsers without mp4.
  const screenMime =
    [
      "video/mp4;codecs=avc1,opus",
      "video/mp4;codecs=avc1,aac",
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=avc1,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "video/webm";

  const facecamMime =
    [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=h264,opus",
      "video/webm;codecs=avc1,opus",
      "video/webm",
      "video/mp4;codecs=avc1,opus",
      "video/mp4",
    ].find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) || "video/webm";

  // Everything starts from the same instant. The screen is the last source to
  // come alive, so the encoders wait on its first frame — otherwise the camera
  // and microphone, live since the recorder opened, run on for seconds while
  // the screen has nothing to record.
  if (screen.getVideoTracks().length > 0) {
    await waitForFirstFrame(screen);
  }

  // Only create recorders for non-empty streams
  let screenRecorder: MediaRecorder | null = null;
  let facecamRecorder: MediaRecorder | null = null;
  const screenChunks: Blob[] = [];
  const facecamChunks: Blob[] = [];

  if (screen.getTracks().length > 0) {
    screenRecorder = new MediaRecorder(
      screen,
      MediaRecorder.isTypeSupported(screenMime)
        ? ({ mimeType: screenMime, videoBitsPerSecond: screenBitrate, audioBitsPerSecond: 192_000 } as unknown as MediaRecorderOptions)
        : ({ videoBitsPerSecond: screenBitrate, audioBitsPerSecond: 192_000 } as unknown as MediaRecorderOptions),
    );
    screenRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) screenChunks.push(e.data);
    };
  }

  if (facecam.getTracks().length > 0) {
    facecamRecorder = new MediaRecorder(
      facecam,
      MediaRecorder.isTypeSupported(facecamMime)
        ? { mimeType: facecamMime, videoBitsPerSecond: facecamBitrate, audioBitsPerSecond: 192_000 } as unknown as MediaRecorderOptions
        : { videoBitsPerSecond: facecamBitrate, audioBitsPerSecond: 192_000 } as unknown as MediaRecorderOptions,
    );
    facecamRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) facecamChunks.push(e.data);
    };
  }

  // If both recorders are null (shouldn't happen), throw early
  if (!screenRecorder && !facecamRecorder) {
    // Still return handles so caller can stop tracks
    return {
      screenStream: screen,
      facecamStream: facecam,
      begin: async () => {},
      layout,
      shape,
      stop: async () => {
        ownedTracks.forEach((t) => t.stop());
        return { screenBlob: new Blob([], { type: "video/webm" }), facecamBlob: new Blob([], { type: "video/webm" }) };
      },
    };
  }

  return {
    screenStream: screen,
    facecamStream: facecam,
    layout,
    shape,
    begin: async () => {
      // One synchronous instant for every source, after the countdown.
      if (screenRecorder && screenRecorder.state === "inactive") screenRecorder.start(100);
      if (facecamRecorder && facecamRecorder.state === "inactive") facecamRecorder.start(100);
    },
    stop: async () => {
      await Promise.all([flushRecorder(screenRecorder), flushRecorder(facecamRecorder)]);
      const screenBlob = new Blob(screenChunks, { type: screenRecorder?.mimeType || "video/webm" });
      const facecamBlob = new Blob(facecamChunks, { type: facecamRecorder?.mimeType || "video/webm" });

      // Only now release the devices; stopping tracks first can truncate the
      // tail. A camera passed in by the caller is not ours to close.
      ownedTracks.forEach((t) => t.stop());

      return {
        screenBlob,
        facecamBlob,
      };
    },
  };
}
