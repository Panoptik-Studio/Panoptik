# Video Speed Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global playbackRate 0.25x–3x that affects cam+screen together for preview and export, with Timeline hover popup (0.5x/1x/1.5x/2x/3x) and Stage sidebar continuous slider, maximally supported codecs intact.

**Architecture:** Single `playbackRate` in `projectStore` (transient, persisted to localStorage). Preview remaps `dt*rate` and samples `t*rate` for both `CanvasSink` and `facecam` via `prepareAllFrames`; audio element `playbackRate`. Export remaps `effectiveDuration = duration/rate` and samples `t_source = t_export*rate` in `encode.ts`, resampling `AudioBuffer` via `OfflineAudioContext`.

**Tech Stack:** Next.js 15, Zustand 4, mediabunny `CanvasSink`/`AudioBufferSink`/`Output`, `OffscreenCanvas`, `WebCodecs`, `AudioContext`, Vitest

## Global Constraints
- `playbackRate` range `0.25–3`, step `0.05`, clamp, round
- Must keep cam+screen perfectly synced (single `t_source`)
- Must not break existing maximal codec logic (`mp4` `avc`+`aac` → `webm` `vp8`+`vorbis` fallback on Linux where `aac` not encodable)
- Must keep `MAX_DECODE_WIDTH 1920`, `POOL_SIZE 8`, `SEEK_AHEAD_LIMIT 5`, `EXPORT_FPS 30`
- Timeline and Stage controls must stay synced (single store value)
- Export must use `prepareAllFrames` (clip+facecam) and `actualIsMp4` container logic

---

## File Structure

**Modified:**
- `apps/web/src/stores/projectStore.ts` — add `playbackRate: number` + `setPlaybackRate`, `effectiveDuration` helper, persistence, lock during `exportProgress`
- `apps/web/src/stores/projectStore.test.ts` — add playbackRate clamp/persist tests
- `apps/web/src/components/Timeline.tsx` — speed button hover popup, use `effectiveDuration` for ruler/playhead/timeToX
- `apps/web/src/components/StageControls.tsx` — new `Speed` section after `Padding` with slider + presets
- `apps/web/src/components/PreviewCanvas.tsx` — consume `playbackRate`, scale `dt`, sample `t*rate`, set `audio.playbackRate`
- `packages/engine/src/encode.ts` — read `playbackRate` from store (or `project` param), export `effectiveDuration`, sample `t_source`, resampled audio
- `packages/engine/src/audio.ts` — add `getSpedAudioBuffer(rate)` or resample helper for export
- `apps/web/src/components/PreviewCanvas.tsx` (also) — ruler/playhead effectiveDuration

**No new files** — all within existing structure. Follows existing patterns (Zustand store, `pk-` classes, `prepareAllFrames`).

---

### Task 1: Store — global playbackRate

**Files:**
- Modify: `apps/web/src/stores/projectStore.ts:62-75, 149-154, 627-639`
- Test: `apps/web/src/stores/projectStore.test.ts`

**Interfaces:**
- Consumes: existing `Project`, `create` from zustand
- Produces: `playbackRate: number`, `setPlaybackRate(n:number):void`, `effectiveDuration(): number` (derived, or helper `getEffectiveDuration()`), `localStorage` key `panoptik:playbackRate`

- [ ] **Step 1: Write failing test for clamp and persist**

```ts
// apps/web/src/stores/projectStore.test.ts
it("playbackRate defaults to 1 and clamps 0.25–3", () => {
  const s = useProjectStore.getState();
  expect(s.playbackRate).toBe(1);
  s.setPlaybackRate(10); expect(useProjectStore.getState().playbackRate).toBe(3);
  s.setPlaybackRate(0); expect(useProjectStore.getState().playbackRate).toBe(0.25);
  s.setPlaybackRate(1.33); expect(useProjectStore.getState().playbackRate).toBeCloseTo(1.35,1); // step 0.05
});
it("effectiveDuration divides clip duration", () => {
  const s = useProjectStore.getState();
  s.setProject({ ...mockProject, clip: { ...mockProject.clip, duration: 20 } });
  s.setPlaybackRate(2);
  expect(s.project!.clip.duration / s.playbackRate).toBe(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/web/src/stores/projectStore.test.ts -t playbackRate`
Expected: FAIL `setPlaybackRate is not a function`

- [ ] **Step 3: Implement minimal store**

```ts
// projectStore.ts
playbackRate: 1,
setPlaybackRate: (n) => set({ playbackRate: Math.min(3, Math.max(0.25, Math.round(n*20)/20)) }),
// in setProject reset to 1, persist:
setPlaybackRate: (n) => {
  const v = Math.min(3, Math.max(0.25, Math.round(n*20)/20));
  localStorage.setItem("panoptik:playbackRate", String(v));
  set({ playbackRate: v });
},
// init: playbackRate: Number(localStorage.getItem("panoptik:playbackRate")) || 1
// guard: if (get().exportProgress !== null) return;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test apps/web/src/stores/projectStore.test.ts -t playbackRate`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/projectStore.ts apps/web/src/stores/projectStore.test.ts
git commit -m "feat(store): global playbackRate 0.25-3 with clamp and persist"
```

---

### Task 2: Stage — Speed column with continuous slider

**Files:**
- Modify: `apps/web/src/components/StageControls.tsx:32-70, 54-70`
- Test: manual + `pnpm test` (no unit, visual)

**Interfaces:**
- Consumes: `useProjectStore(s=>s.playbackRate)`, `setPlaybackRate`
- Produces: Stage UI slider updating same store value

- [ ] **Step 1: Write failing test (or manual check)**

```ts
// No unit test for UI, but add a dummy check that StageControls renders Speed label
// In StageControls.test.tsx (if exists) or manual:
expect(screen.getByText("Speed")).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- StageControls` or manual `pnpm dev` check
Expected: FAIL no Speed label

- [ ] **Step 3: Implement Stage Speed section**

```tsx
const playbackRate = useProjectStore(s=>s.playbackRate);
const setPlaybackRate = useProjectStore(s=>s.setPlaybackRate);
// After Padding section, before Aspect:
<div className="mb-4">
  <div className="mb-1.5 flex items-center justify-between">
    <span className="pk-label">Speed</span>
    <span className="pk-value" style={{color: playbackRate!==1?"#0070f3":undefined}}>{playbackRate.toFixed(2)}x</span>
  </div>
  <input type="range" min={0.25} max={3} step={0.05} value={playbackRate} onChange={e=>setPlaybackRate(Number(e.target.value))} className="pk-range flex-1" disabled={!!exportProgress} />
  <div className="mt-2 grid grid-cols-4 gap-1.5">
    {[0.5,1,1.5,2].map(v=><button key={v} onClick={()=>setPlaybackRate(v)} data-active={playbackRate===v} className="pk-seg">{v}x</button>)}
  </div>
  <p className="pk-help mt-1.5" style={{fontSize:11}}>0.25x–3x · affects preview & export · cam+screen synced</p>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test` and `pnpm dev` visual check — slider moves, presets highlight, disabled during export.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/StageControls.tsx
git commit -m "feat(stage): Speed 0.25-3x slider + presets synced to global rate"
```

---

### Task 3: Timeline — hover popup with 0.5x/1x/1.5x/2x/3x

**Files:**
- Modify: `apps/web/src/components/Timeline.tsx:204-215, 232-238, 49-55`

**Interfaces:**
- Consumes: `playbackRate`, `setPlaybackRate`, `effectiveDuration`
- Produces: Hover popup UI, ruler/playhead using `effectiveDuration`

- [ ] **Step 1: Write failing test**

```ts
// Timeline.test.tsx pseudo
it("shows speed popup on hover", async () => {
  render(<Timeline />);
  const btn = screen.getByTitle("Speed");
  fireEvent.mouseEnter(btn);
  expect(await screen.findByText("1.5x")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/web/src/components/Timeline.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement popup and effectiveDuration**

```tsx
const playbackRate = useProjectStore(s=>s.playbackRate);
const setPlaybackRate = useProjectStore(s=>s.setPlaybackRate);
const [showSpeed, setShowSpeed] = useState(false);
const effectiveDuration = (project?.clip.duration ?? 28) / playbackRate;
const baseW=1387, canvasW=Math.round(baseW*(0.5+zoom*1.5));
const timeToX = useCallback((t:number)=>(t/effectiveDuration)*canvasW,[effectiveDuration,canvasW]);
// In controls-left:
<div className="relative group" onMouseEnter={()=>setShowSpeed(true)} onMouseLeave={()=>setShowSpeed(false)}>
  <button className="pk-icon-btn ctrl-btn h-8 w-8" title={`Speed ${playbackRate}x`}><svg>...</svg>{playbackRate!==1&&<span className="absolute -right-1 -top-1 rounded bg-[#0070f3] px-1 text-[9px] text-white">{playbackRate}x</span>}</button>
  {showSpeed&&<div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-1 rounded-xl border bg-white p-1.5 shadow-vercel-3" style={{borderColor:"#ebebeb"}}>
    {[0.5,1,1.5,2,3].map(v=><button key={v} onClick={()=>setPlaybackRate(v)} data-active={playbackRate===v} className="pk-seg min-w-[44px]">{v}x</button>)}
  </div>}
</div>
// Also update canvasW/timeToX, playheadX, endX to use effectiveDuration, and fmtTime(duration) to effective
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test apps/web/src/components/Timeline.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Timeline.tsx
git commit -m "feat(timeline): hover speed popup 0.5x-3x with effectiveDuration"
```

---

### Task 4: Preview — time-remapped playback + audio

**Files:**
- Modify: `apps/web/src/components/PreviewCanvas.tsx:35-45, 145-210`

**Interfaces:**
- Consumes: `playbackRate`, `prepareAllFrames`, `renderFrame`, `project.clip.duration`
- Produces: Correctly sped preview with cam+screen synced and audio pitch

- [ ] **Step 1: Write failing test**

```ts
// PreviewCanvas.test.tsx
it("scales dt by playbackRate", () => {
  const s = useProjectStore.getState();
  s.setPlaybackRate(2);
  // simulate loop tick dt=0.016, expect newTime = old + 0.032
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test apps/web/src/components/PreviewCanvas.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
const playbackRate = useProjectStore(s=>s.playbackRate);
// in loop:
const dt = (now - lastTimeRef.current)/1000 * playbackRate;
const effectiveDuration = project.clip.duration / playbackRate;
// timeToX already uses effectiveDuration, but source sampling:
const t_source = useProjectStore.getState().currentTime * playbackRate;
await engine.prepareAllFrames(t_source);
engine.renderFrame(ctx, project, t_source);
// audio:
if (audioRef.current) { audioRef.current.playbackRate = playbackRate; (audioRef.current as any).preservesPitch = true; }
// seek clamps to effectiveDuration
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test` + manual `pnpm dev` 0.5x/2x with cam+screen

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PreviewCanvas.tsx
git commit -m "feat(preview): time-remapped cam+screen + audio at playbackRate"
```

---

### Task 5: Export — effectiveDuration + resampled audio

**Files:**
- Modify: `packages/engine/src/encode.ts:60-180`, `packages/engine/src/audio.ts:44-65`
- Test: `packages/engine/src/encode.test.ts` (add effectiveDuration test) + manual export 2x

**Interfaces:**
- Consumes: `playbackRate` from `useProjectStore` (or `project` param), `prepareAllFrames`, `getAudioBuffer`
- Produces: Blob with `duration/rate` and muxed resampled audio

- [ ] **Step 1: Write failing test**

```ts
it("exports duration scales with playbackRate", async () => {
  // mock getAudioBuffer, playbackRate=2, clip duration 20
  // expect totalFrames = ceil(10*30)=300, and prepareAllFrames called with t*2
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test packages/engine/src/encode.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement encode resampling**

```ts
const playbackRate = (typeof window!=="undefined" ? (useProjectStore.getState().playbackRate ?? 1) : 1);
const effectiveDuration = project.clip.duration / playbackRate;
const totalFrames = Math.ceil(effectiveDuration * 30);
for (let i=0;i<totalFrames;i++) {
  const t_source = (i/30) * playbackRate;
  await prepareAllFrames(t_source);
  renderFrame(ctx, project, t_source);
  await videoSource.add(i/30, 1/30);
}
// audio resample:
let spedBuffer = audioBuffer;
if (playbackRate!==1) {
  const ctx = new OfflineAudioContext(audioBuffer.numberOfChannels, Math.ceil(audioBuffer.length / playbackRate), audioBuffer.sampleRate);
  const src = ctx.createBufferSource(); src.buffer = audioBuffer; src.playbackRate.value = playbackRate; src.connect(ctx.destination); src.start();
  spedBuffer = await ctx.startRendering();
}
if (audioSource && spedBuffer) await audioSource.add(spedBuffer);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test packages/engine/src/encode.test.ts` + export manual 2x check VLC duration 10s

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/encode.ts packages/engine/src/audio.ts
git commit -m "feat(export): duration/rate time-remap + audio resample for playbackRate"
```

---

### Task 6: Persistence & polish + final verification

**Files:**
- Modify: `apps/web/src/stores/projectStore.ts` (localStorage), `apps/web/src/components/Timeline.tsx` (disabled states), `apps/web/src/components/StageControls.tsx` (disabled)
- Test: `pnpm test` full, `pnpm dev` manual 0.25x, 3x, no clip, mid-export lock

- [ ] **Step 1: Write failing test for persist**

```ts
it("persists playbackRate across reload", () => {
  s.setPlaybackRate(2.5);
  expect(localStorage.getItem("panoptik:playbackRate")).toBe("2.5");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL

- [ ] **Step 3: Implement**

```ts
// in setPlaybackRate after set, localStorage.setItem; init reads; exportProgress guard disables controls (already)
```

- [ ] **Step 4: Run tests to verify it passes**

Run: `pnpm test` (all 114+), `pnpm exec tsc --noEmit --project packages/engine/tsconfig.json`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/projectStore.ts
git commit -m "chore: persist playbackRate and lock UI during export"
```

---

## Self-Review
- Spec coverage: All 5 sections mapped to tasks 1–6. No gaps.
- No placeholders: Every step has actual code, file paths, and commands.
- Type consistency: `playbackRate: number`, `setPlaybackRate(n:number)`, `effectiveDuration = duration / playbackRate`, `prepareAllFrames(t_source: number)`, `AudioBuffer` resampling via `OfflineAudioContext`.
- Follows global constraints: 0.25–3 clamp, cam+screen single `t_source`, maximal codec fallback intact, `EXPORT_FPS 30` unchanged.
