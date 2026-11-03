import { PlanetId } from '../domain/planets';

/**
 * J2000 approximate orbital elements from NASA/JPL,
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html (retrieved 2026-11-02).
 * These constants normalize creative audio mappings; calculated positions still
 * come from Astronomy Engine.
 */
export const ORBITAL_ELEMENTS: Readonly<
  Record<PlanetId, { semiMajorAxisAU: number; eccentricity: number }>
> = {
  mercury: { semiMajorAxisAU: 0.38709927, eccentricity: 0.20563593 },
  venus: { semiMajorAxisAU: 0.72333566, eccentricity: 0.00677672 },
  earth: { semiMajorAxisAU: 1.00000261, eccentricity: 0.01671123 },
  mars: { semiMajorAxisAU: 1.52371034, eccentricity: 0.0933941 },
  jupiter: { semiMajorAxisAU: 5.202887, eccentricity: 0.04838624 },
  saturn: { semiMajorAxisAU: 9.53667594, eccentricity: 0.05386179 },
  uranus: { semiMajorAxisAU: 19.18916464, eccentricity: 0.04725744 },
  neptune: { semiMajorAxisAU: 30.06992276, eccentricity: 0.00859048 },
};
