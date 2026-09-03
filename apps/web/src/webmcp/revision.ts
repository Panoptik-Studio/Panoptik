/**
 * Timeline revision counter for the WebMCP staleness contract.
 *
 * Every tool response carries `timelineRevision`. Tools that shift the timeline
 * (cuts, deletes, speed changes, splits) bump the counter; tools that report
 * timestamps echo the current one. The contract pushed to agents:
 *
 *   If the revision you observe differs from the revision your earlier
 *   observations were made at, every cached timestamp is stale — re-ingest
 *   via get_project_state + get_transcript before editing further.
 */

let timelineRevision = 1;

export function getTimelineRevision(): number {
  return timelineRevision;
}

/** Bump after a timeline-mutating tool applies its change; returns the new revision. */
export function bumpTimelineRevision(): number {
  timelineRevision += 1;
  return timelineRevision;
}

/** Shared agent-facing wording of the staleness contract. */
export const STALENESS_CONTRACT = [
  "Every response includes `timelineRevision`.",
  "Timestamps in every response are CURRENT TIMELINE seconds — valid only at the revision they were observed.",
  "When a tool response has `timelineShifted: true` (or a higher `timelineRevision` than your last observation), ALL previously observed timestamps (transcript, silences, clicks, scenes, zooms) are stale.",
  "After any shift, re-call get_project_state and get_transcript before proposing or staging further edits. Never reuse pre-shift timestamps.",
].join(" ");
