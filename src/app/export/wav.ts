export interface PcmRecording {
  sampleRate: number;
  channels: readonly (readonly Float32Array[])[];
}

/** Encode planar Float32 chunks as a stereo, 16-bit PCM RIFF/WAVE file. */
export function encodeWav(recording: PcmRecording): Blob {
  const channelCount = Math.max(1, Math.min(2, recording.channels.length));
  const frames = recording.channels[0]?.reduce((sum, chunk) => sum + chunk.length, 0) ?? 0;
  const bytesPerFrame = channelCount * 2;
  const buffer = new ArrayBuffer(44 + frames * bytesPerFrame);
  const view = new DataView(buffer);
  ascii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * bytesPerFrame, true);
  ascii(view, 8, 'WAVE');
  ascii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, recording.sampleRate, true);
  view.setUint32(28, recording.sampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  ascii(view, 36, 'data');
  view.setUint32(40, frames * bytesPerFrame, true);

  const cursors = Array.from({ length: channelCount }, () => ({ chunk: 0, offset: 0 }));
  let output = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const source = recording.channels[channel] ?? recording.channels[0] ?? [];
      const cursor = cursors[channel];
      let chunk = source[cursor?.chunk ?? 0];
      while (cursor && chunk && cursor.offset >= chunk.length) {
        cursor.chunk += 1;
        cursor.offset = 0;
        chunk = source[cursor.chunk];
      }
      const sample = chunk && cursor ? (chunk[cursor.offset++] ?? 0) : 0;
      view.setInt16(output, pcm16(sample), true);
      output += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function pcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
}

function ascii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
