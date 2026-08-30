/**
 * Formats a clean, human-readable date & time project title for new clips/recordings.
 * Avoids generic "Untitled" placeholders.
 */
export function formatDefaultProjectName(
  kind: "recording" | "clip" = "recording",
  date: Date | number = new Date(),
): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const dStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const tStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const prefix = kind === "recording" ? "Recording" : "Clip";
  return `${prefix} · ${dStr}, ${tStr}`;
}
