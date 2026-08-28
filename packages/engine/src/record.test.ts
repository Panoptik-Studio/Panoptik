import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The recorders must not run during acquisition.
 *
 * The picker, the permission prompts and the caller's 3-2-1 countdown all
 * happen between "user pressed record" and "user starts performing". Encoding
 * across that window put several seconds of dead footage at the head of every
 * take, which is what the startup lag actually was.
 */

// The WebCodecs screen path needs real encoders; force the MediaRecorder path.
vi.mock("mediabunny", () => ({
  Output: class {
    addVideoTrack() {}
    start() {
      return Promise.resolve();
    }
  },
  WebMOutputFormat: class {},
  BufferTarget: class {},
  MediaStreamVideoTrackSource: class {
    constructor() {
      throw new Error("no hardware encoder in this environment");
    }
  },
  getFirstEncodableVideoCodec: () => Promise.resolve(null),
}));

class FakeTrack {
  kind: string;
  readyState = "live";
  enabled = true;
  constructor(kind: string) {
    this.kind = kind;
  }
  getSettings() {
    return { width: 1280, height: 720, displaySurface: "window" };
  }
  stop() {
    this.readyState = "ended";
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeStream {
  private tracks: FakeTrack[];
  // Real MediaStream takes no args, or an array of tracks. The tests also
  // construct it from a list of kinds for convenience.
  constructor(init: (string | FakeTrack)[] = []) {
    this.tracks = init.map((k) => (typeof k === "string" ? new FakeTrack(k) : k));
  }
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
}

/** Every recorder built during a test, so the test can inspect their state. */
const recorders: FakeRecorder[] = [];

class FakeRecorder {
  state = "inactive";
  mimeType = "video/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  startCount = 0;
  constructor() {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
    this.startCount++;
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["x"]) });
    this.onstop?.();
  }
  addEventListener(type: string, cb: () => void) {
    if (type === "stop") this.onstop = cb;
  }
  removeEventListener() {}
  static isTypeSupported() {
    return true;
  }
}

beforeEach(() => {
  recorders.length = 0;
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", FakeStream);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getDisplayMedia: () => Promise.resolve(new FakeStream(["video"])),
      getUserMedia: () => Promise.resolve(new FakeStream(["video", "audio"])),
      enumerateDevices: () => Promise.resolve([]),
    },
  });
  // waitForFirstFrame builds a hidden <video>; without rVFC it waits on
  // loadeddata, and play() rejecting is treated as "give up and continue".
  vi.stubGlobal("document", {
    createElement: () => ({
      style: {},
      muted: false,
      playsInline: false,
      srcObject: null,
      addEventListener: (_t: string, cb: () => void) => setTimeout(cb, 0),
      removeEventListener: () => {},
      play: () => Promise.reject(new Error("no autoplay in test")),
      remove: () => {},
    }),
    body: { appendChild: () => {} },
  });
});

describe("startRecording", () => {
  it("acquires the streams without starting any recorder", async () => {
    const { startRecording } = await import("./record");
    const handles = await startRecording({
      layout: "screenAndCamera",
      shape: "circle",
      cameraEnabled: true,
      microphoneEnabled: true,
    });

    // Streams are live — the picker is done, so the countdown can run.
    expect(handles.screenStream.getTracks().length).toBeGreaterThan(0);
    // ...but nothing is being written yet.
    expect(recorders.length).toBeGreaterThan(0);
    expect(recorders.every((r) => r.state === "inactive")).toBe(true);
    expect(recorders.every((r) => r.startCount === 0)).toBe(true);
  });

  it("starts every recorder only once begin() is called", async () => {
    const { startRecording } = await import("./record");
    const handles = await startRecording({
      layout: "screenAndCamera",
      shape: "circle",
      cameraEnabled: true,
      microphoneEnabled: true,
    });

    await handles.begin();

    expect(recorders.every((r) => r.state === "recording")).toBe(true);
    expect(recorders.every((r) => r.startCount === 1)).toBe(true);
  });

  it("does not restart a recorder if begin() is called twice", async () => {
    const { startRecording } = await import("./record");
    const handles = await startRecording({
      layout: "screenOnly",
      shape: "circle",
      cameraEnabled: false,
      microphoneEnabled: false,
    });

    await handles.begin();
    await handles.begin();

    expect(recorders.every((r) => r.startCount === 1)).toBe(true);
  });
});
