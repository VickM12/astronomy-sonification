import { PerformanceCaptureService } from './performance-capture';

describe('PerformanceCaptureService', () => {
  it('captures changed drones and accepted pulses on one bounded timeline', () => {
    const capture = new PerformanceCaptureService();
    const start = new Date('2026-01-01T00:00:00Z');
    capture.begin(10, start, 72);
    capture.captureDrones(10, start, [
      { planetId: 'earth', frequencyHz: 440, gain: 0.2, instrument: 'strings' },
    ]);
    capture.captureDrones(10.05, start, [
      { planetId: 'earth', frequencyHz: 440, gain: 0.2, instrument: 'strings' },
    ]);
    capture.captureDrones(10.5, start, [
      { planetId: 'earth', frequencyHz: 440, gain: 0.4, instrument: 'strings' },
    ]);
    capture.captureTempo(11, 96);
    capture.capturePulses([
      {
        planetId: 'mars',
        frequencyHz: 220,
        gain: 0.3,
        durationSeconds: 0.5,
        when: 11,
        instrument: 'trumpet',
        eventType: 'reference-meridian',
        eventTimeIso: '2026-01-02T00:00:00.000Z',
      },
    ]);
    const take = capture.finish(12, new Date('2026-01-03T00:00:00Z'), new Blob());
    expect(take?.durationSeconds).toBe(2);
    expect(take?.voices.find((voice) => voice.id === 'earth')?.points).toHaveLength(2);
    expect(take?.notes.map((note) => note.kind)).toEqual(['drone', 'drone', 'pulse']);
    expect(take?.notes[0]?.durationSeconds).toBe(0.5);
    expect(take?.notes[1]?.gain).toBe(0.4);
    expect(take?.marks[0]?.bodyIds).toEqual(['mars']);
    expect(take?.tempos.map((tempo) => tempo.bpm)).toEqual([72, 96]);
  });
});
