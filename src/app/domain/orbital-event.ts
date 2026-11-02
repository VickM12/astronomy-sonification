import { isMoonId } from './moons';
import { planetName } from './planets';

/**
 * An event derived from ecliptic longitude.
 * Planets use heliocentric longitude. Galilean moons use jovicentric longitude.
 * `revolution` uses the longitude captured at the last seek or reset.
 * `reference-meridian` uses ecliptic longitude 0, the J2000 mean equinox.
 */
export type OrbitalEventType =
  | 'reference-meridian'
  | 'revolution'
  | 'conjunction'
  | 'opposition';

export interface OrbitalEvent {
  type: OrbitalEventType;
  planetId: string;
  otherPlanetId?: string;
  simulationTime: Date;
  longitudeRad: number;
}

export function describeOrbitalEvent(event: OrbitalEvent): string {
  const when = event.simulationTime.toISOString().replace('.000Z', 'Z');
  switch (event.type) {
    case 'reference-meridian':
      return isMoonId(event.planetId)
        ? `${planetName(event.planetId)} crossed longitude 0° around Jupiter at ${when}`
        : `${planetName(event.planetId)} crossed ecliptic longitude 0° at ${when}`;
    case 'revolution':
      return isMoonId(event.planetId)
        ? `${planetName(event.planetId)} completed a revolution around Jupiter at ${when}`
        : `${planetName(event.planetId)} completed a revolution at ${when}`;
    case 'conjunction':
      return isMoonId(event.planetId)
        ? `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} aligned in longitude around Jupiter at ${when}`
        : `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} aligned in ecliptic longitude at ${when}`;
    case 'opposition':
      return isMoonId(event.planetId)
        ? `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} reached opposite longitudes around Jupiter at ${when}`
        : `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} reached opposite ecliptic longitudes at ${when}`;
  }
}
