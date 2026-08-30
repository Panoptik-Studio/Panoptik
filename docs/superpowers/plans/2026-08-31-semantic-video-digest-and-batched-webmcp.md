# Actionable Task Plan: Semantic Video Digest, Hybrid Cloud AI & Batched WebMCP

This document provides the complete, step-by-step engineering tasks for implementing the architecture defined in [`docs/superpowers/specs/2026-08-31-semantic-video-digest-and-batched-webmcp-architecture.md`](file:///home/abhinav/Documents/github/Panoptik/docs/superpowers/specs/2026-08-31-semantic-video-digest-and-batched-webmcp-architecture.md).

---

## Phase 1: Local Heuristic Extractors & Audio Payload

### Task 1.1: Video Frame Sampler & Adaptive Scene Detector
- [ ] **File**: `packages/engine/src/analysis/videoFeatures.ts`
  - Sample decoded frames at 1.5 fps using `OffscreenCanvas`.
  - Calculate 64-bin RGB color histograms per sample frame.
  - Implement Adaptive Thresholding with floor: $\text{threshold} = \max(\text{rollingMedian} + 2.5 \times \text{MAD}, 0.25)$ with minimum $1.5\text{s}$ scene duration.
  - Compute median-cut 16-hue indexed palette (`pal: 0..15`).
  - Classify motion energy into `motionCategory: "static" | "medium" | "high"`.
  - Compute 4-quadrant edge entropy (`tl`, `tr`, `bl`, `br`) for `camCorner`.
  - Implement Centroid Collision Rule: If `camCorner` intersects click centroid box $[cx \pm 0.12, cy \pm 0.12]$, select second-lowest entropy corner.
  - Generate and save $96 \times 54$ keyframe thumbnails to OPFS for UI inspection.
- [ ] **Unit Tests**: `packages/engine/src/analysis/videoFeatures.test.ts`

### Task 1.2: Isolated Mic VAD, Silence & Emphasis Detector
- [ ] **File**: `packages/engine/src/analysis/audioFeatures.ts`
  - Run RMS sliding windows (20 ms) strictly on the **microphone/dialogue track** (fallback to screen audio only if mic missing).
  - Detect dead-air silence intervals ($\ge 450\text{ ms}$).
  - Detect minor pause boundaries ($150\text{ ms} - 450\text{ ms}$).
  - Detect vocal emphasis peaks ($> 3.2\times$ rolling average) and emit $\pm 200\text{ms}$ keepout zones.
- [ ] **Unit Tests**: `packages/engine/src/analysis/audioFeatures.test.ts`

### Task 1.3: Audio Payload Resampler & Overlap-Dedupe Merger
- [ ] **File**: `packages/engine/src/analysis/audioPayload.ts`
  - Extract project audio track, downmix to 16,000 Hz 16-bit mono.
  - Encode into compressed Ogg/Opus (or FLAC) blob ($< 3.2\text{MB}$ for 10-minute clip).
  - Implement 15-minute chunking with 2.0s unmixed overlap region.
  - Implement Overlap-and-Dedupe transcript merger: rebase timestamps, deduplicate overlapping words, and fuzzy-merge boundary partial word pairs.
- [ ] **Unit Tests**: `packages/engine/src/analysis/audioPayload.test.ts`

### Task 1.4: Phrase-Level Transcript Packer
- [ ] **File**: `packages/engine/src/analysis/transcriptPacking.ts`
  - Group raw word-level timestamps into packed phrase lines breaking on $\ge 0.5\text{s}$ pauses or punctuation.
  - Format as `[MM:SS.s-MM:SS.s] Phrase text.`
- [ ] **Unit Tests**: `packages/engine/src/analysis/transcriptPacking.test.ts`

### Task 1.5: 3-Tier Cursor Stream & Interaction Heatmap
- [ ] **File**: `packages/engine/src/analysis/interactionFeatures.ts`
  - Support Tier A (DOM stream), Tier B (CV tracker @ 1.5fps with easing interpolation), and Tier C (degraded `clicks: 0` fallback).
  - Compute per-scene click count, centroid $(\bar{x}, \bar{y})$, and click bursts ($\ge 3$ clicks in $< 2.0\text{s}$).
- [ ] **Unit Tests**: `packages/engine/src/analysis/interactionFeatures.test.ts`

### Task 1.6: Sampled 128KB Hash & OPFS Feature Cache
- [ ] **File**: `packages/engine/src/analysis/cache.ts`
  - Compute fast 128KB sampled hash: $\text{FNV-1a}(\text{size} + \text{duration} + \text{first64KB} + \text{last64KB})$.
  - Persist analysis tree in OPFS under `/projects/<projectId>/analysis/<hash>.json`.
- [ ] **Unit Tests**: `packages/engine/src/analysis/cache.test.ts`

---

## Phase 2: Digest Serializer, Snapping & Self-Eval Engine

### Task 2.1: Compact Scene DataFrame Serializer
- [ ] **File**: `packages/engine/src/analysis/digest.ts`
  - Serialize local analysis into compact dataframe: `[id, t0, t1, motionCategory, paletteIndex, clicks, lpeaks, camCorner]`.
  - Format packed transcript block and global context header (including `hasMusic`).
- [ ] **Unit Tests**: `packages/engine/src/analysis/digest.test.ts` (Verify $< 7,000$ tokens for 10-min clip using `gpt-tokenizer`).

### Task 2.2: Cut-Map Rebasing, Straddle Clamping & Snapping Engine
- [ ] **File**: `apps/web/src/webmcp/snapping.ts`
  - Express all op timestamps in source-media coordinates.
  - Implement 6-step execution order:
    1. Validate ops.
    2. Resolve cuts $\to$ build sorted `cutMap` of dropped intervals.
    3. Partially overlapping op windows clamped to surviving media span (drop if clamped $< 0.5\text{s}$). Reject ops fully inside drops.
    4. Rebase surviving timestamps: $t' = t - \sum \text{droppedDur}$.
    5. Speed op constraints (v1): reject speed ops overlapping any other op window.
    6. Return snapped & rebased operations with explicit delta diff summary.
  - Word boundary protection ($\pm 150\text{ms}$) & emphasis keepouts ($\pm 200\text{ms}$).
  - Zoom centroid snapping & transition collision clamping.
- [ ] **Unit Tests**: `apps/web/src/webmcp/snapping.test.ts`

### Task 2.3: Atomic Batch Op Executor
- [ ] **File**: `apps/web/src/webmcp/batchExecutor.ts`
  - Atomically stage rebased ops (`cut`, `zoom`, `cam`, `trans`, `bg`, `speed`, `text`, `music`) into `useProjectStore`.
  - Return lean 1-line delta summary to the LLM.
- [ ] **Unit Tests**: `apps/web/src/webmcp/batchExecutor.test.ts`

### Task 2.4: Deterministic Self-Evaluation Quality Guard
- [ ] **File**: `packages/engine/src/analysis/selfEval.ts`
  - Implement `evaluateProjectTimeline(project: Project): TimelineQualityReport`
  - Check for flash frames ($< 0.25\text{s}$), audio pops/clicks at cut boundaries, and zoom hold bounds ($[0.8\text{s}, 6.0\text{s}]$).
  - Enforce hard cap of max 1 self-correction turn.
- [ ] **Unit Tests**: `packages/engine/src/analysis/selfEval.test.ts`

---

## Phase 3: Cloudflare Worker Proxy & Auth Gateway (Parallel Track)

### Task 3.1: Cloudflare Worker Proxy Core
- [ ] **Directory**: `proxy/`
  - Implement `/v1/ai/transcribe`: Forward audio to Groq Whisper Large v3 / Deepgram with failover.
  - Implement `/v1/ai/direct`: Prepend static server-side system prompt with prompt caching headers (`cache-control: { type: "ephemeral" }` for Anthropic; `cachedContents` for Gemini).
  - Post-increment quota accounting in Cloudflare KV on HTTP 200 response only.
  - Check `revoked:<userId>` in KV for instant session revocation.
- [ ] **Unit Tests**: `proxy/test/gateway.test.ts`

### Task 3.2: Provider Adapters & Client Auth
- [ ] **File**: `apps/web/src/lib/ai/authClient.ts`
  - Manage 24h signed JWT in closure memory.
- [ ] **File**: `apps/web/src/lib/ai/providers.ts`
  - Implement `TranscriptionProvider` and `DirectorProvider` interfaces supporting Proxy client and BYOK direct modes.
- [ ] **Unit Tests**: `apps/web/src/lib/ai/providers.test.ts`

---

## Phase 4: Consent & Privacy UI Integration

### Task 4.1: Project Consent Modal & Indicator Badge
- [ ] **File**: `apps/web/src/components/CloudConsentModal.tsx`
  - First-use dialog before sending audio to cloud proxy.
  - Persist per-project opt-in state in project store / OPFS.
- [ ] **File**: `apps/web/src/components/Toolbar.tsx`
  - Display `☁️ Cloud-Assisted` or `🔒 Local Only` indicator badge.

### Task 4.2: Settings & BYOK API Keys
- [ ] **File**: `apps/web/src/components/AISettingsModal.tsx`
  - Manage Panoptik Pro subscription and optional BYOK API keys stored in `localStorage` with security disclaimer.
  - Hard offline kill-switch toggle ("Air-Gapped Mode").

### Task 4.3: Local Whisper WASM Fallback
- [ ] **File**: `apps/web/src/workers/whisperWorker.ts`
  - Maintain `@xenova/transformers` worker as fallback when offline or unauthenticated.

---

## Phase 5: Batched WebMCP Tool Suite & Verification

### Task 5.1: Consolidated 6 Core + 3 Tiered Tools Catalog
- [ ] **File**: `apps/web/src/webmcp/tools-batch.ts`
  - Expose `get_video_summary`, `get_scene_detail`, `probe_frames`, `propose_edits` (`mode: "replace" | "append"`), `commit_staged_changes`, and `discard_staged_changes`.
  - Exclude granular tools from WebMCP catalog to eliminate schema tax.
- [ ] **File**: `apps/web/src/webmcp/index.ts`
  - Register consolidated tool suite on mount.

### Task 5.2: End-to-End Validation & Degraded Mode Suite
- [ ] Run test suite: `pnpm -r test`
- [ ] Run TypeScript checks: `pnpm typecheck`
- [ ] Verify Degraded Modes:
  - No mic track $\to$ screen audio fallback.
  - No WebGPU $\to$ WASM Whisper fallback.
  - No cursor stream $\to$ `clicks: 0` fallback.
- [ ] Test in Chrome with `#enable-webmcp-testing` and ChatGPT browser.
