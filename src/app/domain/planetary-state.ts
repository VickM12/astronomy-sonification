import { OrbitFrame } from './moons';

/**
 * State of one planet or Galilean moon.
 * Position and velocity are J2000 mean ecliptic (ECL) coordinates:
 * x and y lie in the ecliptic, z points to the north ecliptic pole,
 * and longitude 0 points toward the J2000 mean equinox.
 * Astronomy Engine supplies equatorial J2000 vectors; the astronomy
 * layer rotates both position and velocity into this frame.
 * Planets are heliocentric. Moons are jovicentric: `positionAU` is the
 * vector from Jupiter's center, and `heliocentricLongitudeRad` is that
 * vector's ecliptic longitude measured from Jupiter.
 */
export interface PlanetaryState {
  id: string;
  name: string;
  timestamp: Date;
  positionAU: {
    x: number;
    y: number;
    z: number;
  };
  velocityAUPerDay: {
    x: number;
    y: number;
    z: number;
  };
  distanceAU: number;
  speedAUPerDay: number;
  orbitalPeriodDays: number;
  heliocentricLongitudeRad: number;
  /** Absent means heliocentric, so older planet-only states stay valid. */
  frame?: OrbitFrame;
}
