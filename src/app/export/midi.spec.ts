import { buildMidi, ticksAt } from './midi';
import { RecordedPerformance } from './performance-capture';

describe('MIDI export', () => {
  it('writes format 1 with tempo, program, note-on, and note-off events', () => {
    const take: RecordedPerformance = {
      startIso: '2026-01-01T00:00:00Z',
      endIso: '2026-01-02T00:00:00Z',
      durationSeconds: 2,
      simulatedSpanDays: 1,
      texture: 'continuous',
      voices: [
        {
          id: 'earth',
          points: [
            {
              second: 0,
              simulatedDay: 0,
              hz: 440,
              midi: 69,
              note: 'A4',
              instrument: 'strings',
              gain: 0.5,
              filterHz: 3200,
              resonance: 1,
              pan: 0.25,
              angularRatio: 1,
              detuneCents: 0,
            },
          ],
        },
      ],
      notes: [
        {
          bodyId: 'earth',
          second: 0,
          simulatedDay: 0,
          durationSeconds: 1,
          hz: 440,
          midi: 69,
          note: 'A4',
          instrument: 'strings',
          gain: 0.5,
          filterHz: 3200,
          resonance: 1,
          pan: 0.25,
          angularRatio: 1,
          detuneCents: 0,
          kind: 'drone',
        },
      ],
      marks: [],
      tempos: [{ second: 0, bpm: 60 }],
      wav: new Blob(),
    };
    const midi = buildMidi(take);
    expect(new TextDecoder().decode(midi.slice(0, 4))).toBe('MThd');
    expect([...midi]).toContain(0x51);
    expect([...midi]).toContain(0xc0);
    expect([...midi]).toContain(0x90);
    expect([...midi]).toContain(0x80);
    expect([...midi]).toContain(10);
    expect([...midi]).toContain(71);
    expect([...midi]).toContain(74);
    expect(ticksAt(1, take.tempos)).toBe(480);
  });

  it('integrates tempo changes into the tick timeline', () => {
    expect(
      ticksAt(2, [
        { second: 0, bpm: 60 },
        { second: 1, bpm: 120 },
      ]),
    ).toBe(1440);
  });
});
