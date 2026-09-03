import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "../src/index";

describe("Cloudflare Worker AI Gateway", () => {
  const createMockToken = (tier: "free" | "pro", quota = 180, expired = false) => {
    const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = btoa(
      JSON.stringify({
        sub: "user_123",
        tier,
        quotaLimitMinutes: quota,
        exp: expired ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 86400,
      }),
    );
    return `${header}.${payload}.signature`;
  };

  it("handles health check", async () => {
    const req = new Request("https://proxy.panoptik.app/health");
    const res = await handleRequest(req, {});
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe("healthy");
  });

  it("allows anonymous free transcription with no token or BYOK key", async () => {
    const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
      method: "POST",
      body: new Blob([new Uint8Array(100)]),
    });
    const res = await handleRequest(req, {});
    expect(res.status).toBe(200);
  });

  it("accepts valid JWT token and transcribes audio", async () => {
    const token = createMockToken("pro", 180);
    const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: new Blob([new Uint8Array(100)]),
    });

    const kvStore: Record<string, string> = {};
    const mockEnv: Env = {
      KV: {
        get: async (k) => kvStore[k] ?? null,
        put: async (k, v) => {
          kvStore[k] = v;
        },
      },
    };

    const res = await handleRequest(req, mockEnv);
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.words.length).toBeGreaterThan(0);

    // Verify KV post-increment
    const monthKey = `usage:user_123:${new Date().toISOString().slice(0, 7)}`;
    expect(kvStore[monthKey]).toBeDefined();
  });

  it("enforces monthly transcription quota", async () => {
    const token = createMockToken("pro", 60); // 60 min limit
    const monthKey = `usage:user_123:${new Date().toISOString().slice(0, 7)}`;

    const kvStore: Record<string, string> = {
      [monthKey]: "60.5", // Already exceeded
    };

    const mockEnv: Env = {
      KV: {
        get: async (k) => kvStore[k] ?? null,
        put: async (k, v) => {
          kvStore[k] = v;
        },
      },
    };

    const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: new Blob([new Uint8Array(100)]),
    });

    const res = await handleRequest(req, mockEnv);
    expect(res.status).toBe(429);
    const data = await res.json() as any;
    expect(data.error).toBe("QUOTA_EXCEEDED");
  });

  it("blocks revoked users", async () => {
    const token = createMockToken("pro", 180);
    const kvStore: Record<string, string> = {
      "revoked:user_123": "true",
    };

    const mockEnv: Env = {
      KV: {
        get: async (k) => kvStore[k] ?? null,
        put: async (k, v) => {
          kvStore[k] = v;
        },
      },
    };

    const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: new Blob([new Uint8Array(100)]),
    });

    const res = await handleRequest(req, mockEnv);
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error).toBe("REVOKED");
  });

  describe("Groq word timestamps (regression: missing timestamp_granularities)", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("requests word-level timestamps from Groq so verbose_json includes words", async () => {
      let capturedBody: any = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: any, init: any) => {
        capturedBody = init?.body;
        return {
          ok: true,
          json: async () => ({
            duration: 22,
            words: [{ word: " Hello ", start: 1.4, end: 1.6 }],
            segments: [{ text: "Hello", start: 1.4, end: 1.6 }],
          }),
        };
      }) as any;

      const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
        method: "POST",
        body: new Blob([new Uint8Array(100)]),
      });
      const res = await handleRequest(req, { GROQ_API_KEY: "gsk-test" });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.words).toHaveLength(1);
      expect(data.words[0].word).toBe("Hello");
      // Without this param Groq omits `words` from verbose_json -> empty captions.
      expect(capturedBody).toBeInstanceOf(FormData);
      expect((capturedBody as FormData).getAll("timestamp_granularities[]")).toContain("word");
    });

    it("falls back to segments when Groq omits word timestamps", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          duration: 2,
          segments: [{ text: "Hello world", start: 0, end: 2 }],
        }),
      }) as any;

      const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
        method: "POST",
        body: new Blob([new Uint8Array(100)]),
      });
      const res = await handleRequest(req, { GROQ_API_KEY: "gsk-test" });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.words.length).toBeGreaterThan(0);
      expect(data.words[0].word).toBe("Hello");
    });
  });
});
