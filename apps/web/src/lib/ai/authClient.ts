/**
 * In-memory client authentication manager for Panoptik AI Proxy.
 * Stores ephemeral 24-hour signed JWT in a private closure (never in localStorage
 * or exported project snapshots) to prevent token leakage.
 */

export interface SessionInfo {
  token: string;
  tier: "free" | "pro";
  userId: string;
  quotaLimitMinutes: number;
  expiresAt: number;
}

let inMemorySession: SessionInfo | null = null;

export function setSessionToken(token: string): void {
  try {
    const parts = token.split(".");
    if (parts.length === 3 && parts[1]) {
      const payload = JSON.parse(atob(parts[1]));
      inMemorySession = {
        token,
        tier: payload.tier || "pro",
        userId: payload.sub || "user",
        quotaLimitMinutes: payload.quotaLimitMinutes || 180,
        expiresAt: payload.exp ? payload.exp * 1000 : Date.now() + 24 * 3600 * 1000,
      };
      return;
    }
  } catch {
    // fallback
  }

  inMemorySession = {
    token,
    tier: "pro",
    userId: "user",
    quotaLimitMinutes: 180,
    expiresAt: Date.now() + 24 * 3600 * 1000,
  };
}

export function getSessionToken(): string | null {
  if (!inMemorySession) return null;
  if (Date.now() > inMemorySession.expiresAt) {
    inMemorySession = null;
    return null;
  }
  return inMemorySession.token;
}

export function getSessionInfo(): SessionInfo | null {
  if (!inMemorySession) return null;
  if (Date.now() > inMemorySession.expiresAt) {
    inMemorySession = null;
    return null;
  }
  return { ...inMemorySession };
}

export function clearSession(): void {
  inMemorySession = null;
}
