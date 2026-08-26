/**
 * OWNER: DEV B — ROADMAP-B.md Task 3.2. Lazy-loaded ONLY when captions are requested.
 * Receives { type:"transcribe", audio: Float32Array } (mono, 16kHz),
 * loads Xenova/whisper-base via @xenova/transformers (add dep on Day 3),
 * posts { type:"progress", progress } then { type:"result", captions: Caption[] }.
 */
export {};
