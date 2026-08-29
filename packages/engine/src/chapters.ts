/**
 * Chapters (C2) — turning caption timing into named sections.
 *
 * People pause between topics, so a gap in speech is the cheapest reliable
 * signal of a section boundary. This works entirely off the caption output
 * already produced locally by Whisper: no model, no network, no second pass.
 *
 * Pure functions only, so the same logic serves the "Auto-chapters" action
 * today and auto-polish later.
 */
import type { Caption } from "@panoptik/schema";

/** A run of captions with no long silence in it. */
export type Chapter = {
  /** Timeline seconds, taken from the first and last caption in the run. */
  start: number;
  end: number;
  title: string;
  /** How many captions the run covers — useful for weighting or debugging. */
  captionCount: number;
};

/**
 * How long a silence has to be before it reads as a topic change.
 *
 * Below about a second you catch ordinary breaths and sentence boundaries,
 * which would produce a chapter every few words.
 */
export const DEFAULT_GAP_SECONDS = 1.5;

/** Chapter titles are labels, not sentences. */
const DEFAULT_TITLE_WORDS = 6;

/**
 * Condense caption text into a short label.
 *
 * Exported for its own tests: the trimming rules are where this gets ugly with
 * real speech, which arrives with filler words and no capitalisation.
 */
export function chapterTitle(text: string, maxWords = DEFAULT_TITLE_WORDS): string {
  const words = text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";

  const kept = words.slice(0, maxWords).join(" ");
  // Drop trailing punctuation left by cutting mid-sentence, but keep it when
  // the whole caption fitted and ended properly.
  const trimmed = words.length > maxWords ? kept.replace(/[,;:.\-–—]+$/, "") : kept;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Group captions into chapters, splitting wherever speech stops for longer
 * than `gapSeconds`.
 *
 * Captions are sorted defensively: Whisper emits them in order, but a project
 * that has been edited or merged can carry them out of order, and an unsorted
 * pass would split on every backwards step.
 */
export function groupCaptionsIntoChapters(
  captions: Caption[],
  opts: { gapSeconds?: number; maxTitleWords?: number } = {},
): Chapter[] {
  const gap = opts.gapSeconds ?? DEFAULT_GAP_SECONDS;
  const maxWords = opts.maxTitleWords ?? DEFAULT_TITLE_WORDS;

  const usable = captions
    .filter((c) => c && typeof c.start === "number" && Number.isFinite(c.start) && c.text?.trim())
    .slice()
    .sort((a, b) => a.start - b.start);
  if (usable.length === 0) return [];

  const chapters: Chapter[] = [];
  let run: Caption[] = [usable[0]!];

  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1]!;
    const cur = usable[i]!;
    // Compare against the previous caption's end, not its start: a long caption
    // followed immediately by the next one is continuous speech.
    if (cur.start - prev.end > gap) {
      chapters.push(toChapter(run, maxWords));
      run = [cur];
    } else {
      run.push(cur);
    }
  }
  chapters.push(toChapter(run, maxWords));

  // A run whose captions were all whitespace yields no usable title.
  return chapters.filter((c) => c.title.length > 0);
}

function toChapter(run: Caption[], maxWords: number): Chapter {
  const first = run[0]!;
  const last = run[run.length - 1]!;
  return {
    start: first.start,
    end: Math.max(last.end, first.start),
    title: chapterTitle(first.text, maxWords),
    captionCount: run.length,
  };
}
