import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, setSessionToken } from "./authClient";
import { runAutoDirector, transcribeAudioStream } from "./providers";
import type { VideoDigest } from "@panoptik/engine";

describe("providers adapter", () => {
  beforeEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("blocks cloud calls when airGappedMode is true", async () => {
    await expect(
      transcribeAudioStream(new Blob([]), { airGappedMode: true }),
    ).rejects.toThrow("Air-gapped mode active");

    await expect(
      runAutoDirector({} as any, undefined, { airGappedMode: true }),
    ).rejects.toThrow("Air-gapped mode active");
  });

  it("fails when no session token or BYOK key is provided", async () => {
    await expect(
      transcribeAudioStream(new Blob([]), {}),
    ).rejects.toThrow("No active Panoptik Pro session or BYOK API key");
  });

  it("executes transcription using in-memory Pro session token", async () => {
    const mockToken = "header.eyJzdWIiOiJ1c2VyXzEiLCJ0aWVyIjoicHJvIn0.sig";
    setSessionToken(mockToken);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        duration: 10.0,
        words: [{ word: "Hello", start: 0, end: 0.5, speaker: 0 }],
      }),
    } as any);

    const res = await transcribeAudioStream(new Blob(["audio"]), { proxyUrl: "https://test-proxy.com" });
    expect(res.words).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://test-proxy.com/v1/ai/transcribe",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${mockToken}` }),
      }),
    );
  });

  it("executes auto-director with BYOK key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        plan: "Staged zoom",
        ops: [{ op: "zoom", t0: 0, t1: 5 }],
      }),
    } as any);

    const mockDigest: VideoDigest = {
      project: { id: "p1", duration: 10, hasFacecam: false, hasMic: true, hasMusic: false, silenceCount: 0, deadAirSeconds: 0 },
      scenes: [],
      silences: [],
      transcript: "Hello world",
      tokenEstimate: 50,
    };

    const res = await runAutoDirector(mockDigest, "Add zoom", {
      proxyUrl: "https://test-proxy.com",
      byokKeys: { anthropic: "sk-ant-test" },
    });

    expect(res.ops).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://test-proxy.com/v1/ai/direct",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-panoptik-byok-key": "sk-ant-test" }),
      }),
    );
  });
});
