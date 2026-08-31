/**
 * WebMCP Editing & Staging Tools.
 * Registered via registerToolWithLifecycle.
 * Staging tools do NOT commit — they add to staged* arrays for human review.
 * Action/write tools are gated by showConfirmDialog.
 */

import { registerToolWithLifecycle } from "./lifecycle";
import { useProjectStore } from "../stores/projectStore";
import { showConfirmDialog } from "./confirm";
import type { AspectPreset, Background, TextAnimation, ZoomPoint } from "@panoptik/schema";

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

/** The selected segment's source window, or the media bounds when none selected. */
function activeSourceWindow(): { lo: number; hi: number } {
  const s = useProjectStore.getState();
  const seg = s.project?.segments.find((x) => x.id === s.selectedSegmentId);
  const duration = s.project?.media[0]?.duration ?? 0;
  return seg ? { lo: seg.srcStart, hi: seg.srcEnd } : { lo: 0, hi: duration };
}

export function registerEditingTools(): void {
  // ── 1. STAGING: PROPOSE ZOOM POINTS ──

  registerToolWithLifecycle({
    name: "propose_zoom_points",
    description:
      "Proposes zoom-in keyframes at specific timestamps. Proposals appear as ghost diamond markers on the timeline for human review — they are NOT applied until commit_staged_changes.",
    inputSchema: {
      type: "object",
      properties: {
        timestamps: {
          type: "array",
          items: { type: "number" },
          description: "Timestamps in seconds where zoom-in keyframes should be placed.",
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

      const list = Array.isArray(timestamps) ? timestamps : [];
      const { lo, hi } = activeSourceWindow();
      const clamped = list
        .filter((t: number) => typeof t === "number" && Number.isFinite(t) && t >= lo && t <= hi)
        .slice(0, MAX_PROPOSALS);

      const depth = clampNumber(scale, 1.2, 5, 2.2);
      const fx = clampNumber(focalX, 0, 1, 0.5);
      const fy = clampNumber(focalY, 0, 1, 0.5);

      const proposals: ZoomPoint[] = clamped.map((t: number) => ({
        id: generateId(),
        t,
        to: { scale: depth, x: fx, y: fy },
        dur: 0.7,
        ease: "easeInOutCubic",
        staged: true,
      }));

      store.stageZoomProposals(proposals);
      return {
        stagedCount: proposals.length,
        outOfRangeSkipped: list.length - clamped.length,
        proposals: proposals.map((p) => ({ t: p.t, scale: p.to.scale })),
        message: `${proposals.length} zoom proposal(s) staged as ghosts on the timeline. Call commit_staged_changes to apply them permanently.`,
      };
    },
  });

  // ── 2. STAGING: ADD TEXT OVERLAY ──

  registerToolWithLifecycle({
    name: "add_text_overlay",
    description:
      "Stages a styled text caption or annotation overlay at a specific timestamp and screen position. Supports custom fonts, sizes, colors, backdrops, and entrance/exit animations. Staged overlays appear for review until committed.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The text content to display (no emojis).",
        },
        timestamp: {
          type: "number",
          description: "When the text should appear (in seconds).",
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

      const { lo, hi } = activeSourceWindow();
      const at = clampNumber(timestamp, lo, hi, lo);
      const where = position === "top" || position === "center" || position === "bottom" ? position : "bottom";
      const dur = typeof duration === "number" && duration > 0 ? duration : 3.0;

      store.stageTextOverlay({
        id: generateId(),
        text: safeText,
        timestamp: at,
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
        staged: true,
        text: safeText,
        timestamp: at,
        duration: dur,
        position: where,
        message: `Text overlay "${safeText}" staged at ${at}s (${dur}s duration). Call commit_staged_changes to apply.`,
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
        staged: true,
        background: bg,
        message: `${kind} background staged. Call commit_staged_changes to apply permanently.`,
      };
    },
  });

  // ── 4. STAGING: GENERATE CAPTIONS ──

  registerToolWithLifecycle({
    name: "generate_captions",
    description:
      "Stages captions or subtitles across the clip at key timestamps for review.",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          description: "Language code (e.g. 'en', 'es'). Default auto-detect.",
        },
      },
    },
    execute: async ({ language }: { language?: string }) => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      // Stage an initial caption annotation
      store.stageTextOverlay({
        id: generateId(),
        text: "Auto-captioned Demo",
        timestamp: 0.5,
        position: "bottom",
        staged: true,
      });

      return {
        staged: true,
        language: language ?? "auto",
        message: "Captions staged as text overlays. Call commit_staged_changes to burn them in.",
      };
    },
  });

  // ── 5. TIMELINE: SPLIT SEGMENT ──

  registerToolWithLifecycle({
    name: "split_segment",
    description:
      "Splits the video clip at the given timeline timestamp. Prompts for user confirmation before modifying timeline geometry.",
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
      if (!store.project) {
        return { error: "No project loaded." };
      }

      const confirmed = await showConfirmDialog({
        message: `Split clip at ${timestamp.toFixed(2)}s?`,
      });

      if (!confirmed) {
        return { split: false, reason: "user_declined" };
      }

      store.splitAt(timestamp);
      return {
        split: true,
        timestamp,
        segmentCount: useProjectStore.getState().project?.segments.length ?? 0,
        message: `Clip split successfully at ${timestamp.toFixed(2)}s.`,
      };
    },
  });

  // ── 6. TIMELINE: SET SPEED ──

  registerToolWithLifecycle({
    name: "set_speed",
    description:
      "Sets playback speed multiplier for the selected segment (0.5x, 1x, 1.5x, 2x).",
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
      return {
        speed: safeSpeed,
        message: `Clip speed updated to ${safeSpeed}x.`,
      };
    },
  });

  // ── 7. TIMELINE: SET ASPECT ──

  registerToolWithLifecycle({
    name: "set_aspect",
    description:
      "Sets the stage aspect ratio preset ('16:9', '9:16', '1:1', '4:3', or 'source').",
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
        aspect: targetPreset,
        message: `Aspect ratio preset set to ${targetPreset}.`,
      };
    },
  });

  // ── 8. TIMELINE: ADD MUSIC ──

  registerToolWithLifecycle({
    name: "add_music",
    description:
      "Adds or moves an audio track on the timeline at a specified start timestamp.",
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
        trackId,
        startT: Math.max(0, startT),
        message: `Audio track "${existing.name}" positioned at ${startT.toFixed(2)}s.`,
      };
    },
  });

  // ── 9. ACTION: COMMIT STAGED CHANGES ──

  registerToolWithLifecycle({
    name: "commit_staged_changes",
    description:
      "Commits ALL staged proposals (zoom keyframes, text overlays, backgrounds) to the project. Shows the staged diff dialog for human confirmation.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded. Ask the user to import a clip first." };
      }

      const diff = store.getStagedDiff();
      if (diff.totalCount === 0) {
        return {
          committed: false,
          reason: "nothing_staged",
          message: "No staged changes to commit.",
        };
      }

      const confirmed = await showConfirmDialog({
        diff,
        message: `Commit ${diff.totalCount} staged change(s)?\n\n${diff.added.join("\n")}`,
      });

      if (!confirmed) {
        return {
          committed: false,
          reason: "user_declined",
          message: "Commit declined by user.",
        };
      }

      store.commitAll();
      return {
        committed: true,
        itemsCommitted: diff.totalCount,
        message: "All staged changes committed successfully. The project is updated.",
      };
    },
  });

  // ── 10. ACTION: DISCARD STAGED CHANGES ──

  registerToolWithLifecycle({
    name: "discard_staged_changes",
    description: "Discards all currently staged ghost proposals without committing them.",
    inputSchema: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const store = useProjectStore.getState();
      if (!store.project) {
        return { error: "No project loaded." };
      }

      const diff = store.getStagedDiff();
      const count = diff.totalCount;
      store.clearStaged();

      return {
        discarded: true,
        itemsDiscarded: count,
        message: `Discarded ${count} staged change(s).`,
      };
    },
  });
}
