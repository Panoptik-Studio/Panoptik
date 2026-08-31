import { describe, expect, it } from "vitest";
import {
  formatPackedPhraseLine,
  formatTimestamp,
  packTranscript,
} from "./transcriptPacking";

describe("transcriptPacking", () => {
  it("formats timestamps into MM:SS.s notation", () => {
    expect(formatTimestamp(0)).toBe("00:00.0");
    expect(formatTimestamp(5.42)).toBe("00:05.4");
    expect(formatTimestamp(72.48)).toBe("01:12.5");
    expect(formatTimestamp(605.1)).toBe("10:05.1");
  });

  it("formats packed phrase lines with optional speaker tag", () => {
    const phraseWithoutSpeaker = {
      start: 2.5,
      end: 5.4,
      text: "So the export flow starts here.",
    };
    expect(formatPackedPhraseLine(phraseWithoutSpeaker)).toBe(
      "[00:02.5-00:05.4] So the export flow starts here.",
    );

    const phraseWithSpeaker = {
      start: 6.1,
      end: 9.8,
      text: "We hit commit and it renders locally.",
      speaker: 1,
    };
    expect(formatPackedPhraseLine(phraseWithSpeaker)).toBe(
      "[00:06.1-00:09.8] (Speaker 1) We hit commit and it renders locally.",
    );
  });

  it("packs word tokens into phrase lines breaking on 0.5s pause, punctuation, speaker change, and duration cap", () => {
    const words = [
      // Phrase 1 (Speaker 0)
      { word: "Welcome", start: 0.0, end: 0.4, speaker: 0 },
      { word: "to", start: 0.4, end: 0.6, speaker: 0 },
      { word: "Panoptik.", start: 0.6, end: 1.1, speaker: 0 },
      // 0.6s pause (> 0.5s) -> Break to Phrase 2
      { word: "Today", start: 1.7, end: 2.1, speaker: 0 },
      { word: "we", start: 2.1, end: 2.3, speaker: 0 },
      { word: "test", start: 2.3, end: 2.6, speaker: 0 },
      // Speaker change to Speaker 1 -> Break to Phrase 3
      { word: "Looks", start: 2.7, end: 3.0, speaker: 1 },
      { word: "great!", start: 3.0, end: 3.4, speaker: 1 },
    ];

    const { phrases, textBlock, tokenEstimate } = packTranscript(words);
    expect(phrases.length).toBe(3);

    expect(phrases[0]!.text).toBe("Welcome to Panoptik.");
    expect(phrases[0]!.start).toBe(0.0);
    expect(phrases[0]!.end).toBe(1.1);
    expect(phrases[0]!.speaker).toBe(0);

    expect(phrases[1]!.text).toBe("Today we test");
    expect(phrases[1]!.start).toBe(1.7);
    expect(phrases[1]!.end).toBe(2.6);
    expect(phrases[1]!.speaker).toBe(0);

    expect(phrases[2]!.text).toBe("Looks great!");
    expect(phrases[2]!.start).toBe(2.7);
    expect(phrases[2]!.end).toBe(3.4);
    expect(phrases[2]!.speaker).toBe(1);

    expect(textBlock).toContain("[00:00.0-00:01.1] (Speaker 0) Welcome to Panoptik.");
    expect(textBlock).toContain("[00:01.7-00:02.6] (Speaker 0) Today we test");
    expect(textBlock).toContain("[00:02.7-00:03.4] (Speaker 1) Looks great!");
    expect(tokenEstimate).toBeGreaterThan(0);
  });
});
