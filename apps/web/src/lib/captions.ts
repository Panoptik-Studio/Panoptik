/**
 * Shared caption pipeline — single source of truth for BOTH:
 *  - CaptionsPanel "Auto-Generate Subtitles" button (manual)
 *  - WebMCP `generate_captions` tool (agent)
 *
 * Previously these were two divergent implementations: the panel did
 * dual-track (camera/mic + screen) STT with denoise/chunk/silence-filter and
 * additive progressive packing, while the tool did a single-track naive
 * 5-words-per-card pack with fixed styling. That is why agent captions looked
 * wrong and lost the additive/karaoke effect.
 *
 * Everything caption-related (presets, per-track transcription, additive
 * packing) lives here now. Both callers must use these helpers.
 */
import { transcribeAudioStream } from "@/lib/ai/providers";
import {
  chunkAudioSamples,
  computeChunkVoiceEnergy,
  denoiseAudioSamples,
  encodeWavBlob,
  mergeOverlappedChunkWords,
  resampleMonoPcm,
} from "@panoptik/engine";
import type { TextAnimation, TextOverlay } from "@panoptik/schema";

export interface CaptionStylePreset {
  id: string;
  name: string;
  badge: string;
  fontSize: number;
  fontFamily: string;
  fontWeight: "normal" | "bold" | "600" | "800" | "900";
  color: string;
  backgroundColor: string;
  backgroundPadding: number;
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  shadowColor: string;
  shadowBlur: number;
  animation: TextAnimation;
}

export const CAPTION_PRESETS: CaptionStylePreset[] = [
  {
    id: "viral",
    name: "Viral Pop",
    badge: "TikTok",
    fontSize: 22,
    fontFamily: "Outfit",
    fontWeight: "900",
    color: "#facc15",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    backgroundPadding: 8,
    borderRadius: 8,
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "rgba(0, 0, 0, 0.8)",
    shadowBlur: 8,
    animation: "pop",
  },
  {
    id: "clean",
    name: "Modern Clean",
    badge: "Minimal",
    fontSize: 18,
    fontFamily: "Inter",
    fontWeight: "600",
    color: "#ffffff",
    backgroundColor: "rgba(24, 24, 27, 0.85)",
    backgroundPadding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.25)",
    shadowColor: "rgba(0, 0, 0, 0.5)",
    shadowBlur: 4,
    animation: "fade",
  },
  {
    id: "outline",
    name: "Punchy Outline",
    badge: "Impact",
    fontSize: 24,
    fontFamily: "Bebas Neue",
    fontWeight: "900",
    color: "#ffffff",
    backgroundColor: "transparent",
    backgroundPadding: 4,
    borderRadius: 0,
    borderWidth: 2,
    borderColor: "#000000",
    shadowColor: "rgba(0, 0, 0, 0.95)",
    shadowBlur: 6,
    animation: "slide-up",
  },
  {
    id: "subtitles",
    name: "Classic Subtitle",
    badge: "Cinema",
    fontSize: 16,
    fontFamily: "Roboto",
    fontWeight: "normal",
    color: "#ffffff",
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    backgroundPadding: 5,
    borderRadius: 4,
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "rgba(0, 0, 0, 0.8)",
    shadowBlur: 2,
    animation: "none",
  },
  {
    id: "electric",
    name: "Electric Cyan",
    badge: "Glow",
    fontSize: 20,
    fontFamily: "Outfit",
    fontWeight: "800",
    color: "#38bdf8",
    backgroundColor: "rgba(15, 23, 42, 0.92)",
    backgroundPadding: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(56, 189, 248, 0.55)",
    shadowColor: "rgba(56, 189, 248, 0.8)",
    shadowBlur: 10,
    animation: "bounce",
  },
  {
    id: "highlighter",
    name: "Highlighter",
    badge: "Bright",
    fontSize: 19,
    fontFamily: "Outfit",
    fontWeight: "800",
    color: "#0f172a",
    backgroundColor: "#fde047",
    backgroundPadding: 7,
    borderRadius: 6,
    borderWidth: 0,
    borderColor: "transparent",
    shadowColor: "rgba(0, 0, 0, 0.25)",
    shadowBlur: 4,
    animation: "pop",
  },
];

/** Defaults that match the manual panel's initial UI state. */
export const DEFAULT_CAPTION_PRESET_ID = "viral";
export const DEFAULT_SPEAKER_FONT_SIZE = 36;
export const DEFAULT_SCREEN_FONT_SIZE = 28;

export interface CaptionTrackWord {
  word: string;
  start: number;
  end: number;
  speaker?: string; // "Speaker" | "Screen"
}

const HINGLISH_PROMPT =
  "Mixed Hinglish & English conversation. Contains Hindi (हिन्दी) and English speech, e.g. Starting September 14th, नमस्ते, thank you so much, dhanyawaad, limit.";

/**
 * Transcribe one decoded audio track with the manual panel's exact pipeline:
 * resample → denoise → chunk (22s/1.5s overlap for long or hinglish/auto) →
 * silence-filter (energy > 0.003) → parallel STT → overlap-merge.
 */
export async function transcribeTrackAudio(
  buffer: AudioBuffer,
  speakerLabel: string,
  language: string,
  onStatus?: (msg: string) => void,
): Promise<CaptionTrackWord[]> {
  const chan0 = buffer.getChannelData(0);
  const raw16k = resampleMonoPcm(chan0, buffer.sampleRate, 16000);
  // DSP denoise (80Hz highpass + adaptive noise gate) — prevents Whisper
  // hallucinations on room rumble / hiss that the naive single-pass missed.
  const resampled16k = denoiseAudioSamples(raw16k, 16000);
  const totalSec = resampled16k.length / 16000;
  if (totalSec < 0.2) return [];

  const shouldChunk = totalSec > 22 || language === "hinglish" || language === "auto";
  const rawChunks = shouldChunk
    ? chunkAudioSamples(resampled16k, 16000, 22, 1.5)
    : [
        {
          chunkIndex: 0,
          startSec: 0,
          endSec: totalSec,
          overlapSec: 0,
          samples: resampled16k,
        },
      ];

  // Filter out silence chunks to prevent Whisper hallucinations on dead air
  const chunks = rawChunks.filter((chunk) => {
    const energy = computeChunkVoiceEnergy(chunk.samples);
    return energy > 0.003;
  });

  if (chunks.length === 0) return [];

  let diarizedWords: CaptionTrackWord[] = [];

  if (chunks.length > 1) {
    onStatus?.(`Transcribing ${speakerLabel} (${chunks.length} active voice slices)...`);
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const chunkWav = encodeWavBlob(chunk.samples, 16000);
        const result = await transcribeAudioStream(chunkWav, {
          language: language === "hinglish" ? undefined : language,
          prompt: language === "hinglish" || language === "auto" ? HINGLISH_PROMPT : undefined,
        });
        return {
          chunkIndex: chunk.chunkIndex,
          startOffsetSec: chunk.startSec,
          chunkDurationSec: chunk.endSec - chunk.startSec,
          words: (result.words ?? []).map((w) => ({
            ...w,
            speaker: speakerLabel,
          })),
        };
      }),
    );
    const merged = mergeOverlappedChunkWords(chunkResults as any, 1.5);
    diarizedWords = merged.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      speaker: speakerLabel,
    }));
  } else {
    onStatus?.(`Transcribing ${speakerLabel}...`);
    const singleWav = encodeWavBlob(resampled16k, 16000);
    const result = await transcribeAudioStream(singleWav, {
      language: language === "hinglish" ? undefined : language,
      prompt: language === "hinglish" || language === "auto" ? HINGLISH_PROMPT : undefined,
    });
    diarizedWords = (result.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      speaker: speakerLabel,
    }));
  }

  return diarizedWords;
}

/**
 * Packs a stream of words additively into progressive lines with comfortable
 * read time. This is the karaoke/additive effect:
 * - Words join the line on the right progressively until reaching the
 *   threshold (punctuation, pause, max chars/words).
 * - Completed lines stay on screen to read without overlapping the next line.
 * - Guarantees sequential non-overlapping timeline tracks.
 */
export function packStreamWordsAdditively(
  rawWords: CaptionTrackWord[],
  speakerLabel: "Speaker" | "Screen" | string,
  preset: CaptionStylePreset,
  includeSpeakerLabels = true,
  customFontSize?: number,
): TextOverlay[] {
  if (!rawWords || rawWords.length === 0) return [];

  // 1. Sanitize and sort timestamps
  const cleanWords: CaptionTrackWord[] = [];
  let lastEnd = 0;
  for (const w of rawWords) {
    const text = w.word.trim();
    if (!text) continue;
    const start = Math.max(lastEnd, Number(w.start.toFixed(2)));
    const end = Math.max(start + 0.12, Number(w.end.toFixed(2)));
    cleanWords.push({
      word: text,
      start,
      end,
      speaker: speakerLabel,
    });
    lastEnd = start + 0.04;
  }

  if (cleanWords.length === 0) return [];

  // 2. Break words into lines based on threshold
  const lines: CaptionTrackWord[][] = [];
  let currentLine: CaptionTrackWord[] = [];

  for (let i = 0; i < cleanWords.length; i++) {
    const item = cleanWords[i]!;
    currentLine.push(item);

    const lineDuration = item.end - currentLine[0]!.start;
    const charCount = currentLine.reduce((acc, w) => acc + w.word.length + 1, 0);
    const isPunctuation =
      item.word.endsWith(".") ||
      item.word.endsWith("?") ||
      item.word.endsWith("!") ||
      item.word.endsWith(";") ||
      item.word.endsWith(":");

    const nextItem = cleanWords[i + 1];
    const isPause = nextItem ? nextItem.start - item.end > 0.55 : false;
    const isThresholdMet = currentLine.length >= 7 || charCount >= 38 || lineDuration >= 3.2;

    if (isPunctuation || isPause || isThresholdMet || i === cleanWords.length - 1) {
      lines.push(currentLine);
      currentLine = [];
    }
  }

  // 3. Build additive progressive overlays for each line
  const overlays: TextOverlay[] = [];
  const isScreen = speakerLabel === "Screen";
  const isSpeaker = speakerLabel === "Speaker";
  const posY = isScreen ? 0.78 : isSpeaker ? 0.89 : 0.88;
  const speakerPrefix = includeSpeakerLabels ? `${speakerLabel}: ` : "";
  const resolvedFontSize = customFontSize ?? preset.fontSize;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineWords = lines[lineIdx]!;
    if (lineWords.length === 0) continue;

    const nextLine = lines[lineIdx + 1];
    const nextLineStart = nextLine && nextLine[0] ? nextLine[0].start : Infinity;

    let accumulatedText = "";
    for (let wordIdx = 0; wordIdx < lineWords.length; wordIdx++) {
      const currentWord = lineWords[wordIdx]!;
      accumulatedText = wordIdx === 0 ? currentWord.word : `${accumulatedText} ${currentWord.word}`;
      const isLastWordInLine = wordIdx === lineWords.length - 1;

      const tStart = Number(currentWord.start.toFixed(2));
      let tDuration: number;

      if (!isLastWordInLine) {
        // Words joining on the right as speaker talks
        const nextWord = lineWords[wordIdx + 1]!;
        tDuration = Number(Math.max(0.12, nextWord.start - currentWord.start).toFixed(2));
      } else {
        // Final line stays on screen to read!
        const maxReadTime = 2.4;
        const availableBeforeNextLine = nextLineStart - currentWord.start;
        const desiredDuration = Math.max(1.2, Math.min(maxReadTime, availableBeforeNextLine - 0.08));
        tDuration = Number(Math.max(0.4, desiredDuration).toFixed(2));
      }

      if (tDuration <= 0) tDuration = 0.4;

      overlays.push({
        id: crypto.randomUUID(),
        kind: "caption",
        speaker: speakerLabel,
        text: `${speakerPrefix}${accumulatedText}`,
        timestamp: tStart,
        duration: tDuration,
        position: isScreen || isSpeaker ? "custom" : "bottom",
        x: 0.5,
        y: posY,
        fontSize: resolvedFontSize,
        fontFamily: preset.fontFamily,
        fontWeight: preset.fontWeight,
        color: preset.color,
        backgroundColor: preset.backgroundColor,
        backgroundPadding: preset.backgroundPadding,
        borderRadius: preset.borderRadius,
        borderWidth: preset.borderWidth,
        borderColor: preset.borderColor,
        shadowColor: preset.shadowColor,
        shadowBlur: preset.shadowBlur,
        animation: wordIdx === 0 ? preset.animation || "pop" : "none",
        animationDuration: wordIdx === 0 ? 0.25 : 0,
        staged: false,
      });
    }
  }

  // 4. Strict sequential non-overlapping guarantee
  for (let i = 0; i < overlays.length - 1; i++) {
    const curr = overlays[i]!;
    const next = overlays[i + 1]!;
    if (curr.timestamp + (curr.duration ?? 0.5) > next.timestamp) {
      curr.duration = Number(Math.max(0.12, next.timestamp - curr.timestamp).toFixed(2));
    }
  }

  return overlays;
}
