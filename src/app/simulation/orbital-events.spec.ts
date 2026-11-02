import { PlanetaryState } from '../domain/planetary-state';
import { addUtcDays } from '../astronomy/time';
import {
  LongitudeTrack,
  createTracks,
  detectOrbitalEvents,
  normalizeLongitude,
} from './orbital-events';

const TAU = Math.PI * 2;
const PERIOD = 100;
const START = new Date('2000-01-01T00:00:00.000Z');

function stateAt(id: string, longitude: number, time: Date, period = PERIOD): PlanetaryState {
  const wrapped = normalizeLongitude(longitude);
  return {
    id,
    name: id,
    timestamp: time,
    positionAU: { x: Math.cos(wrapped), y: Math.sin(wrapped), z: 0 },
    velocityAUPerDay: { x: 0, y: 0, z: 0 },
    distanceAU: 1,
    speedAUPerDay: 0,
    orbitalPeriodDays: period,
    heliocentricLongitudeRad: wrapped,
  };
}

function step(
  tracks: readonly LongitudeTrack[],
  time: Date,
  days: number,
  maxEvents?: number,
): { tracks: LongitudeTrack[]; time: Date; events: ReturnType<typeof detectOrbitalEvents> } {
  const nextTime = addUtcDays(time, days);
  const states = tracks.map((track) =>
    stateAt(
      track.planetId,
      track.unwrappedRad + (TAU / track.orbitalPeriodDays) * days,
      nextTime,
      track.orbitalPeriodDays,
    ),
  );
  const detected = detectOrbitalEvents(tracks, states, time, nextTime, { maxEvents });
  return { tracks: detected.tracks, time: nextTime, events: detected };
}

function countOf(events: { type: string; planetId: string }[], type: string, planetId: string): number {
  return events.filter((event) => event.type === type && event.planetId === planetId).length;
}

describe('orbital event detection', () => {
  function initial(ids: readonly string[], longitudes: readonly number[], periods?: readonly number[]) {
    return createTracks(
      ids.map((id, index) => stateAt(id, longitudes[index] ?? 0, START, periods?.[index] ?? PERIOD)),
    );
  }

  it('counts a crossing that a single sample step jumps over', () => {
    const tracks = initial(['mercury'], [6]);
    const jumped = step(tracks, START, (0.4 + TAU - 6) * (PERIOD / TAU));
    const meridians = jumped.events.events.filter((event) => event.type === 'reference-meridian');

    expect(meridians).toHaveLength(1);
    expect(meridians[0]?.longitudeRad).toBeCloseTo(0, 8);
    expect(meridians[0]?.simulationTime.getTime()).toBeGreaterThan(START.getTime());
    expect(meridians[0]?.simulationTime.getTime()).toBeLessThanOrEqual(jumped.time.getTime());
  });

  it('matches one coarse step to many fine steps, including a multi-revolution jump', () => {
    const days = 4 * PERIOD + PERIOD / 5;
    const coarse = step(initial(['mercury'], [0.5]), START, days);
    let tracks = initial(['mercury'], [0.5]);
    let time = START;
    const fine = [];
    for (let index = 0; index < 40; index += 1) {
      const next = step(tracks, time, days / 40);
      fine.push(...next.events.events);
      tracks = next.tracks;
      time = next.time;
    }

    expect(countOf(coarse.events.events, 'reference-meridian', 'mercury')).toBe(4);
    expect(countOf(coarse.events.events, 'revolution', 'mercury')).toBe(4);
    expect(fine.filter((event) => event.type === 'reference-meridian')).toHaveLength(4);
    expect(fine.filter((event) => event.type === 'revolution')).toHaveLength(4);

    const coarseTimes = coarse.events.events
      .filter((event) => event.type === 'reference-meridian')
      .map((event) => event.simulationTime.getTime());
    const fineTimes = fine
      .filter((event) => event.type === 'reference-meridian')
      .map((event) => event.simulationTime.getTime());
    coarseTimes.forEach((instant, index) => {
      expect(Math.abs(instant - (fineTimes[index] ?? 0))).toBeLessThan(5);
    });
  });

  it('does not repeat a crossing while motion continues on the same side', () => {
    const tracks = initial(['mercury'], [1]);
    const across = (TAU + 0.5) * (PERIOD / TAU);
    const forward = step(tracks, START, across);
    expect(countOf(forward.events.events, 'reference-meridian', 'mercury')).toBe(1);

    const more = step(forward.tracks, forward.time, 0.2 * (PERIOD / TAU));
    expect(countOf(more.events.events, 'reference-meridian', 'mercury')).toBe(0);

    const back = step(more.tracks, more.time, -2 * (PERIOD / TAU));
    expect(countOf(back.events.events, 'reference-meridian', 'mercury')).toBe(1);

    const backMore = step(back.tracks, back.time, -0.2 * (PERIOD / TAU));
    expect(backMore.events.events).toHaveLength(0);
  });

  it('detects a crossing again after the anchors are reset', () => {
    const tracks = initial(['mercury'], [6.1]);
    const days = (0.3 + TAU - 6.1) * (PERIOD / TAU);
    const first = step(tracks, START, days);
    expect(countOf(first.events.events, 'reference-meridian', 'mercury')).toBe(1);

    const reset = createTracks([
      stateAt('mercury', tracks[0]?.unwrappedRad ?? 0, START),
    ]);
    const second = step(reset, START, days);
    expect(countOf(second.events.events, 'reference-meridian', 'mercury')).toBe(1);
  });

  it('reports simultaneous meridian crossings and a conjunction in the same step', () => {
    const days = 0.25 * (PERIOD / TAU);
    const tracks = createTracks([
      stateAt('mercury', TAU - 0.1, START, PERIOD),
      stateAt('venus', TAU - 0.1, START, PERIOD),
    ]);
    const moved = step(tracks, START, days);
    const meridians = moved.events.events.filter((event) => event.type === 'reference-meridian');
    expect(meridians.map((event) => event.planetId)).toEqual(['mercury', 'venus']);
    expect(meridians[0]?.simulationTime.getTime()).toBe(meridians[1]?.simulationTime.getTime());

    const conjunctionDays = 0.3 * (100 / TAU);
    const periodB = (TAU * conjunctionDays) / 0.01;
    const pair = createTracks([
      stateAt('mercury', 6.2, START, 100),
      stateAt('venus', 0.05, START, periodB),
    ]);
    const aligned = step(pair, START, conjunctionDays);
    const conjunctions = aligned.events.events.filter((event) => event.type === 'conjunction');
    expect(conjunctions).toHaveLength(1);
    expect(conjunctions[0]?.otherPlanetId).toBe('venus');
    expect(aligned.events.events.some((event) => event.type === 'reference-meridian')).toBe(true);
  });

  it('does not pair a jovicentric moon with a heliocentric planet', () => {
    const tracks = createTracks([
      stateAt('earth', 0, START, 365),
      { ...stateAt('io', 0.2, START, 1.769138), frame: 'jovicentric' },
    ]);
    const nextTime = addUtcDays(START, 1);
    const detected = detectOrbitalEvents(
      tracks,
      [
        stateAt('earth', 0.01, nextTime, 365),
        { ...stateAt('io', Math.PI, nextTime, 1.769138), frame: 'jovicentric' },
      ],
      START,
      nextTime,
    );
    const alignments = detected.events.filter(
      (event) => event.type === 'conjunction' || event.type === 'opposition',
    );
    expect(alignments).toEqual([]);
    expect(detected.tracks.find((track) => track.planetId === 'io')?.frame).toBe('jovicentric');
  });

  it('keeps a large jump finite when the event list is capped', () => {
    const detected = step(initial(['mercury'], [0.2]), START, 10 * PERIOD + 1, 3);
    expect(detected.events.events).toHaveLength(3);
    expect(detected.events.omittedCount).toBe(17);
  });
});
