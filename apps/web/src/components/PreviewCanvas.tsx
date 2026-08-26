/**
 * OWNER: DEV A — basic preview canvas with drop zone + playback loop.
 * Self-contained internal playback state (no store coupling).
 * Dev B: take over this file and move playback state to shared store when
 * your Timeline component needs to read/write the same currentTime/playing.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { engine } from "@/lib/engineProvider";
import type { Project } from "@panoptik/schema";

export function PreviewCanvas() {
  const [project, setProject] = useState<Project | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  // ── Playback loop ──
  useEffect(() => {
    if (!playing || !project) return;
    lastRef.current = performance.now();

    const tick = async (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setCurrentTime((prev) => {
        const next = prev + dt;
        return next >= project.clip.duration ? project.clip.duration : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, project]);

  // ── Render loop (decouple from state updates via ref) ──
  const projectRef = useRef(project);
  const timeRef = useRef(currentTime);
  projectRef.current = project;
  timeRef.current = currentTime;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !project) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;
    const draw = async () => {
      if (!running || !projectRef.current) return;
      await engine.prepareFrame(timeRef.current);
      engine.renderFrame(ctx, projectRef.current, timeRef.current);
      requestAnimationFrame(draw);
    };
    draw();
    return () => { running = false; };
  }, [project]);

  // ── Drop handler ──
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const proj = await engine.loadClip(file);
    setProject(proj);
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const proj = await engine.loadClip(file);
    setProject(proj);
    setCurrentTime(0);
    setPlaying(false);
  }, []);

  // ── No project: show drop zone ──
  if (!project) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-gray-600 bg-gray-900/50"
      >
        <p className="text-sm text-gray-400">Drag a clip here</p>
        <label className="cursor-pointer rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500">
          Choose file
          <input type="file" accept="video/*" className="hidden" onChange={handleFile} />
        </label>
      </div>
    );
  }

  // ── Loaded: canvas + controls ──
  const duration = project.clip.duration;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex flex-1 items-center justify-center bg-black">
        <canvas
          ref={canvasRef}
          width={project.clip.width}
          height={project.clip.height}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex items-center gap-3 border-t border-gray-800 px-3 py-2">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="rounded bg-gray-700 px-2 py-1 text-xs text-white hover:bg-gray-600"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration}
          step={0.01}
          value={currentTime}
          onChange={(e) => setCurrentTime(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-16 text-right text-xs text-gray-400">
          {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
