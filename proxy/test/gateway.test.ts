import { describe, expect, it } from "vitest";
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

  it("rejects unauthorized requests with no token or BYOK key", async () => {
    const req = new Request("https://proxy.panoptik.app/v1/ai/transcribe", {
      method: "POST",
      body: new Blob([new Uint8Array(100)]),
    });
    const res = await handleRequest(req, {});
    expect(res.status).toBe(401);
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
});
