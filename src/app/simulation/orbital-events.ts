import { OrbitalEvent } from '../domain/orbital-event';
import { PlanetaryState } from '../domain/planetary-state';
import { addUtcDays, daysBetween } from '../astronomy/time';

const TAU = Math.PI * 2;

export interface LongitudeTrack {
  planetId: string;
  principalRad: number;
  unwrappedRad: number;
  /** Longitude captured when the tracks were created, after a seek or reset. */
  anchorRad: number;
  orbitalPeriodDays: number;
}

export interface DetectionResult {
  events: OrbitalEvent[];
  tracks: LongitudeTrack[];
  omittedCount: number;
}

export interface DetectionOptions {
  maxEvents?: number;
}

export function createTracks(states: readonly PlanetaryState[]): LongitudeTrack[] {
  return states.map((state) => ({
    planetId: state.id,
    principalRad: normalizeLongitude(state.heliocentricLongitudeRad),
    unwrappedRad: normalizeLongitude(state.heliocentricLongitudeRad),
    anchorRad: normalizeLongitude(state.heliocentricLongitudeRad),
    orbitalPeriodDays: state.orbitalPeriodDays,
  }));
}

/**
 * Detect longitude crossings between two samples.
 *
 * The interval is half-open at the start, (previous, next], so a boundary
 * that was the end of the last step is not emitted again.
 * Longitude from the ephemeris is wrapped. The unwrapped change is the
 * wrapped change plus the turn count closest to mean motion
 * `2π * deltaDays / period`. That branch is unique because the equation
 * of the center stays well under half a turn.
 * Event times are the linear longitude fraction between the two samples.
 */
export function detectOrbitalEvents(
  previous: readonly LongitudeTrack[],
  nextStates: readonly PlanetaryState[],
  previousTime: Date,
  nextTime: Date,
  options: DetectionOptions = {},
): DetectionResult {
  const deltaDays = daysBetween(previousTime, nextTime);
  if (deltaDays === 0) {
    return { events: [], tracks: [...previous], omittedCount: 0 };
  }

  const limit = options.maxEvents ?? 5000;
  const previousById = new Map(previous.map((track) => [track.planetId, track]));
  const advanced: AdvancedPlanet[] = [];

  for (const state of nextStates) {
    const track = previousById.get(state.id);
    if (!track) {
      continue;
    }
    const principal = normalizeLongitude(state.heliocentricLongitudeRad);
    const motion = unwrappedMotion(track.principalRad, principal, deltaDays, track.orbitalPeriodDays);
    advanced.push({
      planetId: state.id,
      anchorRad: track.anchorRad,
      previousUnwrapped: track.unwrappedRad,
      nextUnwrapped: track.unwrappedRad + motion,
      nextPrincipal: principal,
      orbitalPeriodDays: state.orbitalPeriodDays,
    });
  }

  const drafts: DraftEvent[] = [];
  let omittedCount = 0;
  const room = (): number => Math.max(0, limit - drafts.length);

  for (const planet of advanced) {
    omittedCount += collectCrossings(
      drafts,
      planet.previousUnwrapped,
      planet.nextUnwrapped,
      0,
      TAU,
      previousTime,
      deltaDays,
      room(),
      (boundary) => ({
        type: 'reference-meridian',
        planetId: planet.planetId,
        longitudeRad: normalizeLongitude(boundary),
      }),
    );
    omittedCount += collectCrossings(
      drafts,
      planet.previousUnwrapped,
      planet.nextUnwrapped,
      planet.anchorRad,
      TAU,
      previousTime,
      deltaDays,
      room(),
      (boundary) => ({
        type: 'revolution',
        planetId: planet.planetId,
        longitudeRad: normalizeLongitude(boundary),
      }),
    );
  }

  for (let index = 0; index < advanced.length; index += 1) {
    for (let other = index + 1; other < advanced.length; other += 1) {
      const first = advanced[index];
      const second = advanced[other];
      const start = first.previousUnwrapped - second.previousUnwrapped;
      const end = first.nextUnwrapped - second.nextUnwrapped;
      omittedCount += collectCrossings(
        drafts,
        start,
        end,
        0,
        TAU,
        previousTime,
        deltaDays,
        room(),
        (boundary) => ({
          type: 'conjunction',
          planetId: first.planetId,
          otherPlanetId: second.planetId,
          longitudeRad: normalizeLongitude(boundary),
        }),
      );
      omittedCount += collectCrossings(
        drafts,
        start,
        end,
        Math.PI,
        TAU,
        previousTime,
        deltaDays,
        room(),
        (boundary) => ({
          type: 'opposition',
          planetId: first.planetId,
          otherPlanetId: second.planetId,
          longitudeRad: normalizeLongitude(boundary),
        }),
      );
    }
  }

  drafts.sort((left, right) => {
    const time = left.simulationTime.getTime() - right.simulationTime.getTime();
    if (time !== 0) {
      return time;
    }
    if (left.planetId !== right.planetId) {
      return left.planetId < right.planetId ? -1 : 1;
    }
    if (left.type !== right.type) {
      return left.type < right.type ? -1 : 1;
    }
    return (left.otherPlanetId ?? '').localeCompare(right.otherPlanetId ?? '');
  });

  return {
    events: drafts,
    tracks: advanced.map((planet) => ({
      planetId: planet.planetId,
      principalRad: planet.nextPrincipal,
      unwrappedRad: planet.nextUnwrapped,
      anchorRad: planet.anchorRad,
      orbitalPeriodDays: planet.orbitalPeriodDays,
    })),
    omittedCount,
  };
}

export function normalizeLongitude(radians: number): number {
  if (!Number.isFinite(radians)) {
    throw new Error('Longitude must be finite.');
  }
  const wrapped = radians % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/**
 * Change in longitude from `previousLongitude` to `nextLongitude`, unwrapped
 * so it stays near the mean-motion expectation for this time step.
 */
export function unwrappedMotion(
  previousLongitude: number,
  nextLongitude: number,
  deltaDays: number,
  orbitalPeriodDays: number,
): number {
  if (!Number.isFinite(orbitalPeriodDays) || orbitalPeriodDays === 0) {
    throw new Error('Orbital period must be a non-zero finite number of days.');
  }
  const shortest = normalizeLongitude(nextLongitude - previousLongitude + Math.PI) - Math.PI;
  const expected = (TAU / orbitalPeriodDays) * deltaDays;
  const turns = Math.round((expected - shortest) / TAU);
  return shortest + turns * TAU;
}

interface AdvancedPlanet {
  planetId: string;
  anchorRad: number;
  previousUnwrapped: number;
  nextUnwrapped: number;
  nextPrincipal: number;
  orbitalPeriodDays: number;
}

interface DraftEvent extends OrbitalEvent {}

function collectCrossings(
  drafts: DraftEvent[],
  start: number,
  end: number,
  origin: number,
  stride: number,
  previousTime: Date,
  deltaDays: number,
  room: number,
  create: (boundary: number) => Omit<DraftEvent, 'simulationTime'>,
): number {
  if (room < 0) {
    return 0;
  }
  const span = end - start;
  if (span === 0) {
    return 0;
  }

  const forward = span > 0;
  const first = forward
    ? Math.floor((start - origin) / stride) + 1
    : Math.ceil((end - origin) / stride);
  const last = forward
    ? Math.floor((end - origin) / stride)
    : Math.ceil((start - origin) / stride) - 1;
  const total = last >= first ? last - first + 1 : 0;
  const emit = Math.min(total, room);

  for (let index = 0; index < emit; index += 1) {
    const step = forward ? first + index : last - index;
    const boundary = origin + stride * step;
    const fraction = (boundary - start) / span;
    drafts.push({
      ...create(boundary),
      simulationTime: addUtcDays(previousTime, deltaDays * clamp01(fraction)),
    });
  }

  return total - emit;
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
