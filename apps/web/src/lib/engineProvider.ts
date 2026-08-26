/**
 * OWNER: DEV A. The single engine import site for the whole app.
 * Day 3, 14:00 (joint): verify this still works after the real engine swap.
 * DEV B: consume `engine`, never edit this file.
 */
import { createRealEngine } from "@panoptik/engine";
import type { MediaEngine } from "@panoptik/engine";

export const engine: MediaEngine = createRealEngine();
