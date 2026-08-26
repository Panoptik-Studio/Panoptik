/**
 * OWNER: DEV A — ROADMAP-A.md Task 2.3. UNIFIED with decode.ts:
 * the same mediabunny Input opened by loadClip also yields AudioSampleSink
 * (single-pass demux — no duplicate container parsing or inter-module races).
 * Signature: getAudioBuffer(project): Promise<AudioBuffer | null>
 * Concatenate sample chunks at running offsets into one mono AudioBuffer.
 */
export {};
