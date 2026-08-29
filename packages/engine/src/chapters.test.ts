import { describe, expect, it } from "vitest";
import { chapterTitle, groupCaptionsIntoChapters, DEFAULT_GAP_SECONDS } from "./chapters";
import type { Caption } from "@panoptik/schema";

const cap = (text: string, start: number, end: number): Caption => ({ text, start, end });

describe("chapterTitle", () => {
  it("keeps a short caption whole", () => {
    expect(chapterTitle("Setting up the project")).toBe("Setting up the project");
  });

  it("cuts a long caption to a label", () => {
    expect(chapterTitle("first we are going to install the dependencies and then run it", 6)).toBe(
      "First we are going to install",
    );
  });

  it("drops punctuation left by cutting mid-sentence", () => {
    // "…the editor," reads as a broken sentence once the rest is gone.
    expect(chapterTitle("now open the editor, then press record", 4)).toBe("Now open the editor");
  });

  it("keeps punctuation when nothing was cut", () => {
    expect(chapterTitle("All done.", 6)).toBe("All done.");
  });

  it("capitalises, since speech transcripts often arrive lowercase", () => {
    expect(chapterTitle("welcome back")).toBe("Welcome back");
  });

  it("returns empty for blank text rather than a stray capital", () => {
    expect(chapterTitle("   ")).toBe("");
  });
});

describe("groupCaptionsIntoChapters", () => {
  it("returns nothing when there are no captions", () => {
    expect(groupCaptionsIntoChapters([])).toEqual([]);
  });

  it("keeps continuous speech as one chapter", () => {
    const chapters = groupCaptionsIntoChapters([
      cap("welcome to the demo", 0, 2),
      cap("today we are building a recorder", 2.1, 4),
      cap("it runs in the browser", 4.2, 6),
    ]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toMatchObject({ start: 0, end: 6, captionCount: 3 });
  });

  it("splits where speech stops for longer than the gap", () => {
    const chapters = groupCaptionsIntoChapters([
      cap("first we record", 0, 2),
      // 3s of silence — a topic change.
      cap("now we edit the zooms", 5, 7),
    ]);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]!.title).toBe("First we record");
    expect(chapters[1]!.title).toBe("Now we edit the zooms");
  });

  it("measures the gap from the previous caption's end, not its start", () => {
    // A long caption followed immediately by the next is continuous speech.
    // Comparing start-to-start would split this in two.
    const chapters = groupCaptionsIntoChapters([cap("a long stretch of talking", 0, 6), cap("still going", 6.2, 8)]);
    expect(chapters).toHaveLength(1);
  });

  it("does not split on an ordinary pause", () => {
    const chapters = groupCaptionsIntoChapters([
      cap("one", 0, 1),
      cap("two", 1 + DEFAULT_GAP_SECONDS - 0.1, 3),
    ]);
    expect(chapters).toHaveLength(1);
  });

  it("honours a custom gap", () => {
    const captions = [cap("one", 0, 1), cap("two", 3, 4)];
    expect(groupCaptionsIntoChapters(captions, { gapSeconds: 5 })).toHaveLength(1);
    expect(groupCaptionsIntoChapters(captions, { gapSeconds: 1 })).toHaveLength(2);
  });

  it("sorts before grouping, so out-of-order captions do not split every time", () => {
    // An edited or merged project can carry captions out of order; walking them
    // unsorted would see a negative gap at each backwards step.
    const chapters = groupCaptionsIntoChapters([
      cap("third", 4.2, 6),
      cap("first", 0, 2),
      cap("second", 2.1, 4),
    ]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("First");
  });

  it("ignores blank and malformed captions", () => {
    const chapters = groupCaptionsIntoChapters([
      cap("   ", 0, 1),
      cap("real content here", 1.1, 3),
      { text: "no timing", start: Number.NaN, end: 4 } as Caption,
    ]);
    expect(chapters).toHaveLength(1);
    expect(chapters[0]!.title).toBe("Real content here");
  });

  it("never emits a chapter without a title", () => {
    expect(groupCaptionsIntoChapters([cap("  ", 0, 1), cap("\t", 9, 10)])).toEqual([]);
  });
});
