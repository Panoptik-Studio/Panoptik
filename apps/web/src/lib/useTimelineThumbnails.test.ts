import { describe, it, expect } from "vitest";
import {
  calculateSamplingInterval,
  generateThumbnailTimestamps,
  findClosestThumbnailTimestamp,
} from "./useTimelineThumbnails";

describe("useTimelineThumbnails helpers", () => {
  describe("calculateSamplingInterval", () => {
    it("returns 1s for zero or negative duration", () => {
      expect(calculateSamplingInterval(0)).toBe(1);
      expect(calculateSamplingInterval(-5)).toBe(1);
    });

    it("returns 0.25s for short clips (<= 5s)", () => {
      expect(calculateSamplingInterval(3)).toBe(0.25);
      expect(calculateSamplingInterval(5)).toBe(0.25);
    });

    it("returns 0.5s for clips between 5s and 20s", () => {
      expect(calculateSamplingInterval(10)).toBe(0.5);
      expect(calculateSamplingInterval(20)).toBe(0.5);
    });

    it("returns 1s for clips between 20s and 60s", () => {
      expect(calculateSamplingInterval(30)).toBe(1);
      expect(calculateSamplingInterval(60)).toBe(1);
    });

    it("returns 2s for clips between 60s and 180s", () => {
      expect(calculateSamplingInterval(120)).toBe(2);
    });

    it("scales appropriately for very long clips (> 180s)", () => {
      expect(calculateSamplingInterval(300)).toBe(5);
    });
  });

  describe("generateThumbnailTimestamps", () => {
    it("returns empty array for zero or negative duration", () => {
      expect(generateThumbnailTimestamps(0)).toEqual([]);
      expect(generateThumbnailTimestamps(-10)).toEqual([]);
    });

    it("generates timestamps with correct intervals and bounds", () => {
      const timestamps = generateThumbnailTimestamps(1);
      expect(timestamps[0]).toBe(0);
      expect(timestamps[timestamps.length - 1]).toBe(1);
      expect(timestamps).toEqual([0, 0.25, 0.5, 0.75, 1]);
    });
  });

  describe("findClosestThumbnailTimestamp", () => {
    it("returns null when times array is empty", () => {
      expect(findClosestThumbnailTimestamp([], 5)).toBeNull();
    });

    it("finds exact match", () => {
      const times = [0, 0.5, 1.0, 1.5, 2.0];
      expect(findClosestThumbnailTimestamp(times, 1.0)).toBe(1.0);
    });

    it("finds closest lower timestamp", () => {
      const times = [0, 0.5, 1.0, 1.5, 2.0];
      expect(findClosestThumbnailTimestamp(times, 1.1)).toBe(1.0);
    });

    it("finds closest upper timestamp", () => {
      const times = [0, 0.5, 1.0, 1.5, 2.0];
      expect(findClosestThumbnailTimestamp(times, 1.4)).toBe(1.5);
    });

    it("clamps at boundaries", () => {
      const times = [1.0, 2.0, 3.0];
      expect(findClosestThumbnailTimestamp(times, 0.2)).toBe(1.0);
      expect(findClosestThumbnailTimestamp(times, 5.0)).toBe(3.0);
    });
  });
});
