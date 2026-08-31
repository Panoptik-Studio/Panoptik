/**
 * Phrase-level transcript packing for Panoptik.
 * Compresses raw word-level JSON into compact phrase lines (~89% token reduction)
 * while preserving boundary timestamps for editorial cuts.
 */

import type { DiarizedWord } from "./audioPayload";

export interface PackedPhrase {
  start: number;
  end: number;
  text: string;
  speaker?: number;
}

/**
 * Formats seconds into MM:SS.s string (e.g. 72.45 -> "01:12.5")
 */
export function formatTimestamp(sec: number): string {
  const clamped = Math.max(0, sec);
  const mins = Math.floor(clamped / 60);
  const secs = (clamped % 60).toFixed(1);
  const minStr = mins < 10 ? `0${mins}` : `${mins}`;
  const secStr = Number(secs) < 10 ? `0${secs}` : `${secs}`;
  return `${minStr}:${secStr}`;
}

/**
 * Formats a single PackedPhrase into a lean digest text line.
 * e.g. "[00:02.5-00:05.4] (Speaker 0) So the export flow starts here."
 */
export function formatPackedPhraseLine(phrase: PackedPhrase): string {
  const startStr = formatTimestamp(phrase.start);
  const endStr = formatTimestamp(phrase.end);
  const speakerTag =
    typeof phrase.speaker === "number" ? `(Speaker ${phrase.speaker}) ` : "";
  return `[${startStr}-${endStr}] ${speakerTag}${phrase.text}`;
}

/**
 * Groups word-level timestamps into phrase lines:
 * - Breaks on silences >= 0.5s
 * - Breaks on punctuation (. ? !) with pause >= 0.2s
 * - Breaks on speaker change
 * - Caps maximum phrase duration to 8.0s
 */
export function packTranscript(words: DiarizedWord[]): {
  phrases: PackedPhrase[];
  textBlock: string;
  tokenEstimate: number;
} {
  if (words.length === 0) {
    return { phrases: [], textBlock: "", tokenEstimate: 0 };
  }

  const firstWord = words[0];
  if (!firstWord) {
    return { phrases: [], textBlock: "", tokenEstimate: 0 };
  }

  const phrases: PackedPhrase[] = [];
  let currentWords: DiarizedWord[] = [firstWord];

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    const firstInCurrent = currentWords[0];
    if (!prev || !curr || !firstInCurrent) continue;

    const pause = curr.start - prev.end;
    const currentDur = curr.end - firstInCurrent.start;
    const speakerChanged =
      typeof prev.speaker === "number" &&
      typeof curr.speaker === "number" &&
      prev.speaker !== curr.speaker;

    const prevEndsWithPunct = /[.?!]$/.test(prev.word.trim());

    // Break conditions
    if (
      speakerChanged ||
      pause >= 0.5 ||
      (prevEndsWithPunct && pause >= 0.2) ||
      currentDur >= 8.0
    ) {
      // Finalize current phrase
      const lastInCurrent = currentWords[currentWords.length - 1] ?? firstInCurrent;
      const pStart = Number(firstInCurrent.start.toFixed(1));
      const pEnd = Number(lastInCurrent.end.toFixed(1));
      const pText = currentWords.map((w) => w.word.trim()).join(" ");
      phrases.push({
        start: pStart,
        end: pEnd,
        text: pText,
        speaker: firstInCurrent.speaker,
      });

      currentWords = [curr];
    } else {
      currentWords.push(curr);
    }
  }

  // Push trailing phrase
  if (currentWords.length > 0) {
    const firstInCurrent = currentWords[0]!;
    const lastInCurrent = currentWords[currentWords.length - 1] ?? firstInCurrent;
    const pStart = Number(firstInCurrent.start.toFixed(1));
    const pEnd = Number(lastInCurrent.end.toFixed(1));
    const pText = currentWords.map((w) => w.word.trim()).join(" ");
    phrases.push({
      start: pStart,
      end: pEnd,
      text: pText,
      speaker: firstInCurrent.speaker,
    });
  }

  const lines = phrases.map(formatPackedPhraseLine);
  const textBlock = lines.join("\n");

  // Token estimate: ~1 token per 4 chars + line framing
  const tokenEstimate = Math.ceil(textBlock.length / 3.8);

  return {
    phrases,
    textBlock,
    tokenEstimate,
  };
}
