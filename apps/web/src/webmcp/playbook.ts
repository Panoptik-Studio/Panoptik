/**
 * The AI Director playbook pushed to agents through tool responses.
 * Single source of truth — embedded in get_project_state, get_video_summary
 * and get_director_guidelines so the agent always sees current rules.
 */

import { STALENESS_CONTRACT } from "./revision";

export const DIRECTOR_RULES: string[] = [
  "NO EMOJIS: Do NOT use emojis in titles, badges, or overlays. Use clean typographic hierarchy (e.g. FEATURE:, ARCHITECTURE:, SECTION:).",
  "MULTI-STAGE PANS: When tracking longitudinal content or reading down comments, create sequential focal transitions (Stage 1 cy=0.45, Stage 2 cy=0.68 at 1.6x-1.8x) rather than a single static zoom that clips the bottom.",
  "PARKED CURSOR HEURISTIC: If cursor was stationary >3s, it is parked. Verify active target via probe_frames 3x3 grid snapshots before anchoring a zoom on it.",
  STALENESS_CONTRACT,
  "SAFE VIEWPORT FORMULA: Visible vertical height is 1/scale (e.g. 1.8x scale shows 55.5% vertical height from cy-0.277 to cy+0.277). Keep content within [0.05, 0.95].",
  "OVERLAY INVERSION: If an active zoom targets the top half (cy <= 0.45), place overlays at pos: 'bottom' (and vice versa).",
  "FACECAM KEEPOUT: Check actualCamCorner ('br') to prevent zoom centers and overlays from colliding with facecam.",
  "SILENCE & SETTINGS KEEPOUT: Do not zoom into incidental settings adjustments (gear icons, volume, tabs) or silent pauses unless they are the subject of the video.",
  "CUT CONTRACT: A {op:'cut'} needs an explicit window {op:'cut', t0, t1} (prefer intervals from get_silence_intervals) or dropSilence:true with a matching silence. A cut that matches nothing is REJECTED in rejectedOps — fix and re-propose it; never claim dead air was removed unless cutsApplied.count > 0. Include the LEADING silence (before the first phrase) and the TRAILING silence (after the last one) — starts and ends must be tight too.",
  "BACKDROP NEEDS PADDING: A background is invisible while the aspect is 'source' (the frame fills the whole canvas). Applying {op:'bg'} via propose_edits automatically switches the aspect to 16:9 so the stage padding and backdrop actually render.",
  "ZOOM FRAMING IS DETERMINISTIC: If you omit cx/cy, the focal point is grounded from cursor attention inside the zoom window (parked corner positions are filtered out). When the cursor shows vertical traversal taller than one viewport (y-span × scale > 0.85), the zoom is AUTO-SPLIT into a sequential top→bottom pan — do not fight it with one static zoom.",
  "STAGE BASELINE IS AUTOMATIC: Every propose_edits batch applies the signature stage look — gradient backdrop (#0f172a to #1e293b), 28px stage padding, 16px rounded frame corners, 16:9 stage — unless the batch carries its own {op:'bg'}. Never describe the backdrop as optional or skip it; it is always on.",
  "ZOOMS PERSIST: Zoom windows are extended automatically until the next scene boundary or a sustained cursor move to a different region (minimum 4s hold). Propose zooms at the moments that matter and let the tool manage the hold — do not add extra zooms just to lengthen coverage.",
  "CAPTION PRESERVATION: In propose_edits mode 'replace', Whisper captions (kind 'caption') are never deleted — only agent-proposed graphic overlays are replaced.",
];

export const AUTONOMOUS_DECISION_TREE = {
  trigger:
    "Vague requests like 'edit this video', 'make it polished', 'edit the reaction video'. Decide autonomously and run the full pipeline; do not ask the user which steps to run.",
  steps: [
    "1. UNDERSTAND: get_video_summary (or get_project_state) — duration, scenes, transcript status, facecam corner, silences.",
    "2. SPEECH: If the transcript is missing or empty, call generate_captions FIRST — cuts, zooms and captions all depend on speech timestamps.",
    "3. TIGHTEN: get_silence_intervals (minDurationSec 1.2). Dead air >= 1.5s becomes a cut op in ONE propose_edits call — pass the explicit window {op:'cut', t0:<interval.start>, t1:<interval.end>} (deterministic), or {op:'cut', t:<midpoint>, dropSilence:true}. Include the LEADING interval (before the first phrase) and the TRAILING interval (after the last). Rejected cuts are returned in rejectedOps: fix and re-propose, never assume they succeeded. Skip breaths < 1.0s.",
    "4. EMPHASIZE: get_click_log (attention buckets) + probe_frames at scene keyframe times. Add zoom ops (1.6x-1.8x for text/comments, 2.0x-2.5x for compact UI) anchored to click clusters, vocal emphasis peaks (available after generate_captions via get_video_summary/transcript timing), or probe_frames-verified targets.",
    "5. NARRATE: 1-3 text overlays via {op:'text'} — a hook title in the first 5s (3.5s, top), section markers on topic shifts. NO emojis. Skip if captions already carry the story.",
    "6. POLISH: the stage baseline (gradient backdrop, padding, rounded corners) applies automatically; pass {op:'bg'} only to override the palette. {op:'cam'} keeps the facecam clear of zoom targets; gentle 'fade' transitions between chapters.",
    "7. SHIP: ONE propose_edits call with ALL ops (mode 'replace' for a fresh edit), then commit_staged_changes, then offer export_clip({format:'mp4', resolution:'1080p'}).",
  ],
  humanInLoopDisclaimers: [
    "commit_staged_changes and export_clip surface a human confirmation dialog — the response, not your intention, is the source of truth. Handle 'user_declined' gracefully and ask what to adjust.",
    "Report honestly what was applied vs rejected: check rejectedOps and cutsApplied in the propose_edits response; never claim success for rejected ops.",
  ],
};

export const STANDARD_PROTOCOL: string[] = [
  "1. get_project_state & get_transcript (Ingest timeline state & speech)",
  "2. generate_captions if transcript missing",
  "3. probe_frames (Sample 3x3 grid frames at target timestamps to ground visual coordinates)",
  "4. get_click_log (Inspect human click telemetry for active cursor grounding)",
  "5. propose_edits (Stage batched atomic edits with cuts, zooms, text overlays, speed)",
  "6. inspect_timeline (Verify staged diff on rebased timeline)",
  "7. commit_staged_changes (Bake approved edits into timeline)",
];

export function directorPlaybookBlock() {
  return {
    coreRules: DIRECTOR_RULES,
    standardProtocol: STANDARD_PROTOCOL,
    autonomousDecisionTree: AUTONOMOUS_DECISION_TREE,
  };
}
