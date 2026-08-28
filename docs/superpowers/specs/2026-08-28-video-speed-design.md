# Video Speed Control — Design

**Date:** 2026-08-28
**Status:** Approved
**Approach:** A — Single global `playbackRate` with time-remapped sampling

## 1. Goal
Add a global video speed that affects **cam + screen together** for both **preview** and **export**. Timeline has hover popup `0.5x/1x/1.5x/2x/3x`; Stage sidebar has a `Speed` column with continuous `0.25x–3x` slider. Both sync to one store value.

Success: changing speed instantly changes preview rate, keeps cam/screen in sync, and exported file duration is `clip.duration / playbackRate` with audio time-stretched.

## 2. Data Model

**Store** `apps/web/src/stores/projectStore.ts`:
```ts
playbackRate: number // default 1, clamp 0.25–3, step 0.05
setPlaybackRate: (n:number) => void
```
- Not in `Project` schema (transient like `currentTime`). Derived `effectiveDuration = (project.clip.duration ?? 0) / playbackRate`.
- `setProject` resets to 1. Persist to `localStorage` `panoptik:playbackRate` (read on init, write on change).
- `exportProgress !== null` locks `setPlaybackRate` (no mid-export changes).

**No schema migration** — `Project` unchanged.

## 3. UI

### 3.1 Timeline — `apps/web/src/components/Timeline.tsx:212`
- Wrap speed button in `group` relative. `onMouseEnter` → absolute popup `top:-8 left:50% -translate-x-1/2 -translate-y-full` with grid `0.5x 1x 1.5x 2x 3x`, `data-active` highlight, click `setPlaybackRate`. Popup also shows current `1.0x` chip. `onMouseLeave` hides (100ms delay).
- Button label shows current rate when !=1 (e.g., `1.5x`).

### 3.2 Stage — `apps/web/src/components/StageControls.tsx`
- New `Speed` section after `Padding` (before `Aspect`):
  - Header `Speed` + live value `1.0x` (blue when !=1)
  - `<input type=range min=0.25 max=3 step=0.05>` `pk-range flex-1`
  - Preset row `0.5x 1x 1.5x 2x` (`pk-seg`, `data-active`)
  - Help text `0.25x–3x · affects preview & export · cam+screen synced`
- Both controls read/write same `playbackRate` → instant sync.

## 4. Preview Flow

**`apps/web/src/components/PreviewCanvas.tsx`:**
- `useProjectStore(s => s.playbackRate)` added.
- Loop `dt` scaled: `newTime = currentTime + dt * playbackRate`.
- `seek`/`setCurrentTime` clamp to `effectiveDuration`. `rewindIfEnded` uses `effectiveDuration`.
- `timeToX/xToTime` now use `effectiveDuration` for canvas width/playhead, but **source sampling** is `t_source = currentTime * playbackRate` passed to `prepareAllFrames(t_source)` and `renderFrame(ctx,project,t_source)` — cam+screen stay locked.
- Audio: `audioRef.current.playbackRate = playbackRate` on change; set `preservesPitch = true` (or `webkitPreservesPitch`) for natural speed. Sync interval also uses `* playbackRate`.

**`Timeline` ruler:** `duration` prop now `effectiveDuration` for tick labels, but source diamonds stay at `zp.t` (original time) — ruler maps effective time to x, so diamonds stretch with speed.

## 5. Export Flow

**`packages/engine/src/encode.ts`:**
- Read `playbackRate` from store (or pass `project` + `playbackRate` param — store read is simpler, but `opts` could carry it; we use store).
- `effectiveDuration = clip.duration / playbackRate`
- `totalFrames = ceil(effectiveDuration * EXPORT_FPS)` (30)
- Loop: `t_export = i / EXPORT_FPS`, `t_source = t_export * playbackRate`, `await prepareAllFrames(t_source)`, `renderFrame(ctx,project,t_source)`, `videoSource.add(t_export, frameDuration)`.
- Progress `i/totalFrames` still 0..1 over effective duration.

**`packages/engine/src/audio.ts`:**
- Add `getSpedAudioBuffer(rate): Promise<AudioBuffer>` or extend `getAudioBuffer` to resample: create `OfflineAudioContext` with length `totalFrames / (sampleRate/rate)` and `playbackRate` via `AudioBufferSourceNode.playbackRate`. For `rate !=1`, resample by `AudioBuffer` channel data interpolation (simplest: `OfflineAudioContext` render at `rate`). If no audio, export silent as before.

## 6. Persistence & Edge Cases
- Clamp `0.25–3`, round `0.05`. Invalid → clamp.
- No clip → controls disabled, `playbackRate` still settable but has no effect.
- Mid-playback rate change → `currentTime` stays in effective space, next `dt*rate` uses new rate, no jump.
- Mid-export rate change blocked (store lock + UI disabled).
- Zero/negative rate → clamp.
- Audio pitch correction via `preservesPitch`/resample; if resample fails, export with original audio at 1x and warn.

## 7. Testing
- Unit: `projectStore` playbackRate clamp/round, effectiveDuration derivation.
- Integration: `Timeline` popup hover, `StageControls` slider sync, `PreviewCanvas` dt scaling, `encode` effectiveDuration math (snapshot: 20s clip at 2x → 10s, 300 frames).
- Manual: 0.25x, 1x, 2x, 3x preview + export, cam+screen sync, audio pitch.

## 8. Out of Scope
- Per-segment speed curves, per-track (cam vs screen) independent speed, pitch-shift UI.
