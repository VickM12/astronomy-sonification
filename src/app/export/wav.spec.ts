import { encodeWav } from './wav';

describe('encodeWav', () => {
  it('writes stereo 16-bit PCM with a valid RIFF header', async () => {
    const blob = encodeWav({
      sampleRate: 48000,
      channels: [[new Float32Array([-1, 0.5])], [new Float32Array([1, -0.5])]],
    });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(32767);
  });
});
