/**
 * OWNER: DEV B — capture ONLY (ROADMAP-B.md Task 2.5).
 * getDisplayMedia(video only; mic rides facecam stream) + getUserMedia(webcam+mic),
 * two MediaRecorders, stop() → { screenBlob, facecamBlob }.
 * Blobs become a project via engine.loadRecording(...) whose DEMUX half is DEV A's
 * decode.ts — you never parse containers, they never touch your streams.
 * Signature: startRecording(): Promise<RecordingHandles>
 */
export {};
