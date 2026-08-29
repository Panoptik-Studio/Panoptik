import { describe, expect, it } from "vitest";
import { audioBlockGeometry } from "./timelineAudioTracks";
import type { AudioTrack } from "@panoptik/schema";

const track = (startT: number, duration: number): AudioTrack => ({
  id: "t",
  kind: "music",
  src: "blob:x",
  duration,
  volume: 1,
  startT,
});

describe("audioBlockGeometry", () => {
  const timeToX = (t: number) => t * 100; // 100px/s

  it("maps startT/duration to a left+width box", () => {
    expect(audioBlockGeometry(track(2, 3), timeToX)).toEqual({ left: 200, width: 300 });
  });
  it("clamps tiny blocks to a 2px minimum", () => {
    expect(audioBlockGeometry(track(1, 0.001), timeToX).width).toBe(2);
  });
  it("zero-duration track still yields a positive width", () => {
    expect(audioBlockGeometry(track(5, 0), timeToX).width).toBeGreaterThanOrEqual(2);
  });
});
