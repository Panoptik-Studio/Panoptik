/**
 * Safe localStorage wrapper with automatic cleanup for bloated legacy keys.
 * Protects against QuotaExceededError when saving pointers, layout prefs, or BYOK keys.
 */

export function safeSetLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(key, value);
  } catch (err: any) {
    if (
      err?.name === "QuotaExceededError" ||
      err?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err?.code === 22 ||
      err?.code === 1014
    ) {
      // Purge bloated legacy project history snapshots from localStorage
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("panoptik:history:")) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
        // Retry setting the key after cleanup
        localStorage.setItem(key, value);
      } catch {
        console.warn(`[storageUtils] Unable to set localStorage key "${key}" due to quota limit.`);
      }
    } else {
      console.warn(`[storageUtils] Failed to set localStorage key "${key}":`, err);
    }
  }
}

export function cleanupLegacyLocalStorage(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("panoptik:history:")) {
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
