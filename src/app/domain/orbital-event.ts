import { planetName } from './planets';

/**
 * An event derived from heliocentric ecliptic longitude.
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
      return `${planetName(event.planetId)} crossed ecliptic longitude 0° at ${when}`;
    case 'revolution':
      return `${planetName(event.planetId)} completed a revolution at ${when}`;
    case 'conjunction':
      return `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} aligned in ecliptic longitude at ${when}`;
    case 'opposition':
      return `${planetName(event.planetId)} and ${planetName(event.otherPlanetId ?? '')} reached opposite ecliptic longitudes at ${when}`;
  }
}
