/**
 * OWNER: DEV B — ROADMAP-B.md Task 3.2.
 * Lazy-loaded ONLY when captions are requested.
 * Receives { type: "transcribe", audio: Float32Array } (mono, 16kHz),
 * loads Xenova/whisper-base via CDN,
 * posts { type: "progress", progress } then { type: "result", captions }.
 */

let transcriber: any = null;

async function loadModel(
  progressCallback: (p: number) => void,
) {
  if (transcriber) return transcriber;

  const { pipeline } = await import(
    // @ts-expect-error — CDN ESM import, no local types
    "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm"
  );
  transcriber = await pipeline(
    "automatic-speech-recognition",
    "Xenova/whisper-base",
    {
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          progressCallback(p.progress);
        }
      },
    },
  );
  return transcriber;
}

self.onmessage = async (
  e: MessageEvent<{
    type: string;
    audio?: Float32Array;
  }>,
) => {
  if (e.data.type !== "transcribe" || !e.data.audio)
    return;

  try {
    const model = await loadModel((progress) => {
      (self as any).postMessage({
        type: "progress",
        progress,
      });
    });

    // Model loaded → start transcribing
    (self as any).postMessage({
      type: "progress",
      progress: -1,
    });

    const out = await model(e.data.audio, {
      return_timestamps: "word",
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const captions = out.chunks.map((c: any) => ({
      text: String(c.text).trim(),
      start: c.timestamp[0] as number,
      end: (c.timestamp[1] ??
        (c.timestamp[0] as number) + 0.5) as number,
    }));

    (self as any).postMessage({
      type: "result",
      captions,
    });
  } catch (err) {
    (self as any).postMessage({
      type: "error",
      error: String(err),
    });
  }
};
