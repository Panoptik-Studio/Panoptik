/**
 * Compact semantic digest serializer for Panoptik.
 * Formats multi-modal deterministic feature extractions into a lean dataframe
 * (~6,200 tokens for 10-min clip) for single-turn LLM reasoning.
 */

import type { Project } from "@panoptik/schema";
import type { FullMediaAnalysis } from "./cache";
import { formatPackedPhraseLine } from "./transcriptPacking";

export type CompactSceneRow = [
  id: number,
  t0: number,
  t1: number,
  motionCategory: "static" | "medium" | "high",
  paletteIndex: number, // 0..15
  clicks: number,
  loudPeaks: number,
  bestCamCorner: "tl" | "tr" | "bl" | "br",
];

export interface VideoDigest {
  project: {
    id: string;
    duration: number;
    hasFacecam: boolean;
    actualCamCorner: "tl" | "tr" | "bl" | "br" | "none";
    hasMic: boolean;
    hasScreenAudio: boolean;
    hasMusic: boolean;
    silenceCount: number;
    deadAirSeconds: number;
  };
  scenes: CompactSceneRow[];
  silences: Array<[start: number, end: number, dur: number]>;
  transcript: string;
  tokenEstimate: number;
}

/**
 * Serializes a FullMediaAnalysis and Project into the ultra-compact VideoDigest format.
 */
export function generateVideoDigest(
  project: Project,
  analysis: FullMediaAnalysis,
): VideoDigest {
  const duration = Number(analysis.duration.toFixed(1));

  // Determine track presence
  const hasFacecam = project.segments.some((s) => Boolean(s.facecam?.src));
  const fc = project.segments[0]?.facecam;
  let actualCamCorner: "tl" | "tr" | "bl" | "br" | "none" = "none";
  if (hasFacecam && fc) {
    const isLeft = (fc.x ?? 0.8) < 0.5;
    const isTop = (fc.y ?? 0.8) < 0.5;
    actualCamCorner = `${isTop ? "t" : "b"}${isLeft ? "l" : "r"}` as "tl" | "tr" | "bl" | "br";
  }

  const hasMic = Boolean(
    project.audioSrc ||
    hasFacecam ||
    project.audioTracks?.some((t) => t.id === "mic" || t.kind === "voiceover")
  );
  const hasScreenAudio = Boolean(project.media?.[0]?.src || project.segments.some((s) => s.audioVolume !== 0));
  const hasMusic = Boolean(project.audioTracks?.some((t) => t.id === "music" || t.id.startsWith("music-")));

  // Calculate dead-air stats
  const silences = analysis.audio.silences.map(
    (s) => [s.start, s.end, s.duration] as [number, number, number],
  );
  const deadAirSeconds = Number(
    silences.reduce((sum, s) => sum + s[2], 0).toFixed(1),
  );

  // Build Scene DataFrame
  const sceneRows: CompactSceneRow[] = analysis.scenes.map((scene) => {
    const interaction = analysis.interactions.find(
      (i) => i.sceneId === scene.id,
    );
    const clicks = interaction ? interaction.clicks : 0;

    const peaksInScene = analysis.audio.loudPeaks.filter(
      (p) => p.t >= scene.t0 && p.t <= scene.t1,
    ).length;

    return [
      scene.id,
      scene.t0,
      scene.t1,
      scene.motionCategory,
      scene.paletteIndex,
      clicks,
      peaksInScene,
      scene.camCorner,
    ];
  });

  // Build Packed Transcript Text Block
  const transcriptLines = analysis.phrases.map(formatPackedPhraseLine);
  const transcript = transcriptLines.join("\n");

  // Token estimate: JSON metadata (~12 tok/scene) + transcript (~20 tok/phrase)
  const jsonTokenEstimate = Math.ceil(
    (JSON.stringify({ project: { id: project.id, duration }, scenes: sceneRows, silences }).length) / 3.8,
  );
  const transcriptTokenEstimate = Math.ceil(transcript.length / 3.8);
  const tokenEstimate = jsonTokenEstimate + transcriptTokenEstimate;

  return {
    project: {
      id: project.id,
      duration,
      hasFacecam,
      actualCamCorner,
      hasMic,
      hasScreenAudio,
      hasMusic,
      silenceCount: silences.length,
      deadAirSeconds,
    },
    scenes: sceneRows,
    silences,
    transcript,
    tokenEstimate,
  };
}
