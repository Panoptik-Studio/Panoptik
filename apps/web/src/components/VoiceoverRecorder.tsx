/**
 * Records a narration take over the timeline and lands it as a voiceover
 * AudioTrack at the playhead. Recording runs until Stop is pressed — it does
 * not follow playback pause, which keeps the UI honest and simple.
 */
"use client";

import { useRef, useState } from "react";
import { useProjectStore } from "@/stores/projectStore";

export function VoiceoverRecorder() {
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const startedWallRef = useRef(0);
  const countRef = useRef(0);

  const start = async () => {
    const state = useProjectStore.getState();
    if (!state.project) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      alert("Microphone permission is required to record a voiceover.");
      return;
    }
    const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    chunksRef.current = [];
    startedAtRef.current = state.currentTime;
    startedWallRef.current = Date.now();
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const startT = startedAtRef.current;
      const fallbackDur = (Date.now() - startedWallRef.current) / 1000;
      const projectId = useProjectStore.getState().project?.id;
      const { decodeViaAudioContext, registerTrackBuffer, saveAudioTrackFile } = await import("@panoptik/engine");
      const track = {
        id: crypto.randomUUID(),
        kind: "voiceover" as const,
        name: `Voiceover ${++countRef.current}`,
        src: URL.createObjectURL(blob),
        duration: fallbackDur,
        volume: 1,
        startT,
      };
      try {
        const buf = await decodeViaAudioContext(blob);
        if (buf) {
          track.duration = buf.duration;
          registerTrackBuffer(track.id, buf);
        }
      } catch {
        /* keep fallback duration; export decodes from src on demand */
      }
      useProjectStore.getState().addAudioTrack(track);
      if (projectId) {
        try { await saveAudioTrackFile(projectId, track.id, blob); } catch { /* best effort */ }
      }
    };
    recorderRef.current = rec;
    rec.start();
    setRecording(true);
    // Roll the timeline from the playhead so the take lines up with the video.
    const s = useProjectStore.getState();
    if (!s.isPlaying) s.togglePlay();
  };

  const stop = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <button
      className={`pk-btn pk-btn-md w-full ${recording ? "pk-btn-danger" : "pk-btn-ghost"}`}
      onClick={recording ? stop : start}
    >
      {recording ? "■ Stop recording" : "● Record voiceover"}
    </button>
  );
}
