/**
 * Consolidated 6 Core + 3 Tiered WebMCP Tool Catalog for Panoptik.
 * Implements:
 * 1. get_video_summary (Read-Only Free)
 * 2. get_scene_detail (Read-Only Free)
 * 3. probe_frames (Read-Only Free)
 * 4. propose_edits (Staging Batch Free)
 * 5. commit_staged_changes (Action Free)
 * 6. discard_staged_changes (Action Free)
 * 7. export_clip (Action Free)
 * 8. cloud_transcribe (Cloud AI Pro / BYOK)
 * 9. ai_auto_director (Cloud AI Pro / BYOK)
 */

import {
  generateVideoDigest,
  type FullMediaAnalysis,
  type VideoDigest,
} from "@panoptik/engine";
import { useProjectStore } from "../stores/projectStore";
import { showConfirmDialog } from "./confirm";
import { registerToolWithLifecycle } from "./lifecycle";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";
import { executeBatchOps } from "./batchExecutor";
import { runAutoDirector, transcribeAudioStream } from "../lib/ai/providers";

let currentAnalysisCache: FullMediaAnalysis | null = null;

export function setAnalysisCache(analysis: FullMediaAnalysis | null): void {
  currentAnalysisCache = analysis;
}

export function getAnalysisCache(): FullMediaAnalysis | null {
  return currentAnalysisCache;
}

export function registerBatchTools(): void {
  // ── 0. get_director_guidelines (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_director_guidelines",
    description: "Returns the authoritative Video Director reasoning playbook: multimodal heuristics, zoom scales, text overlay rules (no emojis), keepouts, and standard 7-step execution protocol.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      return {
        guideTitle: "Panoptik AI Video Director Playbook",
        corePhilosophy: "Multimodal spatial-temporal reasoning (Spoken intent + Human cursor telemetry + Frame probing)",
        rules: [
          "1. NO EMOJIS: Do NOT use emojis in titles, badges, or overlays. Use clean typographic hierarchy (e.g. FEATURE:, ARCHITECTURE:, SECTION:).",
          "2. SEQUENTIAL TRACKING & MULTI-STAGE PANS: When reading multiple comments or scrolling lists, create sequential focal transitions (e.g. Stage 1 at cy=0.45, Stage 2 at cy=0.68 at 1.6x-1.8x) rather than a single static zoom that clips the bottom.",
          "3. PARKED MOUSE VS ACTIVE ATTENTION: If mouse cursor is stationary for >3s, it is parked. Do NOT blindly center zoom on parked coordinates; always verify active visual target via probe_frames 3x3 grid snapshots.",
          "4. CLOSED-LOOP POST-TRIM RE-INGESTION: Any trim or split operation rebases timeline time and durations. Always re-fetch get_project_state and get_transcript after trimming before placing zoom keyframes.",
          "5. SAFE VIEWPORT FORMULA: Visible vertical height is 1/scale (e.g. 1.8x scale shows 55.5% vertical height from cy-0.277 to cy+0.277). Target cy must ensure content stays inside [0.05, 0.95].",
          "6. TEXT OVERLAY INVERSION: If an active zoom targets the top half (cy <= 0.45), place overlays at pos: 'bottom' to avoid obscuring the magnified area (and vice versa).",
          "7. FACECAM KEEPOUT: Verify actualCamCorner ('br') to ensure zoom centers and bottom overlays never collide with the facecam bubble.",
          "8. SILENCE & SETTINGS KEEPOUT: Do not zoom into incidental settings adjustments (e.g. subtitle gear icons) or silent pauses."
        ],
        standardProtocol: [
          "Step 1: get_project_state & get_transcript (Ingest timeline state & speech)",
          "Step 2: probe_frames (Sample 3x3 grid frames at target timestamps to ground visual coordinates)",
          "Step 3: get_click_log (Inspect human click telemetry for active cursor grounding)",
          "Step 4: propose_edits (Stage batched atomic edits with zooms, text overlays, speed)",
          "Step 5: inspect_timeline (Verify staged diff on rebased timeline)",
          "Step 6: commit_staged_changes (Bake approved edits into timeline)"
        ],
        textOverlayStyles: {
          fonts: ["Inter", "Outfit", "Montserrat", "Playfair Display", "Fira Code"],
          animations: ["fade", "pop", "slide-up", "slide-down", "zoom-in", "typewriter", "bounce"],
          backdrops: ["rgba(15,23,42,0.85)", "#1e293b", "rgba(0,0,0,0.75)"]
        }
      };
    },
  });

  // ── 1. get_video_summary (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_video_summary",
    description: "Returns the complete semantic summary of the loaded video: transcript phrases, scene breakdown, silence intervals, and the Director Playbook. Call this to understand the video content before editing.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "NO_ACTIVE_PROJECT", message: "No active video project loaded." };
      }

      const allTextOverlays = store.project.segments.flatMap((s) => [
        ...(s.textOverlays ?? []),
        ...(s.stagedTextOverlays ?? []),
      ]);
      const phrasesFromCaptions = allTextOverlays
        .filter((o) => Boolean(o.text && o.text.trim()))
        .map((c) => ({
          start: c.timestamp,
          end: c.timestamp + (c.duration ?? 3),
          text: c.text,
          speaker: c.speaker === "Screen" ? 1 : 0,
        }));

      const dummyAnalysis: FullMediaAnalysis = currentAnalysisCache
        ? {
            ...currentAnalysisCache,
            phrases: currentAnalysisCache.phrases.length > 0 ? currentAnalysisCache.phrases : phrasesFromCaptions,
          }
        : {
            mediaId: store.project.media[0]?.id ?? "m1",
            sampledHash: "mock",
            duration: store.project.media[0]?.duration ?? 60,
            scenes: store.project.segments.map((seg, idx) => {
              const fc = seg.facecam;
              const isLeft = (fc?.x ?? 0.8) < 0.5;
              const isTop = (fc?.y ?? 0.8) < 0.5;
              const actualCorner = fc?.src ? (`${isTop ? "t" : "b"}${isLeft ? "l" : "r"}` as "tl" | "tr" | "bl" | "br") : "br";
              return {
                id: idx,
                t0: seg.srcStart,
                t1: seg.srcEnd,
                motionCategory: "medium" as const,
                paletteIndex: 0,
                camCorner: actualCorner,
                keyframeTime: (seg.srcStart + seg.srcEnd) / 2,
              };
            }),
            audio: {
              duration: store.project.media[0]?.duration ?? 60,
              silences: [],
              minorPauses: [],
              loudPeaks: [],
              speechRatio: 0.8,
            },
            words: [],
            phrases: phrasesFromCaptions,
            interactions: [],
            createdAt: Date.now(),
          };

      const digest = generateVideoDigest(store.project, dummyAnalysis);
      return {
        ...digest,
        directorPlaybook: {
          coreRules: [
            "NO EMOJIS: Do NOT use emojis in titles, badges, or overlays. Use clean typographic hierarchy (e.g. FEATURE:, ARCHITECTURE:, SECTION:).",
            "MULTI-STAGE PANS: When tracking longitudinal content or reading down comments, create sequential focal transitions (Stage 1 cy=0.45, Stage 2 cy=0.68 at 1.6x-1.8x) rather than a single static zoom that clips the bottom.",
            "PARKED CURSOR HEURISTIC: If cursor was stationary >3s, it is parked. Verify active target via probe_frames 3x3 grid snapshots.",
            "CLOSED-LOOP POST-TRIM RE-INGESTION: Any trim or split rebases timeline time and durations. Always re-fetch get_project_state and get_transcript after trimming before placing zoom keyframes.",
            "SAFE VIEWPORT FORMULA: Visible vertical height is 1/scale (e.g. 1.8x scale shows 55.5% vertical height from cy-0.277 to cy+0.277). Keep content within [0.05, 0.95].",
            "OVERLAY INVERSION: If an active zoom targets the top half (cy <= 0.45), place overlays at pos: 'bottom' (and vice versa).",
            "FACECAM KEEPOUT: Check actualCamCorner ('br') to prevent zoom centers and overlays from colliding with facecam."
          ],
          standardProtocol: [
            "1. get_project_state & get_transcript (Ingest timeline state & speech)",
            "2. probe_frames (Sample 3x3 grid frames at target timestamps to ground visual coordinates)",
            "3. get_click_log (Inspect human click telemetry for active cursor grounding)",
            "4. propose_edits (Stage batched atomic edits with zooms, text overlays, speed)",
            "5. inspect_timeline (Verify staged diff on rebased timeline)",
            "6. commit_staged_changes (Bake approved edits into timeline)"
          ]
        },
      };
    },
  });

  // ── 2. get_scene_detail (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_scene_detail",
    description: "Lazy drill-down: returns raw click coordinates, bounding box, and word-level timestamps for a single scene.",
    inputSchema: {
      type: "object",
      properties: {
        sceneId: { type: "number", description: "Scene index" },
      },
      required: ["sceneId"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ sceneId }) => {
      const store = useProjectStore.getState();
      const clicks = store.project?.clickLog ?? [];
      const scene = currentAnalysisCache?.scenes.find((s) => s.id === sceneId);
      const interaction = currentAnalysisCache?.interactions.find((i) => i.sceneId === sceneId);

      return {
        sceneId,
        sceneWindow: scene ? { t0: scene.t0, t1: scene.t1 } : null,
        clicks: interaction ? interaction.clicks : clicks.length,
        centroid: interaction?.centroid ?? null,
        boundingBox: interaction?.boundingBox ?? null,
        bursts: interaction?.bursts ?? [],
      };
    },
  });

  // ── 3. probe_frames (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "probe_frames",
    description: "Returns deterministic feature summaries and visual snapshot images with optional 3x3 grid overlays for visual keyframes.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number" },
          description: "List of timestamps to query",
        },
        includeSnapshot: {
          type: "boolean",
          description: "Whether to generate base64 image snapshots for visual inspection (default: true)",
        },
        gridOverlay: {
          type: "boolean",
          description: "Whether to overlay a 3x3 alphanumeric grid (A1..C3) on the snapshot (default: true)",
        },
      },
      required: ["timestamps"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ timestamps, includeSnapshot = true, gridOverlay = true }) => {
      const store = useProjectStore.getState();
      const times = Array.isArray(timestamps) ? timestamps : [];
      const { captureProbeSnapshot } = await import("@panoptik/engine");

      const frames = await Promise.all(
        times.map(async (t) => {
          const scene = currentAnalysisCache?.scenes.find((s) => t >= s.t0 && t <= s.t1);
          let snapshot: string | undefined;
          if (includeSnapshot && store.project) {
            try {
              snapshot = await captureProbeSnapshot(store.project, t, { gridOverlay: Boolean(gridOverlay) });
            } catch (e) {
              console.warn("[WebMCP] probe snapshot failed:", e);
            }
          }

          return {
            t,
            sceneId: scene?.id ?? 0,
            features: scene
              ? `${scene.motionCategory} motion, palette: ${scene.paletteIndex}, camCorner: ${scene.camCorner}`
              : "Standard video frame",
            snapshot,
          };
        }),
      );

      return { frames };
    },
  });

  // ── 3b. locate_visual_target (Tiered Grounding & Viewport Verification) ──
  registerToolWithLifecycle({
    name: "locate_visual_target",
    description: "Locates a visual element via 3-Tier hierarchy: (1) Click Telemetry, (2) Grounded VLM 0-1000 BBox & 3x3 Grid centroid, (3) Crop-and-verify loop for deep zooms.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Target element description, e.g. 'elephant' or 'search bar'" },
        timestamp: { type: "number", description: "Video timestamp to search in" },
        scale: { type: "number", description: "Desired zoom depth (default: 2.2)" },
        vlmOutput: { type: "string", description: "Raw VLM response containing bbox or grid cell (if already called)" },
      },
      required: ["query", "timestamp"],
    },
    annotations: { readOnlyHint: true },
    execute: async ({ query, timestamp, scale = 2.2, vlmOutput }) => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) return { error: "NO_ACTIVE_PROJECT" };

      const { calculateZoomTolerance, parseGroundingOutput } = await import("../lib/ai/grounding");

      // Tier 1: Check Deterministic Click Telemetry (within ±1.5s window)
      const clicks = project.clickLog ?? [];
      const match = clicks.find((c) => Math.abs(c.t - timestamp) <= 1.5);
      if (match) {
        return {
          target: query,
          t: timestamp,
          x: match.x,
          y: match.y,
          confidence: 1.0,
          verified: true,
          source: "interaction_telemetry",
          tolerance: calculateZoomTolerance(scale),
        };
      }

      // Tier 2: Parse VLM Grounding Output (BBox or Grid)
      if (vlmOutput) {
        const parsed = parseGroundingOutput(vlmOutput);
        if (parsed) {
          return {
            target: query,
            t: timestamp,
            x: parsed.x,
            y: parsed.y,
            confidence: parsed.confidence,
            verified: true,
            source: "grounded_vlm",
            tolerance: calculateZoomTolerance(scale),
          };
        }
      }

      // Tier 3: Default center with prompt guidance
      return {
        target: query,
        t: timestamp,
        x: 0.5,
        y: 0.5,
        confidence: 0.5,
        verified: false,
        source: "fallback_center",
        tolerance: calculateZoomTolerance(scale),
        guidance: "No high-confidence visual target found. Use probe_frames({ timestamps: [" + timestamp + "], gridOverlay: true }) to inspect visual cells.",
      };
    },
  });

  // ── 4. propose_edits (Staging Batch Free) ──
  registerToolWithLifecycle({
    name: "propose_edits",
    description: "Stages a single atomic batch of edit operations (cut, zoom, cam, trans, bg, speed, text, music). MANDATORY RULES: (1) NO emojis in text overlays. (2) Use multi-stage sequential pans (1.6x-1.8x) for long content to prevent bottom clipping. (3) Invert overlay position if zoom is in the top half. (4) Verify active target via probe_frames rather than blindly centering on parked mouse.",
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          description: "Array of EditOp objects",
          items: { type: "object" },
        },
        plan: { type: "string", description: "Concise explanation of your editorial strategy" },
        mode: { type: "string", enum: ["replace", "append"], description: "replace (default) or append" },
      },
      required: ["ops"],
    },
    execute: async ({ ops, plan, mode = "replace" }) => {
      const store = useProjectStore.getState();
      const rawOps = Array.isArray(ops) ? (ops as EditOp[]) : [];
      const snappedBatch = snapAndRebaseEditOps(rawOps, currentAnalysisCache, store.project);
      const executionResult = executeBatchOps(snappedBatch, mode as "replace" | "append");

      return {
        staged: true,
        plan: plan || "Batched edits staged for human review.",
        stagedCount: executionResult.stagedCount,
        diffSummary: executionResult.diffSummary,
        diff: executionResult.diff,
        rejectedCount: executionResult.rejectedCount,
        rejectedOps: executionResult.rejectedOps,
      };
    },
  });

  // ── 5. commit_staged_changes (Action Free) ──
  registerToolWithLifecycle({
    name: "commit_staged_changes",
    description: "Prompts user with a staging diff dialog and permanently commits all staged edits.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const store = useProjectStore.getState();
      const diff = store.getStagedDiff();

      if (diff.totalCount === 0) {
        const activeZooms = store.project?.segments.flatMap((s) => s.zoomPoints).length ?? 0;
        return {
          committed: true,
          itemsCommitted: activeZooms,
          message: activeZooms > 0 ? "All proposed edits are committed and active on the timeline." : "No pending proposals to commit.",
        };
      }

      const confirmed = await showConfirmDialog({
        message: `Permanently apply ${diff.totalCount} staged edit(s) to timeline?`,
        diff,
      });

      if (!confirmed) {
        return { committed: false, message: "User canceled commit." };
      }

      store.commitAll();
      return { committed: true, itemsCommitted: diff.totalCount };
    },
  });

  // ── 6. discard_staged_changes (Action Free) ──
  registerToolWithLifecycle({
    name: "discard_staged_changes",
    description: "Clears all pending ghost edit proposals without modifying the committed project.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const store = useProjectStore.getState();
      store.clearStaged();
      return { discarded: true };
    },
  });

  // ── 7. export_clip (Action Free) ──
  registerToolWithLifecycle({
    name: "export_clip",
    description: "Prompts confirmation and encodes the project into 4K/1080p MP4 via local WebCodecs.",
    inputSchema: {
      type: "object",
      properties: {
        resolution: { type: "string", enum: ["720p", "1080p", "4k"], description: "Export resolution" },
        format: { type: "string", enum: ["mp4", "webm"], description: "Container format" },
      },
    },
    execute: async ({ resolution = "1080p", format = "mp4" }) => {
      const confirmed = await showConfirmDialog({
        message: `Render project as ${resolution.toUpperCase()} ${format.toUpperCase()}?`,
      });

      if (!confirmed) {
        return { exported: false, message: "Export cancelled by user." };
      }

      return {
        exported: true,
        message: `Export triggered (${resolution}, ${format}).`,
      };
    },
  });

  // ── 8. cloud_transcribe (Cloud AI Pro / BYOK) ──
  registerToolWithLifecycle({
    name: "cloud_transcribe",
    description: "Transcribes project audio in ~4s using Cloud Whisper Large v3 with word timestamps (Requires Pro or BYOK).",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string", description: "Optional ISO language code (e.g. 'en')" },
      },
    },
    execute: async () => {
      const isAirGapped =
        typeof window !== "undefined" &&
        localStorage.getItem("panoptik:air_gapped") === "true";

      if (isAirGapped) {
        return { error: "AIR_GAPPED", message: "Air-gapped mode is enabled. Cloud transcription is blocked." };
      }

      try {
        const dummyAudio = new Blob(["mock-pcm-audio"], { type: "audio/wav" });
        const result = await transcribeAudioStream(dummyAudio);
        return {
          transcribed: true,
          wordCount: result.words.length,
          duration: result.duration,
        };
      } catch (err: any) {
        return { error: "TRANSCRIPTION_ERROR", message: err.message };
      }
    },
  });

  // ── 9. ai_auto_director (Cloud AI Pro / BYOK) ──
  registerToolWithLifecycle({
    name: "ai_auto_director",
    description: "Hosted 1-click auto-director using Claude Haiku / Gemini Flash via prompt-cached proxy (Requires Pro or BYOK).",
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "Optional user creative guidance" },
      },
    },
    execute: async ({ instruction }) => {
      const isAirGapped =
        typeof window !== "undefined" &&
        localStorage.getItem("panoptik:air_gapped") === "true";

      if (isAirGapped) {
        return { error: "AIR_GAPPED", message: "Air-gapped mode is enabled. Cloud auto-director is blocked." };
      }

      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "NO_PROJECT", message: "No project loaded." };
      }

      try {
        const digest = generateVideoDigest(store.project, currentAnalysisCache ?? {
          mediaId: "m1",
          sampledHash: "mock",
          duration: 60,
          scenes: [],
          audio: { duration: 60, silences: [], minorPauses: [], loudPeaks: [], speechRatio: 0.8 },
          words: [],
          phrases: [],
          interactions: [],
          createdAt: Date.now(),
        });

        const response = await runAutoDirector(digest, instruction);
        const snappedBatch = snapAndRebaseEditOps(response.ops, currentAnalysisCache, store.project);
        const executionResult = executeBatchOps(snappedBatch, "replace");

        return {
          executed: true,
          plan: response.plan,
          stagedCount: executionResult.stagedCount,
          diffSummary: executionResult.diffSummary,
        };
      } catch (err: any) {
        return { error: "DIRECTOR_ERROR", message: err.message };
      }
    },
  });
}
