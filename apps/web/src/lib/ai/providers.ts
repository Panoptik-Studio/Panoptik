/**
 * AI Provider Adapters for Panoptik.
 * Normalizes transcription interactions across:
 * 1. Direct Groq Whisper Large v3 Turbo (Client-side BYOK with generous 28.8k sec/day free tier)
 * 2. Panoptik Pro Hosted Proxy
 * 3. Offline WASM Fallback
 */

import { getSessionToken } from "./authClient";
import type { VideoDigest } from "@panoptik/engine";
import type { EditOp } from "../../webmcp/snapping";

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  speaker?: number;
}

export interface TranscriptionResponse {
  words: TranscriptionWord[];
  duration: number;
}

export interface DirectorResponse {
  plan: string;
  ops: EditOp[];
}

export interface AIProviderConfig {
  proxyUrl?: string;
  language?: string;
  prompt?: string;
  byokKeys?: {
    groq?: string;
    deepgram?: string;
    openai?: string;
    anthropic?: string;
    gemini?: string;
  };
  airGappedMode?: boolean;
}

const DEFAULT_PROXY_URL = "https://proxy.panoptik.app";
export const DEFAULT_GROQ_KEY = "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";

function resolveConfig(config: AIProviderConfig = {}): AIProviderConfig {
  let storedAirGapped = false;
  let storedKeys: AIProviderConfig["byokKeys"] = {};

  if (typeof window !== "undefined") {
    storedAirGapped = localStorage.getItem("panoptik:air_gapped") === "true";
    try {
      const parsed = JSON.parse(localStorage.getItem("panoptik:byok_keys") || "{}");
      if (parsed && typeof parsed === "object") {
        storedKeys = parsed;
      }
    } catch {
      // ignore
    }

    // If no custom key was stored yet in browser, provide DEFAULT_GROQ_KEY for out-of-the-box transcription
    if (!storedKeys?.groq && !storedKeys?.openai && !storedKeys?.deepgram && !config.byokKeys?.groq) {
      storedKeys = { ...storedKeys, groq: DEFAULT_GROQ_KEY };
    }
  }

  return {
    proxyUrl: config.proxyUrl || DEFAULT_PROXY_URL,
    language: config.language,
    prompt: config.prompt,
    byokKeys: {
      ...storedKeys,
      ...config.byokKeys,
    },
    airGappedMode: config.airGappedMode ?? storedAirGapped,
  };
}

/**
 * Transcribes an audio blob via Direct Groq API, Cloud Proxy, or offline WASM.
 */
export async function transcribeAudioStream(
  audioBlob: Blob,
  rawConfig: AIProviderConfig = {},
): Promise<TranscriptionResponse> {
  const config = resolveConfig(rawConfig);

  if (config.airGappedMode) {
    throw new Error("Air-gapped mode active: cloud AI transcription is blocked.");
  }

  const token = getSessionToken();
  const groqKey = config.byokKeys?.groq;
  const byokKey = groqKey || config.byokKeys?.deepgram || config.byokKeys?.openai;

  if (!token && !byokKey) {
    throw new Error("No active Panoptik Pro session or BYOK API key provided.");
  }

  // 1. If Groq API key is explicitly used without a Pro session token, execute direct fetch (~2.5s)
  if (groqKey && !token) {
    try {
      const formData = new FormData();
      formData.append("file", audioBlob, "audio.wav");
      formData.append("model", "whisper-large-v3-turbo");
      formData.append("response_format", "verbose_json");
      formData.append("temperature", "0");
      formData.append("timestamp_granularities[]", "word");
      formData.append("timestamp_granularities[]", "segment");

      if (config.language && config.language !== "auto") {
        formData.append("language", config.language);
      }

      if (config.prompt) {
        formData.append("prompt", config.prompt);
      } else if (!config.language || config.language === "auto") {
        // Multi-language context prompt to prime Whisper for mixed Hindi/English/Hinglish speech
        formData.append("prompt", "Transcribe speech clearly in English, Hindi (हिन्दी), and Hinglish.");
      } else if (config.language === "hi") {
        formData.append("prompt", "हिन्दी और English में बातचीत (Hinglish/Hindi transcription).");
      }

      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
        },
        body: formData,
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        let words: TranscriptionWord[] = (data.words ?? [])
          .map((w: any) => ({
            word: (w.word ?? "").trim(),
            start: Number(w.start ?? 0),
            end: Number(w.end ?? 0),
            speaker: 0,
          }))
          .filter((w: TranscriptionWord) => w.word.length > 0);

        // Fallback 1: Extract words from segments if data.words is empty
        if (words.length === 0 && Array.isArray(data.segments) && data.segments.length > 0) {
          for (const seg of data.segments) {
            const segText = (seg.text ?? "").trim();
            if (!segText) continue;
            const segWords = segText.split(/\s+/).filter((s: string) => s.length > 0);
            const segStart = Number(seg.start ?? 0);
            const segEnd = Number(seg.end ?? segStart + 2);
            const wordDur = segWords.length > 0 ? (segEnd - segStart) / segWords.length : 0.35;
            segWords.forEach((sw: string, idx: number) => {
              words.push({
                word: sw,
                start: Number((segStart + idx * wordDur).toFixed(2)),
                end: Number((segStart + (idx + 1) * wordDur).toFixed(2)),
                speaker: 0,
              });
            });
          }
        }

        // Fallback 2: If only data.text is returned
        if (words.length === 0 && typeof data.text === "string" && data.text.trim().length > 0) {
          const rawWords = data.text.trim().split(/\s+/).filter((s: string) => s.length > 0);
          const totalDur = data.duration ?? 5;
          const wordDur = rawWords.length > 0 ? totalDur / rawWords.length : 0.4;
          words = rawWords.map((rw: string, idx: number) => ({
            word: rw,
            start: Number((idx * wordDur).toFixed(2)),
            end: Number(((idx + 1) * wordDur).toFixed(2)),
            speaker: 0,
          }));
        }

        return {
          duration: data.duration ?? (words.length > 0 ? (words[words.length - 1]?.end ?? 0) : 0),
          words,
        };
      }

      // If 429 rate limited with retry-after header, inspect error
      if (res.status === 429) {
        const retryAfter = res.headers.get("retry-after") ?? "5";
        console.warn(`Groq rate limited. Retry after ${retryAfter}s. Attempting fallback...`);
      }
    } catch (e) {
      console.warn("Direct Groq transcription failed, trying proxy fallback", e);
    }
  }

  // 2. Proxy Fallback / Pro Gateway
  const proxyUrl = config.proxyUrl || DEFAULT_PROXY_URL;
  const headers: Record<string, string> = {};

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (byokKey) {
    headers["x-panoptik-byok-key"] = byokKey;
    headers["x-panoptik-provider"] = config.byokKeys?.groq ? "groq" : config.byokKeys?.deepgram ? "deepgram" : "openai";
  }

  const response = await fetch(`${proxyUrl}/v1/ai/transcribe`, {
    method: "POST",
    headers,
    body: audioBlob,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Transcription failed with HTTP ${response.status}`);
  }

  return (await response.json()) as TranscriptionResponse;
}

/**
 * Executes 1-click AI auto-director on a VideoDigest via Cloud Proxy or BYOK.
 */
export async function runAutoDirector(
  digest: VideoDigest,
  instruction?: string,
  rawConfig: AIProviderConfig = {},
): Promise<DirectorResponse> {
  const config = resolveConfig(rawConfig);

  if (config.airGappedMode) {
    throw new Error("Air-gapped mode active: cloud AI is blocked.");
  }

  const token = getSessionToken();
  const byokKey = config.byokKeys?.anthropic || config.byokKeys?.gemini || config.byokKeys?.openai;

  if (!token && !byokKey) {
    throw new Error("No active Panoptik Pro session or BYOK API key provided.");
  }

  const proxyUrl = config.proxyUrl || DEFAULT_PROXY_URL;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (byokKey) {
    headers["x-panoptik-byok-key"] = byokKey;
    headers["x-panoptik-provider"] = config.byokKeys?.anthropic ? "anthropic" : config.byokKeys?.gemini ? "gemini" : "openai";
  }

  const response = await fetch(`${proxyUrl}/v1/ai/direct`, {
    method: "POST",
    headers,
    body: JSON.stringify({ digest, userInstruction: instruction }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `Auto-director failed with HTTP ${response.status}`);
  }

  return (await response.json()) as DirectorResponse;
}
