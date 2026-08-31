/**
 * Grounded VLM Parser, Grid Mapper, and Zoom Viewport Verification.
 * Implements the 3-tier mitigation ladder:
 * 1. Normalized 0-1000 bounding box parsing ([ymin, xmin, ymax, xmax]) -> Centroid (x, y)
 * 2. 3x3 Alphanumeric Grid Cell mapping (A1..C3) -> Center (x, y)
 * 3. Zoom viewport tolerance calculation: tolerance = (screen_width / zoom_scale - object_width) / 2
 * 4. Crop-and-verify confirmation loop for high zoom depths (>= 3.5x).
 */

export interface NormalizedBBox {
  ymin: number; // 0..1000
  xmin: number; // 0..1000
  ymax: number; // 0..1000
  xmax: number; // 0..1000
}

export interface GroundingResult {
  x: number; // 0.0 .. 1.0 (normalized screen center)
  y: number; // 0.0 .. 1.0 (normalized screen center)
  width: number; // 0.0 .. 1.0
  height: number; // 0.0 .. 1.0
  confidence: number; // 0.0 .. 1.0
  gridCell?: string; // "A1" .. "C3"
  objectPresent: boolean;
  source: "bbox" | "grid" | "interaction" | "fallback";
}

/** 3x3 Grid definition: Row A (top), Row B (middle), Row C (bottom); Col 1 (left), 2 (center), 3 (right) */
export const GRID_3X3_CELLS: Record<string, { x: number; y: number; w: number; h: number }> = {
  A1: { x: 1 / 6, y: 1 / 6, w: 1 / 3, h: 1 / 3 },
  A2: { x: 3 / 6, y: 1 / 6, w: 1 / 3, h: 1 / 3 },
  A3: { x: 5 / 6, y: 1 / 6, w: 1 / 3, h: 1 / 3 },
  B1: { x: 1 / 6, y: 3 / 6, w: 1 / 3, h: 1 / 3 },
  B2: { x: 3 / 6, y: 3 / 6, w: 1 / 3, h: 1 / 3 },
  B3: { x: 5 / 6, y: 3 / 6, w: 1 / 3, h: 1 / 3 },
  C1: { x: 1 / 6, y: 5 / 6, w: 1 / 3, h: 1 / 3 },
  C2: { x: 3 / 6, y: 5 / 6, w: 1 / 3, h: 1 / 3 },
  C3: { x: 5 / 6, y: 5 / 6, w: 1 / 3, h: 1 / 3 },
};

/**
 * Calculates the allowable error margin (in pixels or normalized fraction) for a zoom scale.
 * Formula: tolerance = (screenWidth / scale - objectWidth) / 2
 */
export function calculateZoomTolerance(
  scale: number,
  normalizedObjectWidth = 0.15,
  screenWidth = 1920,
): { pixelTolerance: number; normalizedTolerance: number } {
  const safeScale = Math.max(1, scale);
  const viewportWidthPx = screenWidth / safeScale;
  const objectWidthPx = normalizedObjectWidth * screenWidth;
  const pixelTolerance = Math.max(0, (viewportWidthPx - objectWidthPx) / 2);
  const normalizedTolerance = pixelTolerance / screenWidth;

  return { pixelTolerance, normalizedTolerance };
}

/**
 * Checks if a proposed focal coordinate (cx, cy) keeps the target object within the zoom viewport.
 */
export function isWithinZoomTolerance(
  target: { x: number; y: number },
  proposed: { x: number; y: number },
  scale: number,
  normalizedObjectWidth = 0.15,
): boolean {
  const { normalizedTolerance } = calculateZoomTolerance(scale, normalizedObjectWidth);
  const dx = Math.abs(target.x - proposed.x);
  const dy = Math.abs(target.y - proposed.y);
  return dx <= normalizedTolerance && dy <= normalizedTolerance;
}

/**
 * Parses grounding outputs from VLMs (JSON objects, Gemini 0-1000 arrays, or Grid cell codes).
 */
export function parseGroundingOutput(raw: unknown): GroundingResult {
  if (!raw) {
    return { x: 0.5, y: 0.5, width: 0.2, height: 0.2, confidence: 0, objectPresent: false, source: "fallback" };
  }

  let data: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      // Clean markdown codeblocks if present
      const jsonStr = raw.replace(/```json\s*|\s*```/g, "").trim();
      data = JSON.parse(jsonStr);
    } catch {
      // Regex search for Grid Cell (e.g. "B2")
      const gridMatch = raw.match(/\b([A-C][1-3])\b/i);
      if (gridMatch && gridMatch[1]) {
        const cell = gridMatch[1].toUpperCase();
        const info = GRID_3X3_CELLS[cell];
        if (info) {
          return {
            x: info.x,
            y: info.y,
            width: info.w,
            height: info.h,
            confidence: 0.75,
            gridCell: cell,
            objectPresent: true,
            source: "grid",
          };
        }
      }
      return { x: 0.5, y: 0.5, width: 0.2, height: 0.2, confidence: 0, objectPresent: false, source: "fallback" };
    }
  } else if (typeof raw === "object") {
    data = raw as Record<string, unknown>;
  }

  const objectPresent = Boolean(data.object_present ?? data.objectPresent ?? true);
  const confidence = Number(data.confidence ?? 0.8);

  // 1. Try 0-1000 Bounding Box ([ymin, xmin, ymax, xmax])
  const bbox = data.bbox_2d ?? data.bbox ?? data.box;
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [ymin, xmin, ymax, xmax] = bbox.map(Number);
    if (!isNaN(ymin!) && !isNaN(xmin!) && !isNaN(ymax!) && !isNaN(xmax!)) {
      const normYmin = Math.max(0, Math.min(1000, ymin!)) / 1000;
      const normXmin = Math.max(0, Math.min(1000, xmin!)) / 1000;
      const normYmax = Math.max(0, Math.min(1000, ymax!)) / 1000;
      const normXmax = Math.max(0, Math.min(1000, xmax!)) / 1000;

      const width = Math.max(0.01, normXmax - normXmin);
      const height = Math.max(0.01, normYmax - normYmin);
      const x = normXmin + width / 2;
      const y = normYmin + height / 2;

      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        width,
        height,
        confidence,
        objectPresent,
        source: "bbox",
      };
    }
  }

  // 2. Try Grid Cell ID (e.g. "A2")
  const gridCell = typeof data.grid_cell === "string" ? data.grid_cell.toUpperCase() : typeof data.cell === "string" ? data.cell.toUpperCase() : undefined;
  if (gridCell && GRID_3X3_CELLS[gridCell]) {
    const info = GRID_3X3_CELLS[gridCell]!;
    return {
      x: info.x,
      y: info.y,
      width: info.w,
      height: info.h,
      confidence,
      gridCell,
      objectPresent,
      source: "grid",
    };
  }

  // 3. Try Normalized Direct Center (x, y)
  if (typeof data.x === "number" && typeof data.y === "number") {
    const x = data.x > 1 ? data.x / 1000 : data.x;
    const y = data.y > 1 ? data.y / 1000 : data.y;
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Number(data.w ?? 0.2),
      height: Number(data.h ?? 0.2),
      confidence,
      objectPresent,
      source: "bbox",
    };
  }

  return { x: 0.5, y: 0.5, width: 0.2, height: 0.2, confidence: 0, objectPresent: false, source: "fallback" };
}

/**
 * System prompt template for robust VLM Grounding.
 */
export const GROUNDING_SYSTEM_PROMPT = `
You are a spatial grounding assistant for video editing.
Locate the requested target object or visual element in the provided image.

Return ONLY valid JSON in this schema:
{
  "object_present": boolean,
  "bbox_2d": [ymin, xmin, ymax, xmax], // Normalized integers from 0 to 1000
  "grid_cell": string, // "A1".."A3", "B1".."B3", "C1".."C3" (Row A is top, Col 1 is left)
  "confidence": number // 0.0 to 1.0
}
If the object is not present in the image, set "object_present": false and confidence: 0.
`.trim();

/**
 * Prompt template for the 1-shot Crop-and-Verify feedback loop.
 */
export const CROP_VERIFY_PROMPT = `
Inspect this zoomed crop image. Is the requested target element fully or partially visible inside this crop?
Return ONLY JSON:
{
  "visible": boolean,
  "confidence": number
}
`.trim();
