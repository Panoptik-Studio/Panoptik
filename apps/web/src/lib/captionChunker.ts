/**
 * OWNER: DEV B — ROADMAP-B.md Day 4.
 * Caption post-processing: filter negative durations, merge into ≤42-char display chunks.
 */

type Caption = { text: string; start: number; end: number };

const MAX_CHUNK_CHARS = 42;

/**
 * Post-process raw Whisper output:
 * 1. Filter out captions with negative or zero duration
 * 2. Merge adjacent short words into display chunks ≤ MAX_CHUNK_CHARS
 */
export function postProcessCaptions(raw: Caption[]): Caption[] {
  // 1. Filter negative/zero durations
  const valid = raw.filter((c) => c.end > c.start);

  if (valid.length === 0) return [];

  // 2. Merge adjacent words into chunks
  const chunks: Caption[] = [];
  let current = { ...valid[0]! };

  for (let i = 1; i < valid.length; i++) {
    const next = valid[i]!;
    const mergedText = `${current.text} ${next.text}`;

    // Merge if: combined text is short enough AND words are temporally adjacent (gap < 0.3s)
    const gap = next.start - current.end;
    if (
      mergedText.length <= MAX_CHUNK_CHARS &&
      gap < 0.3 &&
      gap >= -0.1
    ) {
      current = {
        text: mergedText,
        start: current.start,
        end: next.end,
      };
    } else {
      chunks.push(current);
      current = { ...next };
    }
  }
  chunks.push(current);

  return chunks;
}
