import type { Project, Segment } from "@panoptik/schema";

export function segmentDuration(seg: Segment): number {
  return (seg.srcEnd - seg.srcStart) / seg.speed;
}

export function projectDuration(project: Project): number {
  return project.segments.reduce((acc, s) => acc + segmentDuration(s), 0);
}

export function resolveSegment(
  project: Project,
  timelineT: number,
): { segment: Segment; srcT: number } | null {
  let acc = 0;
  for (const seg of project.segments) {
    const d = segmentDuration(seg);
    if (timelineT <= acc + d) {
      return { segment: seg, srcT: seg.srcStart + Math.max(0, timelineT - acc) * seg.speed };
    }
    acc += d;
  }
  return null;
}

export function sourceToTimeline(
  project: Project,
  segmentId: string,
  srcT: number,
): number | null {
  let acc = 0;
  for (const seg of project.segments) {
    if (seg.id === segmentId) {
      if (srcT < seg.srcStart || srcT > seg.srcEnd) return null;
      return acc + (srcT - seg.srcStart) / seg.speed;
    }
    acc += segmentDuration(seg);
  }
  return null;
}
