/**
 * WebMCP Editing & Staging Tools.
 * Registered via registerToolWithLifecycle.
 * Staging tools do NOT commit — they add to staged* arrays for human review.
 * Action/write tools are gated by showConfirmDialog.
 *
 * TIME SPACE CONTRACT: every `timestamp` parameter these tools accept is in
 * CURRENT TIMELINE seconds (what the agent sees from read tools). Conversion
 * to absolute source-media seconds (the storage space) happens here via
 * timeSpace.ts — agents never do that math. Tools that shift the timeline bump
 * `timelineRevision` and say `timelineShifted: true` so the agent re-ingests.
 */

import { registerToolWithLifecycle } from "./lifecycle";
import { useProjectStore } from "../stores/projectStore";
import { projectDuration, resolveSegment, segmentDuration } from "@panoptik/engine";
import type { AspectPreset, Background, Segment, TextAnimation, TextOverlay, ZoomPoint } from "@panoptik/schema";
import type { AudioAnalysisResult } from "@panoptik/engine";
import { bumpTimelineRevision, getTimelineRevision, STALENESS_CONTRACT } from "./revision";
import { timelineToSegmentSource } from "./timeSpace";

const MAX_PROPOSALS = 200;
const MAX_TEXT_LENGTH = 200;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const clampNumber = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export const safeColor = (v: unknown, fallback: string): string =>
  typeof v === "string" && HEX_COLOR.test(v.trim()) ? v.trim() : fallback;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/**
 * The segment that owns a timeline timestamp: the selected segment when it
 * spans the time, otherwise whatever the playhead resolves to. Staging tools
 * write into the selected segment, so they select this one first.
 */
function owningSegment(): { project: NonNullable<ReturnType<typeof useProjectStore.getState>["project"]>; seg: Segment } | null {
  const s = useProjectStore.getState();
  if (!s.project || s.project.segments.length === 0) return null;
  const selected = s.project.segments.find((x) => x.id === s.selectedSegmentId);
  const atPlayhead = resolveSegment(s.project, s.currentTime)?.segment;
  const seg = selected ?? atPlayhead ?? s.project.segments[0]!;
  return { project: s.project, seg };
}

/** Compact post-mutation clip map so agents can see the new timeline immediately. */
function clipMap(project: NonNullable<ReturnType<typeof useProjectStore.getState>["project"]>) {
  let acc = 0;
  return project.segments.map((seg, idx) => {
    const dur = segmentDuration(seg);
    const start = acc;
    acc += dur;
    return {
      clipIndex: idx,
      id: seg.id,
      timelineStart: Number(start.toFixed(2)),
      timelineEnd: Number(acc.toFixed(2)),
      duration: Number(dur.toFixed(2)),
      speed: seg.speed,
    };
  });
}

export function registerEditingTools(): void {
  // ── 1. STAGING: PROPOSE ZOOM POINTS ──

  registerToolWithLifecycle({
    name: "propose_zoom_points",
    description:
      "Proposes zoom-in keyframes at specific timeline timestamps. Proposals appear as ghost diamond markers on the timeline for human review — they are NOT applied until commit_staged_changes. Timestamps are CURRENT TIMELINE seconds.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number" },
          description: "Timeline seconds where zoom-in keyframes should be placed.",
        },
        scale: {
          type: "number",
          minimum: 1.2,
          maximum: 5,
          description: "Zoom magnification depth (default 2.2). Range 1.2 to 5.0.",
        },
        focalX: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized focal X center (0 to 1, default 0.5).",
        },
        focalY: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Normalized focal Y center (0 to 1, default 0.5).",
        },
      },
      required: ["timestamps"],
    },
    execute: async ({
      timestamps,
      scale,
      focalX,
      focalY,
    }: {
      timestamps: number[];
      scale?: number;
      focalX?: number;
      focalY?: number;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      const own = owningSegment();
      if (!own) return { error: "No segment available to stage zooms into." };
      const { project, seg } = own;
      // Staging writes to the selected segment — select the owning one first.
      if (seg.id !== store.selectedSegmentId) store.selectSegment(seg.id);

      const list = Array.isArray(timestamps) ? timestamps : [];
      // Timeline seconds → this segment's source seconds; out-of-clip times skipped.
      const converted = list
        .filter((t: number) => typeof t === "number" && Number.isFinite(t))
        .map((t: number) => timelineToSegmentSource(project, seg, t))
        .filter((srcT: number) => srcT > seg.srcStart + 0.001 && srcT < seg.srcEnd - 0.001)
        .slice(0, MAX_PROPOSALS);

      const depth = clampNumber(scale, 1.2, 5, 2.2);
      const fx = clampNumber(focalX, 0, 1, 0.5);
      const fy = clampNumber(focalY, 0, 1, 0.5);

      const proposals: ZoomPoint[] = converted.map((srcT: number) => ({
        id: generateId(),
        t: Number(srcT.toFixed(2)),
        to: { scale: depth, x: fx, y: fy },
        dur: 0.7,
        ease: "easeInOutCubic",
        staged: true,
      }));

      store.stageZoomProposals(proposals);
      return {
        timelineRevision: getTimelineRevision(),
        stagedCount: proposals.length,
        outOfRangeSkipped: list.length - converted.length,
        proposals: proposals.map((p) => ({ t: p.t, scale: p.to.scale })),
        message: `${proposals.length} zoom proposal(s) staged as ghosts on the timeline. Call commit_staged_changes to apply them permanently.`,
      };
    },
  });

  // ── 2. STAGING: ADD TEXT OVERLAY ──

  registerToolWithLifecycle({
    name: "add_text_overlay",
    description:
      "Stages a styled text caption or annotation overlay at a specific timeline timestamp and screen position. Supports custom fonts, sizes, colors, backdrops, and entrance/exit animations. Staged overlays appear for review until committed. Timestamps are CURRENT TIMELINE seconds.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text content to display (no emojis).",
        },
        timestamp: {
          type: "number",
          description: "When the text should appear (timeline seconds).",
        },
        duration: {
          type: "number",
          description: "Duration in seconds (default 3.0).",
        },
        position: {
          type: "string",
          enum: ["top", "bottom", "center"],
          description: "Vertical position on screen (default 'bottom').",
        },
        fontSize: {
          type: "number",
          description: "Font size in pixels (e.g. 24, 36, 48).",
        },
        fontFamily: {
          type: "string",
          description: "Font family (e.g. 'Inter', 'Outfit', 'Montserrat', 'Playfair Display', 'Fira Code').",
        },
        fontWeight: {
          type: "string",
          enum: ["normal", "bold", "600", "800", "900"],
          description: "Font weight (e.g. 'bold', '600', '900').",
        },
        fontStyle: {
          type: "string",
          enum: ["normal", "italic"],
          description: "Font style ('normal' or 'italic').",
        },
        color: {
          type: "string",
          description: "Text color hex or rgba (e.g. '#ffffff', '#facc15').",
        },
        backgroundColor: {
          type: "string",
          description: "Backdrop pill color (e.g. 'rgba(15,23,42,0.85)', '#1e293b').",
        },
        borderRadius: {
          type: "number",
          description: "Backdrop corner radius in pixels (e.g. 8, 12).",
        },
        animation: {
          type: "string",
          enum: ["none", "fade", "pop", "slide-up", "slide-down", "zoom-in", "typewriter", "bounce"],
          description: "Entrance/exit animation (default 'fade').",
        },
      },
      required: ["text", "timestamp"],
    },
    execute: async ({
      text,
      timestamp,
      duration,
      position,
      fontSize,
      fontFamily,
      fontWeight,
      fontStyle,
      color,
      backgroundColor,
      borderRadius,
      animation,
    }: {
      text: string;
      timestamp: number;
      duration?: number;
      position?: string;
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: "normal" | "bold" | "600" | "800" | "900";
      fontStyle?: "normal" | "italic";
      color?: string;
      backgroundColor?: string;
      borderRadius?: number;
      animation?: TextAnimation;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      const safeText = String(text ?? "").slice(0, MAX_TEXT_LENGTH);
      if (!safeText.trim()) return { error: "Text must not be empty." };

      const own = owningSegment();
      if (!own) return { error: "No segment available to stage the overlay into." };
      const { project, seg } = own;
      if (seg.id !== store.selectedSegmentId) store.selectSegment(seg.id);

      const where = position === "top" || position === "center" || position === "bottom" ? position : "bottom";
      const dur = typeof duration === "number" && duration > 0 ? duration : 3.0;
      const srcT = timelineToSegmentSource(project, seg, typeof timestamp === "number" ? timestamp : 0);

      store.stageTextOverlay({
        id: generateId(),
        text: safeText,
        timestamp: Number(srcT.toFixed(2)),
        duration: dur,
        position: where,
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle,
        color,
        backgroundColor,
        borderRadius,
        animation,
        staged: true,
      });

      return {
        timelineRevision: getTimelineRevision(),
        staged: true,
        text: safeText,
        timestamp: Number(srcT.toFixed(2)),
        duration: dur,
        position: where,
        message: `Text overlay "${safeText}" staged at ${srcT.toFixed(2)}s (${dur}s duration). Call commit_staged_changes to apply.`,
      };
    },
  });

  // ── 3. STAGING: SET BACKGROUND ──

  registerToolWithLifecycle({
    name: "set_background",
    description:
      "Stages a background color or gradient change. Fills the stage padding area around the video when aspect ratio padding is visible.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["solid", "gradient"],
          description: "Background type: 'solid' (single color) or 'gradient' (two-stop linear gradient).",
        },
        color: {
          type: "string",
          description: "Hex color for solid background, e.g. '#0a0a0a'.",
        },
        stops: {
          type: "array",
          items: { type: "string" },
          description: "Array of two hex colors for gradient, e.g. ['#007cf0', '#7928ca'].",
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
      if (!store.project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      const bg: Background =
        kind === "solid"
          ? { kind: "solid", color: safeColor(color, "#000000") }
          : {
              kind: "gradient",
              stops: [safeColor(stops?.[0], "#007cf0"), safeColor(stops?.[1], "#7928ca")] as [string, string],
            };

      store.stageBackground(bg);
      return {
        timelineRevision: getTimelineRevision(),
        staged: true,
        background: bg,
        message: `${kind} background staged. NOTE: the backdrop is only visible where the stage has padding — propose_edits {op:'bg'} auto-enables 16:9 padding; with aspect 'source' the frame fills the canvas and the background stays hidden.`,
      };
    },
  });

  // ── 4. STAGING: GENERATE CAPTIONS ──

  registerToolWithLifecycle({
    name: "generate_captions",
    description:
      "Transcribes the video's audio (camera/mic + screen tracks separately) and generates timestamped additive subtitle phrases across the timeline — same pipeline as the manual Auto-Generate button. Always call this first if get_transcript is empty — cuts, zooms and silence detection all depend on speech timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Audio language: 'auto', 'hinglish', 'en', 'hi', 'es', 'fr', 'de', 'ja', 'zh'. Default 'auto'.",
        },
        includeSpeakerLabels: {
          type: "boolean",
          description: "Prefix captions with 'Speaker:' / 'Screen:' (default true, matches the manual Speaker toggle).",
        },
        presetId: {
          type: "string",
          description: "Caption style preset id: viral, clean, outline, subtitles, electric, highlighter (default 'viral').",
        },
        speakerFontSize: {
          type: "number",
          description: "Font size px for Speaker captions (default 36).",
        },
        screenFontSize: {
          type: "number",
          description: "Font size px for Screen captions (default 28).",
        },
      },
    },
    execute: async ({
      language,
      includeSpeakerLabels = true,
      presetId = "viral",
      speakerFontSize = 36,
      screenFontSize = 28,
    }: {
      language?: string;
      includeSpeakerLabels?: boolean;
      presetId?: string;
      speakerFontSize?: number;
      screenFontSize?: number;
    }) => {
      const store = useProjectStore.getState();
      const project = store.project;
      if (!project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }
      const own = owningSegment();
      if (!own) return { error: "No segment available to generate captions into." };
      const { seg } = own;
      if (seg.id !== store.selectedSegmentId) store.selectSegment(seg.id);

      try {
        const { getLastTranscriptionProvider } = await import("../lib/ai/providers");
        const {
          CAPTION_PRESETS,
          DEFAULT_CAPTION_PRESET_ID,
          DEFAULT_SPEAKER_FONT_SIZE,
          DEFAULT_SCREEN_FONT_SIZE,
          packStreamWordsAdditively,
          transcribeTrackAudio,
        } = await import("../lib/captions");
        const { decodeViaAudioContext, resampleMonoPcm } = await import("@panoptik/engine");
        const lang = language || "auto";
        const withSpeakers = includeSpeakerLabels !== false;
        const preset =
          CAPTION_PRESETS.find((p) => p.id === presetId) ??
          CAPTION_PRESETS.find((p) => p.id === DEFAULT_CAPTION_PRESET_ID) ??
          CAPTION_PRESETS[0]!;
        const speakerSize =
          typeof speakerFontSize === "number" && Number.isFinite(speakerFontSize)
            ? speakerFontSize
            : DEFAULT_SPEAKER_FONT_SIZE;
        const screenSize =
          typeof screenFontSize === "number" && Number.isFinite(screenFontSize)
            ? screenFontSize
            : DEFAULT_SCREEN_FONT_SIZE;

        // Same dual-track sources as the manual panel: camera/mic + screen.
        const media = project.media.find((m) => m.id === seg.mediaId) ?? project.media[0];
        const speakerSrc = seg.facecam?.src || project.audioSrc;
        const screenSrc = media?.src;

        const decodeSrc = async (src: string | null | undefined): Promise<AudioBuffer | null> => {
          if (!src) return null;
          try {
            const res = await fetch(src);
            if (!res.ok) return null;
            const blob = await res.blob();
            if (blob.size === 0) return null;
            const buf = await decodeViaAudioContext(blob);
            return buf && buf.duration > 0 ? buf : null;
          } catch {
            return null;
          }
        };

        const [decodedSpeaker, decodedScreen] = await Promise.all([
          decodeSrc(speakerSrc),
          decodeSrc(screenSrc),
        ]);

        if (!decodedSpeaker && !decodedScreen) {
          return { error: "No decodable audio track found in screen or camera recording." };
        }

        // Separate STT requests per track (parallel) — identical to manual.
        const trackTasks: { label: "Speaker" | "Screen"; buffer: AudioBuffer }[] = [];
        if (decodedSpeaker) trackTasks.push({ label: "Speaker", buffer: decodedSpeaker });
        if (decodedScreen && decodedScreen !== decodedSpeaker) {
          trackTasks.push({ label: "Screen", buffer: decodedScreen });
        }

        const trackResults = await Promise.all(
          trackTasks.map((t) => transcribeTrackAudio(t.buffer, t.label, lang)),
        );

        const generatedOverlays: TextOverlay[] = [];
        let wordCount = 0;
        trackTasks.forEach((task, idx) => {
          const words = trackResults[idx] ?? [];
          wordCount += words.length;
          if (words.length > 0) {
            generatedOverlays.push(
              ...packStreamWordsAdditively(
                words,
                task.label,
                preset,
                withSpeakers,
                task.label === "Speaker" ? speakerSize : screenSize,
              ),
            );
          }
        });

        if (generatedOverlays.length === 0) {
          return {
            transcribed: false,
            message: "Transcription ran, but no spoken words were detected in the audio.",
          };
        }

        generatedOverlays.sort((a, b) => a.timestamp - b.timestamp);

        // Direct-apply like the manual panel: replace caption overlays, keep
        // graphic text overlays intact. (commit_staged_changes reports these
        // as "applies directly" — no ghost commit needed.)
        const fresh = useProjectStore.getState();
        const targetSeg =
          fresh.project?.segments.find((s) => s.id === seg.id) ?? seg;
        const nonCaptionOverlays = targetSeg.textOverlays.filter((t) => t.kind !== "caption");
        fresh.setSegmentTextOverlays(seg.id, [...nonCaptionOverlays, ...generatedOverlays]);

        // Seed the analysis cache: real RMS silences + emphasis peaks from
        // the same audio that fed Whisper, so get_silence_intervals,
        // dropSilence cuts and emphasis-anchored zooms are grounded in actual
        // audio immediately — no separate heavy analysis pass required.
        const { setAnalysisCache, getAnalysisCache, synthesizeAnalysisFromProject } = await import("./tools-batch");
        let audioFeatures: AudioAnalysisResult | null = null;
        const featureBuffer = decodedSpeaker ?? decodedScreen;
        if (featureBuffer) {
          try {
            const pcm = resampleMonoPcm(
              featureBuffer.getChannelData(0),
              featureBuffer.sampleRate,
              16000,
            );
            if (pcm.length > 0) {
              const { extractAudioFeatures } = await import("@panoptik/engine");
              audioFeatures = extractAudioFeatures(pcm, 16000);
              const liveProject = useProjectStore.getState().project ?? project;
              setAnalysisCache({
                ...(getAnalysisCache() ?? synthesizeAnalysisFromProject(liveProject)),
                duration: audioFeatures.duration,
                audio: audioFeatures,
                words: generatedOverlays.length
                  ? trackResults.flatMap((words) =>
                      words.map((w) => ({
                        word: w.word,
                        start: w.start,
                        end: w.end,
                        speaker: 0,
                        confidence: 0.95,
                      })),
                    )
                  : [],
                phrases: generatedOverlays.map((c) => ({
                  start: c.timestamp,
                  end: c.timestamp + (c.duration ?? 3),
                  text: c.text,
                  speaker: 0,
                })),
              });
            }
          } catch (e) {
            console.warn("[WebMCP] generate_captions audio-feature seeding failed:", e);
          }
        }

        return {
          timelineRevision: getTimelineRevision(),
          staged: true,
          provider: getLastTranscriptionProvider(),
          captionCount: generatedOverlays.length,
          wordCount,
          firstPhrase: generatedOverlays[0]?.text,
          silenceCount: audioFeatures?.silences.length ?? null,
          emphasisPeakCount: audioFeatures?.loudPeaks.length ?? null,
          preset: preset.id,
          includeSpeakerLabels: withSpeakers,
          message: audioFeatures
            ? `Generated ${generatedOverlays.length} additive timestamped captions (${wordCount} words, ${preset.id} style${withSpeakers ? " with speaker prefixes" : ""}). Audio analysis is ready: ${audioFeatures.silences.length} silence interval(s) and ${audioFeatures.loudPeaks.length} emphasis peak(s) — get_silence_intervals and {op:'cut'} windows are now grounded in real audio.`
            : `Generated ${generatedOverlays.length} additive timestamped captions (${wordCount} words, ${preset.id} style). Transcript available via get_transcript (CURRENT TIMELINE seconds); cut ops need explicit {t0, t1} windows until audio analysis is available.`,
        };
      } catch (err: any) {
        console.warn("[WebMCP] generate_captions error:", err);
        return {
          staged: false,
          error: err.message || "Transcription failed.",
        };
      }
    },
  });

  // ── 5. TIMELINE: SPLIT SEGMENT & SPLIT CLIP ──
  // A split adds a boundary without shifting any timestamp, but the clip map
  // changes — agents get the new boundaries right in the response.

  registerToolWithLifecycle({
    name: "split_clip",
    description:
      "Splits the clip at a timeline timestamp into two segments. Use before delete_clip to remove an unwanted range. Timestamps are CURRENT TIMELINE seconds. The response includes the new clip map — use it, not your pre-split observations.",
    inputSchema: {
      type: "object",
      properties: {
        timestamp: {
          type: "number",
          description: "Timeline second where the split cut should occur.",
        },
      },
      required: ["timestamp"],
    },
    execute: async ({ timestamp }: { timestamp: number }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded." };
      const before = store.project.segments.length;
      store.splitAt(timestamp);
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded." };
      const segs = project.segments;
      const changed = segs.length > before;
      return {
        timelineRevision: getTimelineRevision(),
        split: changed,
        timestamp,
        structureChanged: changed,
        segmentCount: segs.length,
        clips: clipMap(project),
        totalDurationSeconds: Number(projectDuration(project).toFixed(2)),
        message: changed
          ? `Clip split at ${timestamp.toFixed(2)}s. Total clips: ${segs.length}. Timestamps did NOT shift, but clip indices/boundaries changed — use the returned clip map.`
          : `No split performed (timestamp at a clip boundary or outside the timeline).`,
      };
    },
  });

  registerToolWithLifecycle({
    name: "split_segment",
    description:
      "Splits the video clip at the given timeline timestamp. Timestamps are CURRENT TIMELINE seconds. The response includes the new clip map.",
    inputSchema: {
      type: "object",
      properties: {
        timestamp: {
          type: "number",
          description: "Timeline second where the split should occur.",
        },
      },
      required: ["timestamp"],
    },
    execute: async ({ timestamp }: { timestamp: number }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded." };
      const before = store.project.segments.length;
      store.splitAt(timestamp);
      const project = useProjectStore.getState().project;
      if (!project) return { error: "No project loaded." };
      const segs = project.segments;
      const changed = segs.length > before;
      return {
        timelineRevision: getTimelineRevision(),
        split: changed,
        timestamp,
        structureChanged: changed,
        segmentCount: segs.length,
        clips: clipMap(project),
        totalDurationSeconds: Number(projectDuration(project).toFixed(2)),
        message: changed
          ? `Clip split at ${timestamp.toFixed(2)}s. Timestamps did NOT shift, but clip indices/boundaries changed — use the returned clip map.`
          : `No split performed (timestamp at a clip boundary or outside the timeline).`,
      };
    },
  });

  // ── 6. TIMELINE: DELETE CLIP / DELETE SEGMENT ──

  registerToolWithLifecycle({
    name: "delete_clip",
    description:
      "Deletes a clip segment and ripple-joins the adjacent clips. THIS SHIFTS THE TIMELINE: every timestamp after the deleted range moves earlier. The response flags timelineShifted — you MUST re-ingest get_project_state and get_transcript afterwards and never reuse pre-delete timestamps. Cannot delete the only remaining clip.",
    inputSchema: {
      type: "object",
      properties: {
        clipIndex: {
          type: "number",
          description: "0-based index of the clip segment to delete.",
        },
        segmentId: {
          type: "string",
          description: "Optional direct segment ID.",
        },
      },
    },
    execute: async ({
      clipIndex = 0,
      segmentId,
    }: {
      clipIndex?: number;
      segmentId?: string;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded." };
      const segments = store.project.segments;
      if (segments.length <= 1) {
        return {
          error: "CANNOT_DELETE_ONLY_CLIP",
          message: "Cannot delete the only clip on the timeline.",
        };
      }
      const targetSeg = segmentId
        ? segments.find((s) => s.id === segmentId)
        : segments[clipIndex];
      if (!targetSeg) {
        return {
          error: "CLIP_NOT_FOUND",
          message: `Clip at index ${clipIndex} not found.`,
        };
      }

      // Compute the deleted range in timeline seconds BEFORE the delete.
      let acc = 0;
      let shiftFrom: number | null = null;
      let removedSeconds = 0;
      for (const seg of segments) {
        const dur = segmentDuration(seg);
        if (seg.id === targetSeg.id) {
          shiftFrom = Number(acc.toFixed(2));
          removedSeconds = Number(dur.toFixed(2));
          break;
        }
        acc += dur;
      }

      store.deleteSegment(targetSeg.id);
      const revision = bumpTimelineRevision();
      const project = useProjectStore.getState().project;
      const remaining = project?.segments ?? [];
      return {
        timelineRevision: revision,
        timelineShifted: true,
        stalenessWarning: STALENESS_CONTRACT,
        deleted: true,
        deletedSegmentId: targetSeg.id,
        remainingClips: remaining.length,
        shiftFromSecond: shiftFrom,
        removedSeconds,
        newDurationSeconds: project ? Number(projectDuration(project).toFixed(2)) : null,
        clips: project ? clipMap(project) : [],
        nextStep:
          "Timeline shifted: every timestamp after shiftFromSecond moved earlier by removedSeconds. Re-call get_project_state and get_transcript now; never reuse pre-delete timestamps for zooms, overlays, probes or cursor queries.",
        message: `Clip deleted and ripple-joined (${remaining.length} clips remaining). Timeline shifted at ${shiftFrom?.toFixed(2)}s by ${removedSeconds.toFixed(2)}s — re-ingest before further edits.`,
      };
    },
  });

  // ── 7. TIMELINE: SET CLIP TRANSITION ──

  registerToolWithLifecycle({
    name: "set_clip_transition",
    description:
      "Sets the incoming transition effect and duration on a clip segment. Does not shift timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        clipIndex: {
          type: "number",
          description: "0-based index of the clip segment.",
        },
        transition: {
          type: "string",
          enum: [
            "cut",
            "fade",
            "dipToBlack",
            "slide-left",
            "slide-right",
            "zoom-in",
            "wipe",
          ],
          description: "Transition style effect.",
        },
        duration: {
          type: "number",
          description: "Transition duration in seconds (default 0.45).",
        },
      },
      required: ["clipIndex", "transition"],
    },
    execute: async ({
      clipIndex,
      transition,
      duration = 0.45,
    }: {
      clipIndex: number;
      transition: string;
      duration?: number;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded." };
      const segments = store.project.segments;
      const targetSeg = segments[clipIndex];
      if (!targetSeg) {
        return {
          error: "CLIP_NOT_FOUND",
          message: `Clip at index ${clipIndex} does not exist.`,
        };
      }
      store.updateSegment(targetSeg.id, {
        transition: transition as any,
        transitionDuration: Math.max(0.1, Math.min(2.0, duration)),
      });
      return {
        timelineRevision: bumpTimelineRevision(),
        updated: true,
        clipIndex,
        transition,
        duration,
        message: `Clip #${clipIndex} transition set to "${transition}" (${duration}s). Timestamps did not shift.`,
      };
    },
  });

  // ── 8. TIMELINE: SET CLIP SPEED ──

  registerToolWithLifecycle({
    name: "set_clip_speed",
    description:
      "Sets playback speed for a clip segment (0.5x, 1x, 1.5x, 2x, 3x with pitch-preserved WSOLA audio). THIS SHIFTS THE TIMELINE: the segment's duration changes, so later timestamps compress or expand. Re-ingest after calling.",
    inputSchema: {
      type: "object",
      properties: {
        clipIndex: {
          type: "number",
          description: "0-based index of the clip.",
        },
        speed: {
          type: "number",
          enum: [0.5, 1, 1.5, 2, 3],
          description: "Playback speed multiplier.",
        },
      },
      required: ["clipIndex", "speed"],
    },
    execute: async ({
      clipIndex = 0,
      speed,
    }: {
      clipIndex?: number;
      speed: number;
    }) => {
      const store = useProjectStore.getState();
      if (!store.project) return { error: "No project loaded." };
      const segments = store.project.segments;
      const targetSeg = segments[clipIndex];
      if (!targetSeg) {
        return {
          error: "CLIP_NOT_FOUND",
          message: `Clip at index ${clipIndex} does not exist.`,
        };
      }
      const safeSpeed = [0.5, 1, 1.5, 2, 3].includes(speed) ? speed : 1;
      store.updateSegment(targetSeg.id, { speed: safeSpeed });
      const revision = bumpTimelineRevision();
      const project = useProjectStore.getState().project;
      return {
        timelineRevision: revision,
        timelineShifted: safeSpeed !== targetSeg.speed,
        updated: true,
        clipIndex,
        speed: safeSpeed,
        newDurationSeconds: project ? Number(projectDuration(project).toFixed(2)) : null,
        nextStep:
          safeSpeed !== targetSeg.speed
            ? "Segment duration changed — timestamps after this clip shifted. Re-call get_project_state and get_transcript before further edits."
            : undefined,
        message: `Clip #${clipIndex} speed updated to ${safeSpeed}x.`,
      };
    },
  });

  registerToolWithLifecycle({
    name: "set_speed",
    description:
      "Sets playback speed multiplier for the selected segment (0.5x, 1x, 1.5x, 2x). THIS SHIFTS THE TIMELINE — re-ingest after calling.",
    inputSchema: {
      type: "object",
      properties: {
        speed: {
          type: "number",
          enum: [0.5, 1, 1.5, 2],
          description: "Playback speed multiplier.",
        },
      },
      required: ["speed"],
    },
    execute: async ({ speed }: { speed: number }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded." };
      }

      const safeSpeed = [0.5, 1, 1.5, 2].includes(speed) ? speed : 1;
      store.updateSelectedSegments({ speed: safeSpeed });
      const revision = bumpTimelineRevision();
      const project = useProjectStore.getState().project;
      return {
        timelineRevision: revision,
        timelineShifted: true,
        speed: safeSpeed,
        newDurationSeconds: project ? Number(projectDuration(project).toFixed(2)) : null,
        nextStep: "Segment durations changed — re-call get_project_state and get_transcript before further edits.",
        message: `Clip speed updated to ${safeSpeed}x.`,
      };
    },
  });

  // ── 9. TIMELINE: SET ASPECT ──

  registerToolWithLifecycle({
    name: "set_aspect",
    description:
      "Sets the stage aspect ratio preset ('16:9', '9:16', '1:1', '4:3', or 'source'). Does not shift timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["16:9", "9:16", "1:1", "4:3", "source"],
          description: "Aspect ratio preset.",
        },
      },
      required: ["preset"],
    },
    execute: async ({ preset }: { preset: AspectPreset }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded." };
      }

      const validPresets: AspectPreset[] = ["16:9", "9:16", "1:1", "4:3", "source"];
      const targetPreset = validPresets.includes(preset) ? preset : "16:9";
      store.setAspectPreset(targetPreset);

      return {
        timelineRevision: getTimelineRevision(),
        aspect: targetPreset,
        message: `Aspect ratio preset set to ${targetPreset}.`,
      };
    },
  });

  // ── 10. TIMELINE: ADD MUSIC ──

  registerToolWithLifecycle({
    name: "add_music",
    description:
      "Adds or moves an audio track on the timeline at a specified start timestamp (timeline seconds).",
    inputSchema: {
      type: "object",
      properties: {
        trackId: {
          type: "string",
          description: "ID of the audio track.",
        },
        startT: {
          type: "number",
          description: "Timeline start offset in seconds.",
        },
      },
      required: ["trackId", "startT"],
    },
    execute: async ({ trackId, startT }: { trackId: string; startT: number }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded." };
      }

      const existing = store.project.audioTracks?.find((t) => t.id === trackId);
      if (!existing) {
        return {
          error: `Audio track "${trackId}" not found. Import an audio file first.`,
        };
      }

      store.updateAudioTrack(trackId, { startT: Math.max(0, startT) });
      return {
        timelineRevision: getTimelineRevision(),
        trackId,
        startT: Math.max(0, startT),
        message: `Audio track "${existing.name}" positioned at ${startT.toFixed(2)}s.`,
      };
    },
  });

  // NOTE: commit_staged_changes and discard_staged_changes are registered once
  // in tools-batch.ts (registered last → authoritative). Do not duplicate them
  // here: duplicate names made the console dispatch ambiguous.
}
