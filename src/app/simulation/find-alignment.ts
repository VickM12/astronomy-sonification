import { AstronomyService } from '../astronomy/astronomy.service';
import { addUtcDays } from '../astronomy/time';
import { OrbitalEvent } from '../domain/orbital-event';
import { isPlanetId } from '../domain/planets';
import { createTracks, detectOrbitalEvents } from './orbital-events';

const STEP_DAYS = 20;
const MAX_DAYS = 800;

/**
 * Earliest planet–planet conjunction or opposition after `start`.
 * Moon crossings are left out: their periods would land the jump a few hours ahead.
 * The search uses planet states only, in steps coarse enough that a crossing
 * inside the interval is still reported by the longitude detector.
 */
export function findNextAlignment(
  astronomy: Pick<AstronomyService, 'getStates'>,
  start: Date,
  options?: { stepDays?: number; maxDays?: number },
): OrbitalEvent | null {
  const stepDays = options?.stepDays ?? STEP_DAYS;
  const maxDays = options?.maxDays ?? MAX_DAYS;
  let previousTime = start;
  let tracks = createTracks(astronomy.getStates(start));

  for (let elapsed = stepDays; elapsed <= maxDays + 1e-9; elapsed += stepDays) {
    const nextTime = addUtcDays(start, elapsed);
    const states = astronomy.getStates(nextTime);
    const detected = detectOrbitalEvents(tracks, states, previousTime, nextTime);
    let earliest: OrbitalEvent | null = null;
    for (const event of detected.events) {
      if (event.type !== 'conjunction' && event.type !== 'opposition') {
        continue;
      }
      if (!isPlanetId(event.planetId) || !event.otherPlanetId || !isPlanetId(event.otherPlanetId)) {
        continue;
      }
      if (!earliest || event.simulationTime.getTime() < earliest.simulationTime.getTime()) {
        earliest = event;
      }
    }
    if (earliest) {
      return earliest;
    }
    tracks = detected.tracks;
    previousTime = nextTime;
  }

  return null;
}
