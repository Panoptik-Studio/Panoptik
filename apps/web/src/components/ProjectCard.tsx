/**
 * One clip in the library grid.
 *
 * The thumbnail is the expensive part: decoding every project's video on page
 * load would stall the whole grid, so a card only reaches for its poster once
 * it scrolls into view, and the frame it grabs is written back to OPFS so the
 * next visit is instant.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@panoptik/engine";

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return `${Math.round(n / 1e6)} MB`;
}

function formatWhen(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Grab a representative frame from a clip.
 *
 * Seeks a little way in rather than to 0 — recordings often open on a blank
 * screen or a camera still warming up, which makes for a useless thumbnail.
 */
async function grabPoster(blob: Blob, duration: number): Promise<Blob | null> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      };
      const timer = setTimeout(done, 5000);
      video.addEventListener("seeked", done, { once: true });
      video.addEventListener("error", done, { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          const target = Math.min(Number.isFinite(duration) && duration > 0 ? duration * 0.15 : 1, 3);
          video.currentTime = target;
        },
        { once: true },
      );
    });

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // Cards are small; a full-resolution poster would cost more to store than
    // the frame is worth.
    const scale = Math.min(1, 640 / w);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.72);
    });
  } catch {
    return null;
  } finally {
    video.src = "";
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function ProjectCard({
  summary,
  onOpen,
  onDelete,
  onRename,
}: {
  summary: ProjectSummary;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename?: (id: string, newName: string) => void;
}) {
  const [poster, setPoster] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameInput, setNameInput] = useState(summary.name);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const posterUrlRef = useRef<string | null>(null);

  useEffect(() => {
    setNameInput(summary.name);
  }, [summary.name]);

  // Only fetch a thumbnail once the card is actually on screen.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;

    (async () => {
      const { loadPoster, loadProjectRecord, savePoster } = await import("@panoptik/engine");

      const cached = await loadPoster(summary.id);
      if (cancelled) return;
      if (cached) {
        const url = URL.createObjectURL(cached);
        posterUrlRef.current = url;
        setPoster(url);
        return;
      }

      // No poster yet — decode one frame and keep it for next time.
      const record = await loadProjectRecord(summary.id);
      if (cancelled || !record?.media) return;
      const shot = await grabPoster(record.media, summary.duration);
      if (cancelled || !shot) return;
      await savePoster(summary.id, shot);
      if (cancelled) return;
      const url = URL.createObjectURL(shot);
      posterUrlRef.current = url;
      setPoster(url);
    })().catch(() => {
      /* the card falls back to its placeholder */
    });

    return () => {
      cancelled = true;
    };
  }, [visible, summary.id, summary.duration]);

  // Release the poster URL when the card goes away.
  useEffect(
    () => () => {
      if (posterUrlRef.current) URL.revokeObjectURL(posterUrlRef.current);
      posterUrlRef.current = null;
    },
    [],
  );

  const open = useCallback(() => onOpen(summary.id), [onOpen, summary.id]);

  return (
    <div ref={cardRef} className="group flex flex-col gap-2.5">
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
        className="relative aspect-video w-full cursor-pointer overflow-hidden rounded-[var(--radius-pk-card)] border border-pk-hairline bg-pk-surface-soft transition-all group-hover:border-pk-blue group-hover:shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      >
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center" style={{ color: "var(--color-pk-faint)" }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </svg>
          </div>
        )}

        <span className="pk-ui absolute bottom-2 right-2 rounded-md bg-black/78 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {formatDuration(summary.duration)}
        </span>

        {!summary.exportedAt && (
          <span className="pk-chip pk-chip-amber absolute left-2 top-2">Draft</span>
        )}

        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="pk-ui rounded-[var(--radius-pk-btn)] bg-white px-4 py-2 text-[13px] font-medium text-pk-ink">
            Open in editor
          </span>
        </span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <div className="flex items-center gap-1 pt-0.5">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const trimmed = nameInput.trim();
                    if (trimmed && trimmed !== summary.name) onRename?.(summary.id, trimmed);
                    setIsRenaming(false);
                  } else if (e.key === "Escape") {
                    setNameInput(summary.name);
                    setIsRenaming(false);
                  }
                }}
                className="pk-input text-xs py-0.5 px-1.5 w-full"
                autoFocus
              />
              <button
                onClick={() => {
                  const trimmed = nameInput.trim();
                  if (trimmed && trimmed !== summary.name) onRename?.(summary.id, trimmed);
                  setIsRenaming(false);
                }}
                className="pk-btn pk-btn-primary pk-btn-sm h-6 px-2 text-[11px]"
                title="Save name"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setNameInput(summary.name);
                  setIsRenaming(false);
                }}
                className="pk-btn pk-btn-ghost pk-btn-sm h-6 px-1.5 text-[11px]"
                title="Cancel"
              >
                ✕
              </button>
            </div>
          ) : (
            <>
              <p
                className="pk-ui truncate text-[13.5px] font-medium text-pk-ink"
                title={summary.name}
              >
                {summary.name}
              </p>
              <p className="pk-help mt-0.5">
                {summary.width}×{summary.height} · {formatBytes(summary.bytes)} · {formatWhen(summary.updatedAt)}
              </p>
            </>
          )}
        </div>

        {confirming ? (
          <div className="flex shrink-0 gap-1">
            <button
              className="pk-btn pk-btn-danger pk-btn-sm"
              onClick={() => {
                setConfirming(false);
                onDelete(summary.id);
              }}
            >
              Delete
            </button>
            <button className="pk-btn pk-btn-ghost pk-btn-sm" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        ) : !isRenaming ? (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              className="pk-icon-btn h-7 w-7 text-pk-faint hover:text-[#0070f3]"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  const { loadProject, downloadProjectPackage } = await import("@panoptik/engine");
                  const proj = await loadProject(summary.id);
                  if (proj) await downloadProjectPackage(proj);
                } catch (err) {
                  console.error("Export project failed", err);
                }
              }}
              title={`Export ${summary.name} (.panoptik)`}
              aria-label={`Export ${summary.name}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <button
              className="pk-icon-btn h-7 w-7 text-pk-faint hover:text-[#0070f3]"
              onClick={() => {
                setNameInput(summary.name);
                setIsRenaming(true);
              }}
              title={`Rename ${summary.name}`}
              aria-label={`Rename ${summary.name}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
            <button
              className="pk-icon-btn h-7 w-7 text-pk-faint hover:text-red-500"
              onClick={() => setConfirming(true)}
              title={`Delete ${summary.name}`}
              aria-label={`Delete ${summary.name}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
