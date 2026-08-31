/**
 * 3-Tier cursor stream & interaction heatmap aggregation for Panoptik.
 * Calculates per-scene click counts, centroids, bounding boxes, and click bursts (>=3 clicks in <2s).
 * Handles Tier A (DOM stream), Tier B (sparse CV tracker), and Tier C (degraded fallback).
 */

import type { ClickEvent } from "@panoptik/schema";
import type { SceneFeature } from "./videoFeatures";

export interface ClickBurst {
  startT: number;
  endT: number;
  clickCount: number;
  centroid: { x: number; y: number };
}

export interface SceneInteractionSummary {
  sceneId: number;
  clicks: number;
  centroid: { x: number; y: number } | null;
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  bursts: ClickBurst[];
}

/**
 * Detects click bursts (>= 3 clicks within a 2.0s rolling window).
 */
export function detectClickBursts(clicks: ClickEvent[], windowSec = 2.0): ClickBurst[] {
  if (clicks.length < 3) return [];

  const sorted = [...clicks].sort((a, b) => a.t - b.t);
  const bursts: ClickBurst[] = [];
  let lastBurstEnd = -1;

  for (let i = 0; i <= sorted.length - 3; i++) {
    const current = sorted[i];
    if (!current) continue;
    const burstStart = current.t;
    if (burstStart < lastBurstEnd) continue;

    // Look ahead within windowSec
    const windowClicks: ClickEvent[] = [current];
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next && next.t - burstStart <= windowSec) {
        windowClicks.push(next);
      } else {
        break;
      }
    }

    if (windowClicks.length >= 3) {
      const last = windowClicks[windowClicks.length - 1];
      const burstEnd = last ? last.t : burstStart;
      let sumX = 0;
      let sumY = 0;
      for (const c of windowClicks) {
        sumX += c.x;
        sumY += c.y;
      }
      const centroid = {
        x: Number((sumX / windowClicks.length).toFixed(3)),
        y: Number((sumY / windowClicks.length).toFixed(3)),
      };

      bursts.push({
        startT: Number(burstStart.toFixed(2)),
        endT: Number(burstEnd.toFixed(2)),
        clickCount: windowClicks.length,
        centroid,
      });

      lastBurstEnd = burstEnd;
    }
  }

  return bursts;
}

/**
 * Aggregates click events across scenes.
 * Handles Tier A (DOM stream), Tier B (sparse CV), and Tier C (empty clicks degraded mode).
 */
export function aggregateSceneInteractions(
  scenes: SceneFeature[],
  clickLog?: ClickEvent[] | null,
): SceneInteractionSummary[] {
  const clicks = clickLog ?? [];

  return scenes.map((scene) => {
    // Find clicks falling within this scene window [t0, t1]
    const sceneClicks = clicks.filter(
      (c) => c.t >= scene.t0 && c.t <= scene.t1,
    );

    if (sceneClicks.length === 0) {
      return {
        sceneId: scene.id,
        clicks: 0,
        centroid: null,
        boundingBox: null,
        bursts: [],
      };
    }

    let sumX = 0;
    let sumY = 0;
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (const c of sceneClicks) {
      sumX += c.x;
      sumY += c.y;
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
    }

    const centroid = {
      x: Number((sumX / sceneClicks.length).toFixed(3)),
      y: Number((sumY / sceneClicks.length).toFixed(3)),
    };

    const boundingBox = {
      minX: Number(minX.toFixed(3)),
      minY: Number(minY.toFixed(3)),
      maxX: Number(maxX.toFixed(3)),
      maxY: Number(maxY.toFixed(3)),
    };

    const bursts = detectClickBursts(sceneClicks);

    return {
      sceneId: scene.id,
      clicks: sceneClicks.length,
      centroid,
      boundingBox,
      bursts,
    };
  });
}
