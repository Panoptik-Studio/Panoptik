/**
 * Audio panel (Phase 2): import music, adjust volume/fades/ducking, and record
 * voiceover takes. Tracks are project state + OPFS files — the only engine
 * surface used is the helpers already re-exported from @panoptik/engine.
 */
"use client";

import { useRef } from "react";
import { useProjectStore } from "@/stores/projectStore";
import { VoiceoverRecorder } from "@/components/VoiceoverRecorder";
import type { AudioTrack } from "@panoptik/schema";

export function AudioPanel() {
  const project = useProjectStore((s) => s.project);
  const tracks = project?.audioTracks ?? [];
  const addAudioTrack = useProjectStore((s) => s.addAudioTrack);
  const updateAudioTrack = useProjectStore((s) => s.updateAudioTrack);
  const removeAudioTrack = useProjectStore((s) => s.removeAudioTrack);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!project) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <h3 className="pk-ui text-[15px] font-semibold text-pk-ink">Audio</h3>
        <p className="pk-help">Import or record a video to add music or voiceover.</p>
      </div>
    );
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file || !project) return;
    const { decodeViaAudioContext, registerTrackBuffer, saveAudioTrackFile } = await import("@panoptik/engine");
    let buffer: AudioBuffer | null = null;
    try {
      buffer = await decodeViaAudioContext(file);
    } catch {
      alert("Could not decode this audio file in your browser.");
      return;
    }
    if (!buffer) {
      alert("Could not decode this audio file in your browser.");
      return;
    }
    const track: AudioTrack = {
      id: crypto.randomUUID(),
      kind: "music",
      name: file.name,
      src: URL.createObjectURL(file),
      duration: buffer.duration,
      volume: 1,
      startT: useProjectStore.getState().currentTime,
      ducking: 0.6,
    };
    registerTrackBuffer(track.id, buffer);
    addAudioTrack(track);
    try { await saveAudioTrackFile(project.id, track.id, file); } catch { /* best effort */ }
  };

  const onDelete = async (track: AudioTrack) => {
    removeAudioTrack(track.id);
    if (project) {
      const { deleteAudioTrackFile } = await import("@panoptik/engine");
      try { await deleteAudioTrackFile(project.id, track.id); } catch { /* best effort */ }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="pk-ui text-[15px] font-semibold text-pk-ink">Audio</h3>
        <p className="pk-help mt-1">Add background music or record voiceover</p>
      </div>

      <VoiceoverRecorder />

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          onPickFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button className="pk-btn pk-btn-ghost pk-btn-md w-full" onClick={() => fileRef.current?.click()}>
        + Add music
      </button>

      {tracks.length === 0 && (
        <p className="pk-help">No audio tracks yet. Add music or record a voiceover above.</p>
      )}

      {tracks.map((track) => (
        <div key={track.id} className="rounded-[var(--radius-pk-btn)] border border-pk-hairline p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="pk-ui truncate text-[13px] font-medium text-pk-ink" title={track.name}>
              {track.kind === "voiceover" ? "🎙 " : "♪ "}{track.name ?? track.kind}
            </p>
            <button className="pk-icon-btn" aria-label="Delete track" onClick={() => onDelete(track)}>
              ✕
            </button>
          </div>
          <label className="pk-help mt-2 block">
            Volume ({track.volume.toFixed(2)}×)
            <input
              type="range" min={0} max={2} step={0.05} value={track.volume}
              onChange={(e) => updateAudioTrack(track.id, { volume: Number(e.target.value) })}
              className="mt-1 w-full"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <label className="pk-help flex-1">
              Fade in (s)
              <input
                type="number" min={0} max={30} step={0.5} value={track.fadeIn ?? 0}
                onChange={(e) => updateAudioTrack(track.id, { fadeIn: Math.max(0, Number(e.target.value)) })}
                className="mt-1 w-full rounded border border-pk-hairline px-2 py-1 text-[12px]"
              />
            </label>
            <label className="pk-help flex-1">
              Fade out (s)
              <input
                type="number" min={0} max={30} step={0.5} value={track.fadeOut ?? 0}
                onChange={(e) => updateAudioTrack(track.id, { fadeOut: Math.max(0, Number(e.target.value)) })}
                className="mt-1 w-full rounded border border-pk-hairline px-2 py-1 text-[12px]"
              />
            </label>
          </div>
          {track.kind === "music" && (
            <label className="pk-help mt-2 block">
              <span className="flex items-center justify-between">
                Duck under dialogue
                <input
                  type="checkbox"
                  checked={!!track.ducking}
                  onChange={(e) => updateAudioTrack(track.id, { ducking: e.target.checked ? 0.6 : null })}
                />
              </span>
              {!!track.ducking && (
                <input
                  type="range" min={0} max={1} step={0.05} value={track.ducking}
                  onChange={(e) => updateAudioTrack(track.id, { ducking: Number(e.target.value) })}
                  className="mt-1 w-full"
                />
              )}
            </label>
          )}
          <p className="pk-help mt-2">Starts at {track.startT.toFixed(1)}s — drag the block in the timeline to move it.</p>
        </div>
      ))}
    </div>
  );
}
