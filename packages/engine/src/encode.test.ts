import { describe, expect, it, vi } from "vitest";
import { concatDurations, makeMock, sliceAndStretchAudio } from "./timeStretch";
import type { Project, Segment } from "@panoptik/schema";

// mediabunny pulls in WebCodecs at import time; the sizing math under test is pure.
vi.mock("mediabunny", () => ({
  BufferTarget: class {},
  CanvasSource: class {},
  AudioBufferSource: class {},
  Mp4OutputFormat: class {},
  WebMOutputFormat: class {},
  Output: class {},
  QUALITY_VERY_HIGH: "very-high",
  getFirstEncodableVideoCodec: vi.fn(),
  getFirstEncodableAudioCodec: vi.fn() }));

vi.mock("@mediabunny/aac-encoder", () => ({
  registerAacEncoder: vi.fn() }));

const { __test } = await import("./encode");

/** A v1.2 project whose single segment keeps the media's own aspect. */
const proj = (width: number, height: number): Project =>
  ({
    id: "p1",
    media: [{ id: "m1", src: "", duration: 10, width, height }],
    audioSrc: null,
    segments: [seg({ srcEnd: 10 })],
    clickLog: [] }) as Project;

function seg(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "s1",
    mediaId: "m1",
      srcStart: 0,
    srcEnd: 10,
    speed: 1,
    stagePadding: 0,
    aspectPreset: "source",
    background: { kind: "solid", color: "#000000" },
    facecam: { src: null, x: 0.8, y: 0.8, size: 0.2 },
    zoomPoints: [],
    stagedZoomPoints: [],
    textOverlays: [],
    stagedTextOverlays: [], ...overrides };
}

describe("export sizing", () => {
  it("scales to the requested height, keeping the clip's aspect", () => {
    expect(__test.exportSize(proj(1920, 1080), "720p")).toEqual({ width: 1280, height: 720 });
    expect(__test.exportSize(proj(1920, 1080), "1080p")).toEqual({ width: 1920, height: 1080 });
    expect(__test.exportSize(proj(1920, 1080), "4k")).toEqual({ width: 3840, height: 2160 });
  });

  it("keeps vertical clips vertical", () => {
    expect(__test.exportSize(proj(1080, 1920), "1080p")).toEqual({ width: 608, height: 1080 });
  });

  it("always yields even dimensions — encoders reject odd ones", () => {
    for (const [w, h] of [[1000, 563], [1333, 999], [777, 555]] as const) {
      for (const res of ["720p", "1080p", "4k"] as const) {
        const size = __test.exportSize(proj(w, h), res);
        expect(size.width % 2).toBe(0);
        expect(size.height % 2).toBe(0);
      }
    }
  });

  it("upscales a small source rather than refusing it", () => {
    expect(__test.exportSize(proj(640, 360), "1080p")).toEqual({ width: 1920, height: 1080 });
  });

  it("sizes the frame to the selected segment's aspect, not the first segment's", () => {
    const p = proj(1920, 1080);
    p.segments = [
      seg({ id: "wide", aspectPreset: "16:9" }),
      seg({ id: "tall", srcStart: 10, srcEnd: 20, aspectPreset: "9:16" }) ];
    // Preview sizes the canvas to the SELECTED segment — export must agree.
    expect(__test.exportSize(p, "1080p", "wide")).toEqual({ width: 1920, height: 1080 });
    expect(__test.exportSize(p, "1080p", "tall")).toEqual({ width: 608, height: 1080 });
    // With no selection, the first segment decides (preview's fallback too).
    expect(__test.exportSize(p, "1080p")).toEqual({ width: 1920, height: 1080 });
    // Unknown id also falls back to the first segment.
    expect(__test.exportSize(p, "1080p", "missing")).toEqual({ width: 1920, height: 1080 });
  });
});

describe("per-segment export", () => {
  it("time-stretches each segment to its own duration", () => {
    // WSOLA already tested; assert the audio concatenation helper we rely on:
    // the exported audio length is the sum of the per-segment stretched parts.
    const buffers = [makeMock(1000), makeMock(2000)];
    expect(concatDurations(buffers)).toBeCloseTo((1000 + 2000) / 48000, 3);
  });

  it("slices the source window and stretches it by the segment speed", () => {
    const src = makeMock(4800, 48000); // 0.1s of silence
    const out = sliceAndStretchAudio(src, seg({ srcStart: 0.025, srcEnd: 0.075, speed: 2 }));
    // (0.075 - 0.025)s of source at 2x → 0.025s on the timeline.
    expect(out.duration).toBeCloseTo(0.025, 2);
    expect(out.numberOfChannels).toBe(1);
    expect(out.sampleRate).toBe(48000);
  });
});

describe("export frame rate", () => {
  const { resolveExportFps } = __test;

  it("defaults to 30 when nothing is asked for", () => {
    // An export with no explicit choice must produce the file it always has.
    expect(resolveExportFps(undefined)).toBe(30);
  });

  it("honours each offered rate", () => {
    expect(resolveExportFps(24)).toBe(24);
    expect(resolveExportFps(30)).toBe(30);
    expect(resolveExportFps(60)).toBe(60);
  });

  it("falls back rather than trusting an arbitrary number", () => {
    // fps drives the frame loop and the encoder config; a nonsense value would
    // either stall the export or write an unplayable file.
    for (const bad of [0, -30, 1000, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveExportFps(bad)).toBe(30);
    }
  });

  it("a lower rate means proportionally fewer frames for the same clip", () => {
    // This is where the smaller file comes from: the loop steps by 1/fps, so
    // 24fps encodes four fifths of the frames 30fps does.
    const seconds = 10;
    const framesAt = (fps: number) => Math.max(1, Math.ceil(seconds * resolveExportFps(fps)));
    expect(framesAt(24)).toBe(240);
    expect(framesAt(30)).toBe(300);
    expect(framesAt(60)).toBe(600);
  });
});
