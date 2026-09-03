/**
 * Consolidated core WebMCP tool catalog for Panoptik (registered last → authoritative).
 * Implements:
 * 1. get_director_guidelines (Read-Only Free)
 * 2. get_video_summary (Read-Only Free)
 * 3. get_scene_detail (Read-Only Free)
 * 4. probe_frames (Read-Only Free)
 * 5. locate_visual_target (Read-Only Free)
 * 6. propose_edits (Batch Apply Free)
 * 7. commit_staged_changes (Action Free)
 * 8. discard_staged_changes (Action Free)
 * 9. cloud_transcribe (Cloud AI Pro / BYOK)
 * 10. ai_auto_director (Cloud AI Pro / BYOK)
 *
 * TIME SPACE CONTRACT: read tools return CURRENT TIMELINE seconds (mapped from
 * the source-space analysis cache at the boundary — the cache itself stays in
 * source space for snapping). propose_edits accepts timeline-space ops.
 */

import {
  generateVideoDigest,
  type FullMediaAnalysis,
  type SilenceInterval,
  type SceneFeature,
  type VideoDigest,
} from "@panoptik/engine";
import type { Project } from "@panoptik/schema";
import { useProjectStore } from "../stores/projectStore";
import { showConfirmDialog } from "./confirm";
import { registerToolWithLifecycle } from "./lifecycle";
import { snapAndRebaseEditOps, type EditOp } from "./snapping";
import { executeBatchOps } from "./batchExecutor";
import { runAutoDirector, transcribeAudioStream } from "../lib/ai/providers";
import { bumpTimelineRevision, getTimelineRevision, STALENESS_CONTRACT } from "./revision";
import { AUTONOMOUS_DECISION_TREE, DIRECTOR_RULES, STANDARD_PROTOCOL, directorPlaybookBlock } from "./playbook";
import { mapAnalysisToTimeline, mapIntervalToTimeline, sourceToTimelineT, timelineToSource } from "./timeSpace";

let currentAnalysisCache: FullMediaAnalysis | null = null;

export function setAnalysisCache(analysis: FullMediaAnalysis | null): void {
  currentAnalysisCache = analysis;
}

export function getAnalysisCache(): FullMediaAnalysis | null {
  return currentAnalysisCache;
}

/**
 * A minimal source-space analysis synthesized from project state alone, used
 * when the full media analysis has not been computed. Gives the snapping
 * pipeline silence intervals (caption/speech gaps) and scenes so cut ops and
 * feature lookups still work; real RMS silences and emphasis peaks replace it
 * once generate_captions seeds the cache.
 */
export function synthesizeAnalysisFromProject(project: Project): FullMediaAnalysis {
  const total = project.media[0]?.duration ?? 0;
  const speech = project.segments
    .flatMap((s) => [...(s.textOverlays ?? []), ...(s.stagedTextOverlays ?? [])])
    .filter((o) => Boolean(o.text?.trim()) && o.kind === "caption")
    .map((c) => ({ start: c.timestamp, end: c.timestamp + (c.duration ?? 3) }))
    .sort((a, b) => a.start - b.start);

  const silences: SilenceInterval[] = [];
  let prevEnd = 0;
  for (const p of speech) {
    if (p.start - prevEnd >= 0.45) {
      silences.push({ start: prevEnd, end: p.start, duration: Number((p.start - prevEnd).toFixed(2)) });
    }
    prevEnd = Math.max(prevEnd, p.end);
  }
  if (total - prevEnd >= 0.45) {
    silences.push({ start: prevEnd, end: total, duration: Number((total - prevEnd).toFixed(2)) });
  }

  const scenes: SceneFeature[] = project.segments.map((seg, idx) => {
    const fc = seg.facecam;
    const isLeft = (fc?.x ?? 0.8) < 0.5;
    const isTop = (fc?.y ?? 0.8) < 0.5;
    return {
      id: idx,
      t0: seg.srcStart,
      t1: seg.srcEnd,
      motionCategory: "medium" as const,
      paletteIndex: 0,
      camCorner: (fc?.src ? `${isTop ? "t" : "b"}${isLeft ? "l" : "r"}` : "br") as SceneFeature["camCorner"],
      keyframeTime: (seg.srcStart + seg.srcEnd) / 2,
    };
  });

  return {
    mediaId: project.media[0]?.id ?? "m1",
    sampledHash: "synthetic",
    duration: total,
    scenes,
    audio: {
      duration: total,
      silences,
      minorPauses: [],
      loudPeaks: [],
      speechRatio: speech.length > 0 ? 0.6 : 0,
    },
    words: [],
    phrases: [],
    interactions: [],
    createdAt: Date.now(),
  };
}

/** The best analysis available: the real cache when present, else the synthesized one. */
export function resolveAnalysis(project: Project): FullMediaAnalysis {
  return currentAnalysisCache ?? synthesizeAnalysisFromProject(project);
}

export function registerBatchTools(): void {
  // ── 0. get_director_guidelines (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_director_guidelines",
    description:
      "Returns the authoritative Video Director reasoning playbook: multimodal heuristics, zoom scales, text overlay rules (no emojis), keepouts, the staleness contract, and the autonomous decision tree for vague requests like 'edit the reaction video'.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    annotations: { readOnlyHint: true },
    execute: async () => {
      return {
        timelineRevision: getTimelineRevision(),
        guideTitle: "Panoptik AI Video Director Playbook",
        corePhilosophy:
          "Multimodal spatial-temporal reasoning (Spoken intent + Human cursor telemetry + Frame probing)",
        rules: DIRECTOR_RULES,
        standardProtocol: STANDARD_PROTOCOL,
        autonomousDecisionTree: AUTONOMOUS_DECISION_TREE,
        stalenessContract: STALENESS_CONTRACT,
        textOverlayStyles: {
          fonts: ["Inter", "Outfit", "Montserrat", "Playfair Display", "Fira Code"],
          animations: ["fade", "pop", "slide-up", "slide-down", "zoom-in", "typewriter", "bounce"],
          backdrops: ["rgba(15,23,42,0.85)", "#1e293b", "rgba(0,0,0,0.75)"],
        },
      };
    },
  });

  // ── 1. get_video_summary (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_video_summary",
    description:
      "Returns the complete semantic summary of the loaded video in CURRENT TIMELINE seconds: transcript phrases, scene breakdown, silence intervals, dead air, facecam corner, and the Director Playbook. Call this to understand the video before editing; call generate_captions first if the transcript is missing.",
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
      const project = store.project;

      const allTextOverlays = project.segments.flatMap((s) => [
        ...(s.textOverlays ?? []),
        ...(s.stagedTextOverlays ?? []),
      ]);
      // Caption overlays store source-media timestamps — map to the current
      // timeline and drop phrases whose moment was trimmed away.
      const phrasesFromCaptions = allTextOverlays
        .filter((o) => Boolean(o.text && o.text.trim()))
        .flatMap((c) => {
          const iv = mapIntervalToTimeline(project, c.timestamp, c.timestamp + (c.duration ?? 3));
          return iv
            ? [{ start: iv.start, end: iv.end, text: c.text, speaker: c.speaker === "Screen" ? 1 : 0 }]
            : [];
        });

      let analysisForDigest: FullMediaAnalysis;
      if (currentAnalysisCache) {
        // Map the source-space cache into current timeline space for the agent.
        const mapped = mapAnalysisToTimeline(project, currentAnalysisCache);
        analysisForDigest =
          mapped.phrases.length > 0
            ? mapped
            : { ...mapped, phrases: phrasesFromCaptions };
      } else {
        // Synthesized source-space analysis (caption-gap silences + segment
        // scenes), mapped to the current timeline for the digest.
        analysisForDigest = mapAnalysisToTimeline(project, synthesizeAnalysisFromProject(project));
        if (analysisForDigest.phrases.length === 0) {
          analysisForDigest = { ...analysisForDigest, phrases: phrasesFromCaptions };
        }
      }

      const digest = generateVideoDigest(project, analysisForDigest);
      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        ...digest,
        suggestedNextActions: [
          ...(digest.transcript ? [] : ["Transcript is empty — call generate_captions to unlock speech-aware editing."]),
          "Call get_silence_intervals to find dead-air cut candidates.",
          "Call get_click_log + probe_frames to ground zoom targets.",
          "Stage everything in ONE propose_edits call, then commit_staged_changes.",
        ],
        directorPlaybook: directorPlaybookBlock(),
      };
    },
  });

  // ── 2. get_scene_detail (Read-Only Free) ──
  registerToolWithLifecycle({
    name: "get_scene_detail",
    description:
      "Lazy drill-down: returns raw click coordinates, bounding box, and word-level timestamps for a single scene. Windows are in CURRENT TIMELINE seconds.",
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
      const project = store.project;
      const clicks = project?.clickLog ?? [];
      const scene = currentAnalysisCache?.scenes.find((s) => s.id === sceneId);
      const interaction = currentAnalysisCache?.interactions.find((i) => i.sceneId === sceneId);

      let sceneWindow: { t0: number; t1: number } | null = null;
      if (scene && project) {
        const mapped = mapIntervalToTimeline(project, scene.t0, scene.t1, currentAnalysisCache?.mediaId);
        sceneWindow = mapped ? { t0: Number(mapped.start.toFixed(2)), t1: Number(mapped.end.toFixed(2)) } : null;
      } else if (scene) {
        sceneWindow = { t0: scene.t0, t1: scene.t1 };
      }

      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        sceneId,
        sceneWindow,
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
    description:
      "Samples video frames at timeline timestamps: returns deterministic feature summaries and base64 snapshot images with an optional A1..C3 alphanumeric 3x3 grid for visual grounding. Snapshot rendering can take seconds on long recordings — request only the timestamps you need and set includeSnapshot:false when you only need features. Use the grid cells to reference screen regions in locate_visual_target. Timestamps are CURRENT TIMELINE seconds.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number" },
          description: "List of timeline timestamps to query",
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
          // Scene features are indexed in source time; probe times are timeline time.
          const srcRef = store.project ? timelineToSource(store.project, t) : null;
          const analysis = store.project ? resolveAnalysis(store.project) : null;
          const scene = srcRef
            ? analysis?.scenes.find((s) => srcRef.srcT >= s.t0 && srcRef.srcT <= s.t1)
            : undefined;
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
              ? `${currentAnalysisCache ? "" : "(synthetic) "}${scene.motionCategory} motion, palette: ${scene.paletteIndex}, camCorner: ${scene.camCorner}`
              : "No scene analysis available at this timestamp",
            snapshot,
          };
        }),
      );

      return {
        timelineRevision: getTimelineRevision(),
        timeSpace: "timeline",
        frames,
      };
    },
  });

  // ── 3b. locate_visual_target (Tiered Grounding & Viewport Verification) ──
  registerToolWithLifecycle({
    name: "locate_visual_target",
    description:
      "Grounds a visual target into a safe zoom focal point via a 3-tier hierarchy: (1) click telemetry near the timestamp (confidence 1.0), (2) parse VLM output — Gemini-style 0-1000 bbox, 3x3 grid cell (A1..C3), or normalized x/y — from probe_frames snapshots, (3) fallback center with guidance. Timestamps are CURRENT TIMELINE seconds.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Target element description, e.g. 'elephant' or 'search bar'" },
        timestamp: { type: "number", description: "Timeline timestamp to search in" },
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

      // Tier 1: Deterministic click telemetry within ±1.5s (timeline space —
      // clickLog t values are mapped at read time by get_click_log; the raw
      // store is source space, so map the window over raw clicks).
      const clicks = project.clickLog ?? [];
      const timelineClicks = clicks
        .map((c) => {
          const tl = sourceToTimelineT(project, c.t);
          return tl == null ? null : { ...c, t: tl };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);
      const match = timelineClicks.find((c) => Math.abs(c.t - timestamp) <= 1.5);
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
        guidance:
          "No high-confidence visual target found. If your host cannot display snapshot images, ground zooms on get_click_log attention centroids inside the zoom window instead — propose_edits does this automatically when cx/cy are omitted. Otherwise use probe_frames({ timestamps: [" +
          timestamp +
          "], gridOverlay: true }) to inspect visual cells, then pass the grid cell or bbox as vlmOutput.",
      };
    },
  });

  // ── 4. propose_edits (Batch Apply) ──
  registerToolWithLifecycle({
    name: "propose_edits",
    description:
      "The main editing tool: applies one atomic batch of edit ops in a single call. STAGE BASELINE (automatic): every batch applies the signature look — gradient backdrop, 28px stage padding, 16px rounded frame corners — unless the batch carries its own {op:'bg'}. ZOOMS PERSIST: zoom windows auto-extend until the next scene boundary or a sustained cursor move to a different region (minimum 4s hold). Ops (times in CURRENT TIMELINE seconds): {op:'cut', t0, t1} removes the exact window — the deterministic form, pass the intervals from get_silence_intervals; {op:'cut', t, dropSilence:true} expands t to the matching silence interval; a cut without a window or matching silence is REJECTED, never silently skipped. Also: {op:'zoom', t0, t1, cx?, cy?, scale?, ease?}; {op:'text', t, text, pos?:'top'|'bottom'|'center', dur?, fontSize?, fontWeight?, color?, backgroundColor?, animation?}; {op:'cam', corner:'tl'|'tr'|'bl'|'br', shape?, size?}; {op:'bg', kind:'solid'|'gradient', c0, c1?}; {op:'trans', at, kind, dur?}; {op:'speed', t0, t1, mult}. mode 'replace' clears prior agent zooms/overlays but NEVER Whisper captions. MANDATORY RULES: (1) NO emojis in text. (2) Multi-stage sequential pans (1.6x-1.8x) for long content. (3) Invert overlay position vs zoom half. (4) Verify targets via probe_frames, not a parked cursor. AFTER CUTS: the response sets cutsApplied and timelineShifted — re-ingest get_project_state + get_transcript before any further op batch. CHECK rejectedOps: a rejected cut means dead air was NOT removed.",
    inputSchema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          description: "Array of EditOp objects (see description for the exact shapes)",
          items: { type: "object" },
        },
        plan: { type: "string", description: "Concise explanation of your editorial strategy" },
        mode: { type: "string", enum: ["replace", "append"], description: "replace (default) or append" },
      },
      required: ["ops"],
    },
    execute: async ({ ops, plan, mode = "replace" }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "NO_ACTIVE_PROJECT", message: "No active video project loaded." };
      }
      const rawOps = Array.isArray(ops) ? (ops as EditOp[]) : [];
      // Prefer the real analysis; fall back to a project-synthesized one so
      // dropSilence cuts and scene lookups work before a full analysis exists.
      const analysis = resolveAnalysis(store.project);
      const snappedBatch = snapAndRebaseEditOps(rawOps, analysis, store.project);
      const executionResult = executeBatchOps(snappedBatch, mode as "replace" | "append");

      const revision =
        executionResult.stagedCount > 0 ? bumpTimelineRevision() : getTimelineRevision();

      return {
        appliedToTimeline: true,
        timelineRevision: revision,
        timelineShifted: executionResult.cutsApplied.count > 0,
        plan: plan || "Batched edits applied.",
        appliedCount: executionResult.stagedCount,
        analysisSource: currentAnalysisCache ? "media_analysis" : "synthesized_from_project",
        diffSummary: executionResult.diffSummary.replace(/^Staged:/, "Applied:"),
        diff: executionResult.diff,
        cutsApplied: executionResult.cutsApplied,
        stageBaseline: {
          ...executionResult.stageBaseline,
          note: "Gradient backdrop, 28px stage padding and rounded frame corners applied automatically (overridden by an explicit {op:'bg'}).",
        },
        newDurationSeconds: executionResult.newDurationSeconds,
        rejectedCount: executionResult.rejectedCount,
        rejectedOps: executionResult.rejectedOps,
        nextStep:
          executionResult.cutsApplied.count > 0
            ? `Cuts removed ${executionResult.cutsApplied.droppedSeconds}s and the timeline shifted. Re-call get_project_state and get_transcript now; all pre-edit timestamps are stale. Do NOT place more cuts at pre-shift times.`
            : executionResult.rejectedCount > 0
              ? "Some ops were REJECTED (see rejectedOps) and were not applied — fix and re-propose them. Do not report them as done."
              : "Verify with inspect_timeline if needed, then commit_staged_changes (ghost items) and offer export_clip.",
        humanApproval:
          "commit_staged_changes and export_clip surface a human confirmation dialog — check their responses for user_declined rather than assuming success.",
      };
    },
  });

  // ── 5. commit_staged_changes (Action Free) ──
  registerToolWithLifecycle({
    name: "commit_staged_changes",
    description:
      "Commits ALL staged ghost proposals (from propose_zoom_points, add_text_overlay, set_background, generate_captions) permanently. Shows the staged diff dialog for human confirmation. Edits already applied via propose_edits need no commit.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const store = useProjectStore.getState();
      const diff = store.getStagedDiff();

      if (diff.totalCount === 0) {
        const activeZooms = store.project?.segments.flatMap((s) => s.zoomPoints).length ?? 0;
        return {
          timelineRevision: getTimelineRevision(),
          committed: true,
          nothingStaged: true,
          itemsCommitted: activeZooms,
          message:
            activeZooms > 0
              ? "Nothing was pending: propose_edits applies its ops directly, so all proposed edits are already live on the timeline. Only ghost proposals (propose_zoom_points / add_text_overlay / set_background) need a commit dialog."
              : "Nothing staged and no pending proposals. generate_captions also applies its captions directly.",
        };
      }

      const confirmed = await showConfirmDialog({
        message: `Permanently apply ${diff.totalCount} staged edit(s) to timeline?`,
        diff,
      });

      if (!confirmed) {
        return { timelineRevision: getTimelineRevision(), committed: false, reason: "user_declined", message: "User canceled commit." };
      }

      store.commitAll();
      return { timelineRevision: getTimelineRevision(), committed: true, itemsCommitted: diff.totalCount, message: "All staged changes committed successfully." };
    },
  });

  // ── 6. discard_staged_changes (Action Free) ──
  registerToolWithLifecycle({
    name: "discard_staged_changes",
    description: "Clears all pending ghost edit proposals without modifying the committed project.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      const store = useProjectStore.getState();
      const diff = store.getStagedDiff();
      store.clearStaged();
      return { timelineRevision: getTimelineRevision(), discarded: true, itemsDiscarded: diff.totalCount };
    },
  });

  // ── 7. cloud_transcribe (Cloud AI Pro / BYOK) ──
  registerToolWithLifecycle({
    name: "cloud_transcribe",
    description: "Transcribes project audio using Cloud Whisper Large v3 with word timestamps (Requires Pro or BYOK). Prefer generate_captions first — it both transcribes and stages caption overlays.",
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

  // ── 8. ai_auto_director (Cloud AI Pro / BYOK) ──
  registerToolWithLifecycle({
    name: "ai_auto_director",
    description:
      "Hosted 1-click auto-director: sends the video digest to a cloud model (Claude Haiku / Gemini Flash) which returns a full edit plan, applied via the same snapping pipeline as propose_edits (Requires Pro or BYOK). Air-gapped mode blocks it — use the local tool pipeline instead.",
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
        const analysis = resolveAnalysis(store.project);
        const digest: VideoDigest = generateVideoDigest(store.project, mapAnalysisToTimeline(store.project, analysis));

        const response = await runAutoDirector(digest, instruction);
        // The cloud model returns ops against the digest's timeline space; the
        // snapping pipeline matches cut times against the (source-space)
        // analysis, same as a local propose_edits batch.
        const snappedBatch = snapAndRebaseEditOps(response.ops, analysis, store.project);
        const executionResult = executeBatchOps(snappedBatch, "replace");
        const revision = executionResult.stagedCount > 0 ? bumpTimelineRevision() : getTimelineRevision();

        return {
          appliedToTimeline: true,
          timelineRevision: revision,
          plan: response.plan,
          appliedCount: executionResult.stagedCount,
          diffSummary: executionResult.diffSummary.replace(/^Staged:/, "Applied:"),
          cutsApplied: executionResult.cutsApplied,
          newDurationSeconds: executionResult.newDurationSeconds,
          rejectedOps: executionResult.rejectedOps,
          nextStep:
            executionResult.cutsApplied.count > 0
              ? "Timeline shifted — re-ingest get_project_state and get_transcript before further edits."
              : executionResult.rejectedCount > 0
                ? "Some ops were REJECTED (see rejectedOps) — fix and re-propose; do not report them as done."
                : "Verify with inspect_timeline, then offer export_clip.",
        };
      } catch (err: any) {
        return { error: "DIRECTOR_ERROR", message: err.message };
      }
    },
  });
}
