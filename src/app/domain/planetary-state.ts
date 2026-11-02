/**
 * Heliocentric state of one planet.
 * Position and velocity are J2000 mean ecliptic (ECL) coordinates:
 * x and y lie in the ecliptic, z points to the north ecliptic pole,
 * and longitude 0 points toward the J2000 mean equinox.
 * Astronomy Engine supplies equatorial J2000 vectors; the astronomy
 * layer rotates both position and velocity into this frame.
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
}
