/**
 * Source for the cursor compositor Web Worker (instantiated via Blob URL in record.ts).
 *
 * Kept as a plain string so the engine package needs no bundler-specific
 * worker wiring. The worker owns the whole recording-time cursor pipeline:
 *
 *  1. It reads VideoFrames straight from a MediaStreamTrackProcessor — the
 *     capture pipeline keeps feeding frames while the recorder tab is
 *     BACKGROUND, where main-thread timers throttle to 1Hz. This is why both
 *     tracking and compositing live here and not on the window.
 *  2. It tracks the cursor with the same localized frame-diff heuristic the
 *     RecordModal used to run at 10Hz — now at capture fps.
 *  3. It draws each frame plus a cursor sprite into the OffscreenCanvas the
 *     recorded stream is captured from, so the ORIGINAL cursor ends up baked
 *     into the recorded file on platforms whose compositor does not embed it
 *     (Linux window/tab capture).
 */

export const CURSOR_WORKER_SOURCE = String.raw`
let canvas = null;
let ctx = null;
let sampCtx = null;
let prev = null;
let diff = null;   // last frame-diff detection { x, y, t }
let dom = null;    // last DOM-observed position { x, y, down, t }
let lastSent = 0;
const THRESHOLD = 28;

function drawSprite(c, w, h, x, y, down) {
  const px = x * w;
  const py = y * h;
  const s = Math.max(12, Math.round(h * 0.024)) / 21;
  c.save();
  if (down) {
    const r = Math.max(14, h * 0.034);
    c.beginPath();
    c.arc(px + s * 5, py + s * 5, r, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(110,165,255,0.85)';
    c.lineWidth = Math.max(2, h * 0.0045);
    c.stroke();
    c.beginPath();
    c.arc(px + s * 5, py + s * 5, r, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.55)';
    c.lineWidth = Math.max(1, h * 0.002);
    c.stroke();
  }
  c.translate(px, py);
  if (down) c.scale(0.92, 0.92);
  c.scale(s, s);
  c.shadowColor = 'rgba(0,0,0,0.4)';
  c.shadowBlur = 4;
  c.shadowOffsetX = 1;
  c.shadowOffsetY = 2;
  const p = new Path2D('M0 0 L0 18.5 L5.2 14 L8.6 21.2 L11.7 19.8 L8.3 12.8 L15 12.4 Z');
  c.lineJoin = 'round';
  c.lineWidth = 3.4;
  c.strokeStyle = '#ffffff';
  c.stroke(p);
  c.shadowColor = 'transparent';
  c.fillStyle = '#16181d';
  c.fill(p);
  c.restore();
}

// Localized moving-blob detector: the cursor is the only thing on screen that
// changes within a small span while the rest of the window is static.
function detect(data, sw, sh) {
  let activePixels = 0;
  let sumDiff = 0;
  let weightedX = 0;
  let weightedY = 0;
  let minX = sw;
  let minY = sh;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < sh; y += 2) {
    for (let x = 0; x < sw; x += 2) {
      const idx = (y * sw + x) * 4;
      const dr = Math.abs((data[idx] || 0) - (prev[idx] || 0));
      const dg = Math.abs((data[idx + 1] || 0) - (prev[idx + 1] || 0));
      const db = Math.abs((data[idx + 2] || 0) - (prev[idx + 2] || 0));
      const diffVal = (dr + dg + db) / 3;
      if (diffVal > THRESHOLD) {
        sumDiff += diffVal;
        activePixels++;
        weightedX += x * diffVal;
        weightedY += y * diffVal;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const totalSampled = (sw * sh) / 4;
  const activeRatio = activePixels / totalSampled;
  if (
    activeRatio > 0.0002 &&
    activeRatio < 0.06 &&
    maxX - minX < sw * 0.35 &&
    maxY - minY < sh * 0.35 &&
    sumDiff > 0
  ) {
    return { x: weightedX / sumDiff / sw, y: weightedY / sumDiff / sh };
  }
  return null;
}

async function pump(stream, reader) {
  while (true) {
    let res;
    try {
      res = await reader.read();
    } catch (err) {
      break;
    }
    if (res.done || !res.value) break;
    const frame = res.value;
    try {
      if (!ctx) { frame.close(); continue; }
      // Skip stale frames when drawing falls behind the capture rate, so the
      // composited stream trails the live surface by at most one frame.
      let backlog = false;
      try { backlog = typeof stream.desiredSize === 'number' && stream.desiredSize <= 0; } catch (e) {}
      if (backlog) { frame.close(); continue; }

      if (sampCtx && prev) {
        sampCtx.drawImage(frame, 0, 0, sampCtx.canvas.width, sampCtx.canvas.height);
        const img = sampCtx.getImageData(0, 0, sampCtx.canvas.width, sampCtx.canvas.height);
        const hit = detect(img.data, sampCtx.canvas.width, sampCtx.canvas.height);
        if (hit) diff = { x: hit.x, y: hit.y, t: Date.now() };
        prev = img.data;
      } else if (sampCtx) {
        sampCtx.drawImage(frame, 0, 0, sampCtx.canvas.width, sampCtx.canvas.height);
        prev = sampCtx.getImageData(0, 0, sampCtx.canvas.width, sampCtx.canvas.height).data;
      }

      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      const useDom = dom && Date.now() - dom.t < 350;
      const cur = useDom ? dom : diff;
      if (cur) {
        drawSprite(ctx, canvas.width, canvas.height, cur.x, cur.y, useDom ? dom.down : false);
        const now = Date.now();
        if (now - lastSent > 90) {
          lastSent = now;
          self.postMessage({ type: 'sample', x: cur.x, y: cur.y, down: useDom ? dom.down : false });
        }
      }
    } catch (err) {
      // Never let one bad frame stop the pump.
    } finally {
      try { frame.close(); } catch (err) {}
    }
  }
}

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'init') {
    try {
      canvas = d.canvas;
      ctx = canvas.getContext('2d', { alpha: false });
      const samp = new OffscreenCanvas(d.sampleW || 240, d.sampleH || 135);
      sampCtx = samp.getContext('2d', { willReadFrequently: true });
      pump(d.frames, d.frames.getReader());
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'fail', error: String(err) });
    }
  } else if (d.type === 'resize') {
    if (canvas && d.width && d.height) {
      canvas.width = d.width;
      canvas.height = d.height;
    }
  } else if (d.type === 'cursor') {
    dom = { x: d.x, y: d.y, down: !!d.down, t: Date.now() };
  }
};
`;
