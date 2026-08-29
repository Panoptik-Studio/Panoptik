/**
 * Hook to extract and cache video frame thumbnails across the timeline.
 * Samples frames at regular intervals using an offscreen HTMLVideoElement and draws them
 * to lightweight canvas tiles for instant, high-performance timeline filmstrip rendering.
 *
 * Multiclip: one cache per media id, keyed independently so segments cut from
 * different clips each show their own filmstrip — and one clip's extraction
 * never forces another's to re-run.
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Media, Project } from "@panoptik/schema";

export interface ThumbnailCache {
  getThumbnail: (mediaId: string, time: number) => HTMLCanvasElement | null;
  version: number;
}

/**
 * Calculates sampling interval in seconds based on clip duration.
 */
export function calculateSamplingInterval(dur: number): number {
  if (dur <= 0) return 1;
  if (dur <= 5) return 0.25;
  if (dur <= 20) return 0.5;
  if (dur <= 60) return 1;
  if (dur <= 180) return 2;
  return Math.max(2, dur / 60);
}

/**
 * Generates an array of target timestamps for thumbnail frame extraction.
 */
export function generateThumbnailTimestamps(dur: number): number[] {
  if (dur <= 0) return [];
  const interval = calculateSamplingInterval(dur);
  const timestamps: number[] = [];
  for (let t = 0; t <= dur; t += interval) {
    timestamps.push(Math.round(t * 100) / 100);
  }
  const last = Math.round(dur * 100) / 100;
  if (timestamps[timestamps.length - 1] !== last) {
    timestamps.push(last);
  }
  return timestamps;
}

/**
 * Finds the closest timestamp in a sorted array of timestamps.
 */
export function findClosestThumbnailTimestamp(
  times: number[],
  target: number,
): number | null {
  if (times.length === 0) return null;

  let low = 0;
  let high = times.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (times[mid] === target) {
      return times[mid]!;
    }
    if (times[mid]! < target) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const cand1 = times[Math.max(0, Math.min(times.length - 1, low))]!;
  const cand2 = times[Math.max(0, Math.min(times.length - 1, high))]!;

  return Math.abs(cand1 - target) <= Math.abs(cand2 - target) ? cand1 : cand2;
}

/** One media id's extracted thumbnails + its source identity. */
type MediaCache = {
  key: string;
  cache: Map<number, HTMLCanvasElement>;
  sorted: number[];
};

const mediaKey = (m: Media) => `${m.id}:${m.src}:${m.duration}`;

export function useTimelineThumbnails(project: Project | null): ThumbnailCache {
  const [version, setVersion] = useState(0);
  const cachesRef = useRef<Map<string, MediaCache>>(new Map());
  const abortsRef = useRef<Map<string, AbortController>>(new Map());

  // Re-run extraction only when the set/properties of media change — not on
  // every store write.
  const mediaSignature = (project?.media ?? []).map(mediaKey).join("|");

  useEffect(() => {
    const media = project?.media ?? [];

    // 1. Drop caches + kill in-flight extractions for media that vanished or
    //    changed (src/duration). Keyed by media id.
    for (const [id, entry] of cachesRef.current.entries()) {
      const m = media.find((x) => x.id === id);
      if (!m || mediaKey(m) !== entry.key) {
        abortsRef.current.get(id)?.abort();
        abortsRef.current.delete(id);
        cachesRef.current.delete(id);
      }
    }

    // 2. Start extraction for each media entry that has none in flight yet.
    for (const m of media) {
      if (!m.src || m.duration <= 0) continue;
      const key = mediaKey(m);
      if (abortsRef.current.has(m.id)) continue; // extraction in flight
      const existing = cachesRef.current.get(m.id);
      if (existing && existing.key === key && existing.cache.size > 0) continue;

      const abort = new AbortController();
      abortsRef.current.set(m.id, abort);
      const cache: MediaCache = existing && existing.key === key ? existing : { key, cache: new Map(), sorted: [] };
      if (!existing || existing.key !== key) cachesRef.current.set(m.id, cache);

      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = m.src;

      let destroyed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const bump = () => {
        if (timer || destroyed) return;
        timer = setTimeout(() => {
          timer = null;
          if (!destroyed) setVersion((v) => v + 1);
        }, 100);
      };

      const runExtraction = async () => {
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) {
            resolve();
            return;
          }
          const onLoaded = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            video.removeEventListener("loadedmetadata", onLoaded);
            video.removeEventListener("error", onError);
            resolve();
          };
          video.addEventListener("loadedmetadata", onLoaded);
          video.addEventListener("error", onError);
        });

        if (destroyed || abort.signal.aborted) return;

        const dur = m.duration;
        const aspect = (video.videoWidth && video.videoHeight)
          ? video.videoWidth / video.videoHeight
          : 16 / 9;

        const thumbHeight = 72;
        const thumbWidth = Math.max(36, Math.round(thumbHeight * aspect));
        const timestamps = generateThumbnailTimestamps(dur);

        for (const t of timestamps) {
          if (destroyed || abort.signal.aborted) break;

          await new Promise<void>((resolve) => {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;
            const onSeeked = () => {
              if (timeoutId) clearTimeout(timeoutId);
              video.removeEventListener("seeked", onSeeked);
              video.removeEventListener("error", onErr);
              resolve();
            };
            const onErr = () => {
              if (timeoutId) clearTimeout(timeoutId);
              video.removeEventListener("seeked", onSeeked);
              video.removeEventListener("error", onErr);
              resolve();
            };
            timeoutId = setTimeout(() => {
              video.removeEventListener("seeked", onSeeked);
              video.removeEventListener("error", onErr);
              resolve();
            }, 350);

            video.addEventListener("seeked", onSeeked, { once: true });
            video.addEventListener("error", onErr, { once: true });
            video.currentTime = Math.max(0, Math.min(dur, t));
          });

          if (destroyed || abort.signal.aborted) break;

          try {
            const canvas = document.createElement("canvas");
            canvas.width = thumbWidth;
            canvas.height = thumbHeight;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
              const entry = cachesRef.current.get(m.id);
              if (entry) {
                entry.cache.set(t, canvas);
                entry.sorted.push(t);
                entry.sorted.sort((a, b) => a - b);
                bump();
              }
            }
          } catch {
            // If canvas draw fails (e.g. tainted canvas or decode error), continue
          }
        }

        if (!destroyed && !abort.signal.aborted) {
          setVersion((v) => v + 1);
        }
      };

      runExtraction();
    }

    // No generic cleanup — the first loop already aborts/deletes vanished
    // media. Aborting all in-flight here would kill still-valid extractions
    // when appending a second clip (mediaSignature changes but m1 is still
    // wanted).
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature]);

  const getThumbnail = useCallback((mediaId: string, time: number): HTMLCanvasElement | null => {
    const entry = cachesRef.current.get(mediaId);
    if (!entry) return null;
    const closest = findClosestThumbnailTimestamp(entry.sorted, time);
    if (closest === null) return null;
    return entry.cache.get(closest) ?? null;
  }, []);

  return { getThumbnail, version };
}
