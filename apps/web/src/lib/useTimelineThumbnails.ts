/**
 * Hook to extract and cache video frame thumbnails across the timeline.
 * Samples frames at regular intervals using an offscreen HTMLVideoElement and draws them
 * to lightweight canvas tiles for instant, high-performance timeline filmstrip rendering.
 */
"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface ThumbnailCache {
  getThumbnail: (time: number) => HTMLCanvasElement | null;
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

export function useTimelineThumbnails(
  mediaSrc: string | undefined | null,
  duration: number | undefined | null,
): ThumbnailCache {
  const [version, setVersion] = useState(0);
  const cacheRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const sortedTimesRef = useRef<number[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastSrcRef = useRef<string | null>(null);
  const lastDurationRef = useRef<number | null>(null);

  useEffect(() => {
    // If media source and duration haven't changed and cache is populated, preserve thumbnails
    if (
      mediaSrc === lastSrcRef.current &&
      duration === lastDurationRef.current &&
      cacheRef.current.size > 0
    ) {
      return;
    }

    lastSrcRef.current = mediaSrc ?? null;
    lastDurationRef.current = duration ?? null;

    // Clear previous thumbnails when media source changes
    cacheRef.current.clear();
    sortedTimesRef.current = [];
    setVersion((v) => v + 1);

    if (!mediaSrc || !duration || duration <= 0 || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const abort = new AbortController();
    abortControllerRef.current = abort;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = mediaSrc;

    let isDestroyed = false;
    let updateTimer: NodeJS.Timeout | null = null;

    const scheduleVersionBump = () => {
      if (updateTimer || isDestroyed) return;
      updateTimer = setTimeout(() => {
        updateTimer = null;
        if (!isDestroyed) {
          setVersion((v) => v + 1);
        }
      }, 100);
    };

    const cleanup = () => {
      isDestroyed = true;
      if (updateTimer) clearTimeout(updateTimer);
      abort.abort();
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const runExtraction = async () => {
      // Wait for video metadata to read dimensions & duration
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

      if (isDestroyed || abort.signal.aborted) return;

      const dur = duration;
      const aspect = (video.videoWidth && video.videoHeight)
        ? video.videoWidth / video.videoHeight
        : 16 / 9;

      const thumbHeight = 72;
      const thumbWidth = Math.max(36, Math.round(thumbHeight * aspect));

      const timestamps = generateThumbnailTimestamps(dur);

      for (const t of timestamps) {
        if (isDestroyed || abort.signal.aborted) break;

        await new Promise<void>((resolve) => {
          let timeoutId: NodeJS.Timeout | null = null;
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

        if (isDestroyed || abort.signal.aborted) break;

        try {
          const canvas = document.createElement("canvas");
          canvas.width = thumbWidth;
          canvas.height = thumbHeight;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight);
            cacheRef.current.set(t, canvas);
            sortedTimesRef.current.push(t);
            sortedTimesRef.current.sort((a, b) => a - b);
            scheduleVersionBump();
          }
        } catch {
          // If canvas draw fails (e.g. tainted canvas or decode error), continue
        }
      }

      // Final version bump when extraction completes
      if (!isDestroyed && !abort.signal.aborted) {
        setVersion((v) => v + 1);
      }
    };

    runExtraction();

    return cleanup;
  }, [mediaSrc, duration]);

  const getThumbnail = useCallback((time: number): HTMLCanvasElement | null => {
    const times = sortedTimesRef.current;
    const closest = findClosestThumbnailTimestamp(times, time);
    if (closest === null) return null;
    return cacheRef.current.get(closest) ?? null;
  }, []);

  return { getThumbnail, version };
}
