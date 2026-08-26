/**
 * OWNER: DEV B — ROADMAP-B.md Task 3.1.
 * AudioBuffer → mono Float32Array @16kHz via OfflineAudioContext resample.
 * Used to feed Whisper worker which requires Float32 PCM @16kHz.
 */

export async function extractMono16k(
  buffer: AudioBuffer,
): Promise<Float32Array> {
  const sampleRate = 16000;
  const numFrames = Math.ceil(buffer.duration * sampleRate);

  const offline = new OfflineAudioContext(
    1,
    numFrames,
    sampleRate,
  );

  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  // Float32Array copy (detached from AudioBuffer)
  return new Float32Array(rendered.getChannelData(0));
}
