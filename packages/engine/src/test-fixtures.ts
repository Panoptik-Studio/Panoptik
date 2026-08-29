/**
 * OWNER: DEV A — shared fixture. Imported by BOTH devs' tests/mocks.
 */
import type { Project } from "@panoptik/schema";

export function mockProject(): Project {
  return {
    id: "test",
    media: [{ id: "m1", src: "", duration: 15, width: 1920, height: 1080 }],
    audioSrc: null,
    segments: [
      {
        id: "s1",
        mediaId: "m1",
        srcStart: 0,
        srcEnd: 15,
        speed: 1,
        stagePadding: 0,
        aspectPreset: "16:9",
        background: { kind: "gradient", stops: ["#6366f1", "#a855f7"] },
        facecam: { src: null, x: 0.8, y: 0.8, size: 0.2, shape: "circle" },
        zoomPoints: [
          { id: "z1", t: 3, to: { scale: 2.2, x: 0.5, y: 0.5 }, dur: 0.7, ease: "easeInOutCubic", staged: false },
          { id: "z2", t: 6, to: { scale: 1, x: 0.5, y: 0.5 }, dur: 0.6, ease: "easeInOutCubic", staged: false },
        ],
        stagedZoomPoints: [],
        textOverlays: [{ id: "t1", text: "Sign in", timestamp: 3, position: "top", staged: false }],
        stagedTextOverlays: [{ id: "t2", text: "agent pending", timestamp: 8, position: "bottom", staged: true }],
        captions: [{ text: "Welcome to the demo", start: 0, end: 2 }],
        stagedCaptions: [],
      },
    ],
    clickLog: [{ t: 3.1, x: 0.5, y: 0.5, type: "click" }],
  };
}

export function mockProjectWithStaged(): Project {
  const p = mockProject();
  p.segments[0]!.stagedZoomPoints = [
    { id: "g1", t: 9, to: { scale: 2.5, x: 0.3, y: 0.3 }, dur: 0.7, ease: "easeInOutCubic", staged: true },
  ];
  return p;
}
