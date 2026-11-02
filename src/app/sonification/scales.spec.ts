import { midiToFrequency, nearestScaleMidi, noteName, quantizeFrequency, separateOctaves } from './scales';

describe('scales', () => {
  it('quantizes chromatic pitches to the nearest MIDI note', () => {
    expect(quantizeFrequency(440, 'chromatic', 0)).toEqual({ frequencyHz: 440, midi: 69 });
    expect(noteName(69)).toBe('A4');
    const midi = 69 + 12 * Math.log2(450 / 440);
    expect(Math.round(midi)).toBe(69);
    expect(quantizeFrequency(450, 'chromatic', 0).midi).toBe(69);
  });

  it('resolves an equal scale distance toward the lower note', () => {
    expect(quantizeFrequency(midiToFrequency(63), 'major', 0).midi).toBe(62);
    expect(quantizeFrequency(midiToFrequency(61), 'pentatonic', 0).midi).toBe(60);
    expect(quantizeFrequency(midiToFrequency(68), 'major', 7).midi).toBe(67);
    expect(nearestScaleMidi(60, 'natural-minor', 0)).toBe(60);
  });

  it('spreads later voices by whole octaves and leaves intensity 0 untouched', () => {
    expect(separateOctaves([440, 466], 0)).toEqual([440, 466]);
    const spread = separateOctaves([440, 440], 1);
    expect(spread[0]).toBeCloseTo(440, 6);
    expect(spread[1]).toBeCloseTo(880, 6);
    expect(separateOctaves([440, 440], 1)).toEqual(spread);
  });
});
