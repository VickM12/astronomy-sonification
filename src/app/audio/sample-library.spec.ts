import { INSTRUMENTS } from '../sonification/sound-model';
import { SAMPLED_INSTRUMENTS, isSampledInstrument, sampleUrls } from './sample-library';

describe('sample library', () => {
  it('names files the way the sample set stores them', () => {
    const urls = sampleUrls({
      folder: 'clarinet',
      notes: ['D3', 'A#3'],
      release: 0.3,
      bowSeconds: 2,
    });
    expect(urls).toEqual({ D3: 'D3.mp3', 'A#3': 'As3.mp3' });
  });

  it('lists only instruments that exist in the mixer and keeps the synth five synthesized', () => {
    const ids = new Set(INSTRUMENTS.map((item) => item.id));
    for (const id of Object.keys(SAMPLED_INSTRUMENTS)) {
      expect(ids.has(id as (typeof INSTRUMENTS)[number]['id'])).toBe(true);
    }
    for (const synth of ['sine', 'pad', 'bell', 'pluck', 'bass'] as const) {
      expect(isSampledInstrument(synth)).toBe(false);
    }
    expect(isSampledInstrument('cello')).toBe(true);
  });

  it('leaves out the recordings the CDN does not serve', () => {
    // Checked 2026-11-02: these four files return an error from the CDN even
    // though the upstream manifest lists them. Loading them would cost a note.
    expect(SAMPLED_INSTRUMENTS.flute?.notes).not.toContain('A4');
    expect(SAMPLED_INSTRUMENTS.bassoon?.notes).not.toContain('G2');
    expect(SAMPLED_INSTRUMENTS.harp?.notes).not.toContain('E3');
    expect(SAMPLED_INSTRUMENTS.horn?.notes).not.toContain('G2');
  });

  it('spans at least two octaves per instrument so the sampler has a nearby recording', () => {
    for (const spec of Object.values(SAMPLED_INSTRUMENTS)) {
      const octaves = spec.notes.map((note) => Number(note.slice(-1)));
      expect(Math.max(...octaves) - Math.min(...octaves)).toBeGreaterThanOrEqual(2);
    }
  });
});
