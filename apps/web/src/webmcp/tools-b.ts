/**
 * OWNER: DEV B — ROADMAP-B.md Task 5.2.
 * 5 editing WebMCP tools registered via A's registerToolWithLifecycle.
 * All staging tools do NOT commit — they add to staged* arrays.
 * commit_staged_changes is gated by showConfirmDialog.
 */
import { registerToolWithLifecycle } from "./lifecycle";
import { useProjectStore } from "../stores/projectStore";
import { showConfirmDialog } from "./confirm";
import { postProcessCaptions } from "../lib/captionChunker";

function generateId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Date.now().toString(36)
  );
}

export function registerEditingTools(): void {
  // ── READ-ONLY (none for editing tools — all are staging/write) ──

  // ── STAGING TOOLS ──

  registerToolWithLifecycle({
    name: "propose_zoom_points",
    description:
      "Proposes zoom-in keyframes at specific timestamps. Watch the preview to identify moments of interest: UI clicks, text reveals, scene changes, important visuals. Use get_click_log for candidate timestamps. Proposals appear as ghost diamonds on the timeline for the human to review — they are NOT applied until commit_staged_changes.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number" },
          description:
            "Timestamps in seconds to place zoom-ins.",
        },
        scale: {
          type: "number",
          minimum: 1.2,
          maximum: 5,
          description: "Zoom depth. Default 2.2.",
        },
      },
      required: ["timestamps"],
    },
    execute: async ({
      timestamps,
      scale,
    }: {
      timestamps: number[];
      scale?: number;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project)
        return {
          error:
            "No project loaded. Ask the user to import a clip first.",
        };

      const clamped = timestamps.filter(
        (t: number) =>
          t >= 0 && t <= store.project!.clip.duration,
      );
      const proposals = clamped.map((t: number) => ({
        id: generateId(),
        t,
        to: { scale: scale ?? 2.2, x: 0.5, y: 0.5 },
        dur: 0.7,
        ease: "easeInOutCubic",
        staged: true,
      }));

      store.stageZoomProposals(proposals);
      return {
        stagedCount: proposals.length,
        outOfRangeSkipped:
          timestamps.length - clamped.length,
        message: `${proposals.length} zoom proposal(s) staged as ghosts. The human reviews them on the timeline; apply with commit_staged_changes.`,
      };
    },
  });

  registerToolWithLifecycle({
    name: "add_text_overlay",
    description:
      "Stages a text overlay at a specific timestamp and screen position. Does not commit — appears as pending in the inspector. Useful for labeling UI elements, adding annotations, or watermarking.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text content to display",
        },
        timestamp: {
          type: "number",
          description:
            "When the text should appear, in seconds",
        },
        position: {
          type: "string",
          enum: ["top", "bottom", "center"],
          description: "Vertical position on screen",
        },
      },
      required: ["text", "timestamp"],
    },
    execute: async ({
      text,
      timestamp,
      position,
    }: {
      text: string;
      timestamp: number;
      position?: string;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project)
        return {
          error:
            "No project loaded. Ask the user to import a clip first.",
        };

      store.stageTextOverlay({
        id: generateId(),
        text,
        timestamp,
        position:
          (position as "top" | "bottom" | "center") ??
          "bottom",
        staged: true,
      });
      return {
        staged: true,
        message: `Text overlay "${text}" staged at ${timestamp}s. Call commit_staged_changes to apply.`,
      };
    },
  });

  registerToolWithLifecycle({
    name: "set_background",
    description:
      "Stages a background change. Accepts a solid color or a 2-stop gradient. The background fills the padding area around the video when the aspect ratio doesn't match the canvas. Does not commit.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["solid", "gradient"],
          description:
            "Solid = one color. Gradient = two-color linear gradient.",
        },
        color: {
          type: "string",
          description:
            "Hex color for solid background, e.g. '#1a1a2e'",
        },
        stops: {
          type: "array",
          items: { type: "string" },
          description:
            "Two hex colors for gradient, e.g. ['#6366f1', '#a855f7']",
        },
      },
      required: ["kind"],
    },
    execute: async ({
      kind,
      color,
      stops,
    }: {
      kind: string;
      color?: string;
      stops?: string[];
    }) => {
      const store = useProjectStore.getState();
      if (!store.project)
        return {
          error:
            "No project loaded. Ask the user to import a clip first.",
        };

      const bg =
        kind === "solid"
          ? { kind: "solid" as const, color: color ?? "#000000" }
          : {
              kind: "gradient" as const,
              stops: (stops ?? ["#6366f1", "#a855f7"]) as [
                string,
                string,
              ],
            };

      store.stageBackground(bg);
      return {
        staged: true,
        message: `${kind} background staged. Call commit_staged_changes to apply.`,
      };
    },
  });

  registerToolWithLifecycle({
    name: "generate_captions",
    description:
      "Runs local Whisper transcription on the audio track. Generates word-level captions with timestamps. Stages them — does not commit. May take 10-30 seconds depending on clip length. The transcription runs entirely in the browser via WebAssembly — no audio leaves the device.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description:
            "Language code (e.g. 'en', 'es'). Default auto-detect.",
        },
      },
    },
    execute: async (_input: {
      language?: string;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project)
        return {
          error:
            "No project loaded. Ask the user to import a clip first.",
        };

      // Spawn whisper worker
      try {
        const { extractMono16k } = await import(
          "../lib/audio16k"
        );

        // Get audio buffer
        let audioBuffer: AudioBuffer | null = null;
        try {
          const { engine } = await import(
            "../lib/engineProvider"
          );
          audioBuffer = await engine.getAudioBuffer(
            store.project!,
          );
        } catch {
          // fallback
        }

        if (!audioBuffer) {
          return {
            error:
              "No audio track found. Cannot generate captions.",
          };
        }

        const pcm = await extractMono16k(audioBuffer);

        const captions = await new Promise<
          { text: string; start: number; end: number }[]
        >((resolve, reject) => {
          const workerCode = `
            let transcriber = null;
            self.onmessage = async (e) => {
              if (e.data.type !== 'transcribe' || !e.data.audio) return;
              try {
                if (!transcriber) {
                  const { pipeline } = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm');
                  transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
                    progress_callback: (p) => { if (p.status === 'progress') self.postMessage({ type: 'progress', progress: p.progress }); },
                  });
                }
                self.postMessage({ type: 'progress', progress: -1 });
                const out = await transcriber(e.data.audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5 });
                self.postMessage({ type: 'result', captions: out.chunks.map((c) => ({ text: String(c.text).trim(), start: c.timestamp[0], end: c.timestamp[1] ?? c.timestamp[0] + 0.5 })) });
              } catch (err) {
                self.postMessage({ type: 'error', error: String(err) });
              }
            };
          `;
          const blob = new Blob([workerCode], { type: "application/javascript" });
          const worker = new Worker(URL.createObjectURL(blob));
          worker.onmessage = (e) => {
            if (e.data.type === "progress") {
              useProjectStore.getState().setWhisperProgress(e.data.progress);
            }
            if (e.data.type === "result") {
              useProjectStore.getState().setWhisperProgress(null);
              resolve(e.data.captions);
              worker.terminate();
            }
            if (e.data.type === "error") {
              useProjectStore.getState().setWhisperProgress(null);
              reject(new Error(e.data.error));
              worker.terminate();
            }
          };
          worker.postMessage({
            type: "transcribe",
            audio: pcm,
          });
        });

        store.stageCaptions(postProcessCaptions(captions));
        return {
          stagedCount: captions.length,
          preview: captions
            .slice(0, 5)
            .map(
              (c) =>
                `${c.start.toFixed(1)}s: "${c.text}"`,
            ),
          message: `${captions.length} captions staged. Call commit_staged_changes to burn them in.`,
        };
      } catch (err) {
        return { error: String(err) };
      }
    },
  });

  // ── WRITE TOOL (gated by confirmation) ──

  registerToolWithLifecycle({
    name: "commit_staged_changes",
    description:
      "Commits ALL staged items (zoom points, text overlays, backgrounds, captions) to the project. REQUIRES human confirmation — shows the full staged diff and asks Yes/No before writing. This is the only way staged changes become permanent.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const store = useProjectStore.getState();
      if (!store.project)
        return {
          error:
            "No project loaded. Ask the user to import a clip first.",
        };

      const diff = store.getStagedDiff();
      if (diff.totalCount === 0)
        return {
          committed: false,
          reason: "nothing_staged",
        };

      const confirmed = await showConfirmDialog({
        diff,
        message: `Commit ${diff.totalCount} staged change(s)?\n\n${diff.added.join("\n")}`,
      });

      if (!confirmed)
        return {
          committed: false,
          reason: "user_declined",
        };

      store.commitAll();
      return {
        committed: true,
        itemsCommitted: diff.totalCount,
        message:
          "All staged changes committed. The project is updated.",
      };
    },
  });
}
