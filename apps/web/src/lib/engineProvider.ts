/**
 * OWNER: DEV A. The single engine import site for the whole app.
 * Day 3, 14:00 (joint): swap the mock for the real engine — one line here,
 * nowhere else. DEV B: consume `engine`, never edit this file.
 *
 * Swap target:
 *   import { engine as realEngine } from "@panoptik/engine"; // implements MediaEngine
 */
import type { MediaEngine } from "@panoptik/engine";
import { mockEngine } from "./mockEngine";

export const engine: MediaEngine = mockEngine;
