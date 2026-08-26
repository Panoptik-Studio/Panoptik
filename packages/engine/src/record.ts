/**
 * OWNER: DEV B — dual-stream capture (ROADMAP-B.md Task 2.5).
 * getDisplayMedia (video only; mic rides facecam stream)
 * + getUserMedia (webcam + mic), two MediaRecorders.
 * stop() → { screenBlob, facecamBlob }.
 * Blobs become a project via engine.loadRecording(...) — DEV A's decode.ts handles demux.
 */

export type RecordingHandles = {
  screenStream: MediaStream;
  facecamStream: MediaStream;
  stop: () => Promise<{
    screenBlob: Blob;
    facecamBlob: Blob;
  }>;
};

export async function startRecording(): Promise<RecordingHandles> {
  // Screen capture — video only (no audio; mic rides facecam)
  const screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 60 }, cursor: "always" } as any,
    audio: false,
  });

  // Webcam + mic — single audio source
  let facecamStream: MediaStream;
  try {
    facecamStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 360 },
      audio: true,
    });
  } catch {
    // No webcam/mic — create a silent facecam stream
    facecamStream = new MediaStream();
  }

  // Screen recorder — pick supported mimeType (no audio on screen track)
  const screenMime =
    ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) || "video/webm";
  const screenRecorder = new MediaRecorder(
    screenStream,
    MediaRecorder.isTypeSupported(screenMime) ? { mimeType: screenMime } : {},
  );
  const screenChunks: Blob[] = [];
  screenRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) screenChunks.push(e.data);
  };

  // Facecam recorder — pick supported mimeType (has mic audio)
  const facecamMime =
    ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find(
      (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
    ) || "video/webm";
  const facecamRecorder = new MediaRecorder(
    facecamStream,
    MediaRecorder.isTypeSupported(facecamMime) ? { mimeType: facecamMime } : {},
  );
  const facecamChunks: Blob[] = [];
  facecamRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) facecamChunks.push(e.data);
  };

  screenRecorder.start(100); // 100ms chunks
  facecamRecorder.start(100);

  return {
    screenStream,
    facecamStream,
    stop: async () => {
      // Stop recording
      if (screenRecorder.state !== "inactive") screenRecorder.stop();
      if (facecamRecorder.state !== "inactive")
        facecamRecorder.stop();

      // Stop all tracks
      screenStream.getTracks().forEach((t) => t.stop());
      facecamStream.getTracks().forEach((t) => t.stop());

      // Wait for ondataavailable to flush
      await new Promise<void>((resolve) => {
        const check = () => {
          if (
            screenRecorder.state === "inactive" &&
            facecamRecorder.state === "inactive"
          ) {
            resolve();
          } else {
            setTimeout(check, 50);
          }
        };
        check();
      });

      // Use the actual mimeType that was negotiated
      return {
        screenBlob: new Blob(screenChunks, {
          type: screenRecorder.mimeType || "video/webm",
        }),
        facecamBlob: new Blob(facecamChunks, {
          type: facecamRecorder.mimeType || "video/webm",
        }),
      };
    },
  };
}
