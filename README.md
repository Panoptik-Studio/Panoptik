# Panoptik — Open Demo Studio × WebMCP

An open-source, **client-side** demo video editor where a human and an AI agent co-edit screen recordings on the **same canvas** via [WebMCP](https://github.com/webmachinelearning/webmcp). No server, no upload, no API keys — everything runs in the browser with WebCodecs + `mediabunny`.

> **Hackathon:** OpenAI WebMCP Challenge (Devpost deadline Sep 3, 2026 4:00 PM EDT). Two-layer build: Days 1–4 Poindeo-competitor core editor, Days 5–7 agent co-editing.

---

## What it is

1. **Core editor (Days 1–4):** Import MP4/WebM/MOV → click-to-zoom (eased `scale`/`x`/`y` per `ROADMAP-A.md` sequential fold, clamped viewport, letterboxed frame `packages/engine/src/layout.ts:1`), facecam PiP `render.ts:215` (screen-space, circular/square), captions via local Whisper `workers/whisperWorker.ts`, backgrounds (solid/gradient/blur `render.ts:155`), text overlays, `StagingPanel` human-in-loop (`getStagedDiff`/`commitAll`), `Timeline` diamonds, `PreviewCanvas` dirty-flag rAF, `OPFS` persistence, `CanvasSink` 60fps `decode.ts:44` (coalesced pump, `MAX_DECODE_WIDTH 1920`, `POOL_SIZE 4`), export `encode.ts:57` (`Output`/`CanvasSource`/`AudioBufferSource`, `30fps`, `export-progress` events, `MP4`/`WebM` `720p`/`1080p`/`4k`).

2. **WebMCP co-edit (Days 5–7):** Agent calls structured tools (`propose_zoom_points`, `add_text_overlay`, `set_background`, `generate_captions` → `staged*` ghosts amber `#f59e0b`, then `commit_staged_changes` gated by `ConfirmDialog` `webmcp/confirm.ts`). Nine tools + declarative `ExportPanel` form (`tool-name`/`tool-description`), lifecycle `webmcp/lifecycle.ts` (`AbortController` + `webmcp-tool-call` trace `ToolTrace.tsx`).

Architecture: `mediabunny` demux/mux + WebCodecs under the hood + Canvas2D `renderFrame()` **single path** for preview and export ("preview equals export"). See `Spec.md` for full slice breakdown and `ROADMAP-A/B.md` for the day-by-day plan.

```
apps/web         Next.js 15 static export — /editor (canvas+timeline+inspector+staging)
packages/engine  @panoptik/engine MIT — decode/render/encode/audio/layout (browser-native)
packages/project-schema  @panoptik/schema — Project/ZoomPoint/ExportOpts (locked contract v1.1)
packages/utils   @panoptik/utils — easing (easeInOutCubic etc., EASINGS registry)
```

---

## Quickstart

```bash
pnpm install          # Node 20.19.6, pnpm 10.33.0
pnpm dev              # → http://localhost:3000/editor (Next.js --filter @panoptik/web dev)
pnpm build            # static export to apps/web/out
pnpm vitest run       # 106 tests (engine+store+utils+opfs+layout)
pnpm -r typecheck     # tsc --noEmit per package
```

Requirements: Chrome/Edge 110+ (WebCodecs + `getDisplayMedia`), SecureContext (`https` or `localhost`). No env vars, no keys.

Import: drag a clip or `Browse video` or **Record** (header red button → `getDisplayMedia` + `getUserMedia` → `record.ts:212` → `engine.loadRecording` → facecam PiP at `facecam.x/y/size`). Play/pause `Space`, seek via timeline, click canvas (paused) to add zoom, click near diamond to delete, drag focal dot, tweak `Inspector` (depth/duration/easing/focal), `StagingPanel` → `Apply all` / `Discard`.

Export: **Export Video** → `encode.ts:57` (30fps loop `prepareFrame`+`renderFrame` → `CanvasSource.add` + `AudioBufferSource.add` from unified `audio.ts:9` `AudioBufferSink`) → progress bar on `export-progress` → download `video/mp4` or `video/webm`.

---

## Testing with an agent

> **Owner: DEV B** — this subsection is B's deliverable (`ROADMAP-B.md:409`). The steps below are the current draft; B will finalize.

1. Deploy to Vercel (`vercel.json`: `pnpm --filter @panoptik/web build` → `apps/web/out`, framework Other, `https` required) — do **not** test against `localhost` from ChatGPT browser.
2. Chrome `chrome://flags/#enable-webmcp-testing` **Enabled** + relaunch, or open the Vercel URL in ChatGPT app's in-app browser.
3. In DevTools console: `document.modelContext.getTools()` should list 9 tools (4 engine `tools-a.ts` + 5 editing `tools-b.ts`) + `lifecycle.ts` trace.
4. Agent prompts: `get_project_state` → `get_click_log` → `propose_zoom_points({timestamps:[3,8]})` → ghosts appear amber on timeline → human drags one → `commit_staged_changes` → Confirm dialog → `export_clip({format:"mp4",resolution:"1080p"})` → confirm → MP4 downloads. Declarative `ExportPanel` form: agent fills `format`/`resolution`, **human** clicks submit.

Whisper `whisper-base` (~40MB) downloads on first `Generate captions`; pre-warm before demo (Day 6) or use `whisper-tiny.en` fallback `ROADMAP-B.md:527`.

---

## Architecture diagram

`Spec.md` §§ Slice A/B + `ROADMAP-A.md` § Locked contract + Calendar. One `MediaEngine` `engine/index.ts:11`:

```ts
loadClip / loadRecording / prepareFrame(t) / renderFrame(ctx,project,t) / getAudioBuffer / exportProject
```

Single `Input` (`BlobSource`) yields `CanvasSink` (video) and `AudioBufferSink` (audio) — no duplicate parsing. Timeline → `projectStore.ts` (`staged*` + `history` + `selectedZoomId` + `markMoment` + `pendingBackgroundBadge`) → `render.ts` (`background` → letterboxed+zoomed `currentFrame` → `facecam` → `text` → `captions`).

License boundary: `LICENSE` AGPL-3.0 (app), `packages/engine/LICENSE` MIT (publishable).

---

## Benchmarks (measured `ROADMAP-A.md:587` — Day 6)

> Fill after Day 6 export run on 15s 1080p clip.

* Preview: 60fps at 1080p ( OffscreenCanvas + `POOL_SIZE 4` + dirty-flag `PreviewCanvas.tsx:99` + selector isolation)
* Export: ≤2× realtime at 1080p (e.g. 15s clip → ~25-30s on M-series, `QUALITY_VERY_HIGH`, `keyFrameInterval 2`)
* Whisper `whisper-base` word-level: ~10-15s for 15s clip (after 40MB download)
* Vercel cold start: static `out` (no SSR)

---

## Known limitations

* `background.kind==="blur"` is stretched+`blur(24px)` of the current frame `render.ts:174` — cheap but plausible; true stacked blur is post-hackathon.
* Facecam is composited during preview+export; export PiP is drawn from the same `HTMLVideoElement` cache — ` OffscreenCanvas` export uses the same path.
* No `gif` export (cut from `ExportOpts` v1.1).
* `AudioBufferSink` concat preserves channels/sampleRate; `audio16k.ts` resamples to 16kHz mono for Whisper.
* `getDisplayMedia` + PiP both need transient activation — screen capture is prioritized, PiP falls back inline `RecordModal.tsx:367`.
* OPFS requires SecureContext; falls back to in-memory when unavailable.

---

## Submission checklist (`ROADMAP-A.md:598`)

`pnpm build` green · `document.modelContext.registerTool` greppable `apps/web/src/webmcp` · `LICENSE`/`packages/engine/LICENSE` present · Vercel `https` `/editor` loads real video · `README` engine/codec sections accurate · `rm -rf node_modules && pnpm i && pnpm dev` clean clone.

---

## Risks & fallbacks

See `ROADMAP-A.md:618` (codec drift → read `node_modules/mediabunny/dist/*.d.ts`; export slow → pre-render MP4; polyfill/native mismatch → feature-detect `modelContext` in `document`).
