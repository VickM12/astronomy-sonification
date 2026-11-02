import { PlanetId } from '../domain/planets';

/**
 * Sidereal orbital periods in Earth days.
 *
 * Source: NASA Goddard NSSDCA planetary fact sheets, "Sidereal orbit period (days)",
 * retrieved 1 November 2026:
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *
 * The summary fact sheet's "Orbital Period" column is the tropical period
 * (vernal equinox to vernal equinox). These constants are the sidereal periods
 * from the individual fact sheets, because a revolution in the inertial
 * J2000 ecliptic is measured against the stars, not the moving equinox.
 *
 *   Mercury  87.969
 *   Venus    224.701
 *   Earth    365.256
 *   Mars     686.980
 *   Jupiter  4,332.589
 *   Saturn   10,755.699
 *   Uranus   30,685.4
 *   Neptune  60,189.018
 */
export const SIDEREAL_ORBITAL_PERIOD_DAYS: Readonly<Record<PlanetId, number>> = {
  mercury: 87.969,
  venus: 224.701,
  earth: 365.256,
  mars: 686.98,
  jupiter: 4332.589,
  saturn: 10755.699,
  uranus: 30685.4,
  neptune: 60189.018,
};

export const ORBITAL_PERIOD_SOURCE =
  'NASA NSSDCA planetary fact sheets, sidereal orbit period (days), retrieved 2026-11-01';

export function siderealPeriodDays(planetId: PlanetId): number {
  return SIDEREAL_ORBITAL_PERIOD_DAYS[planetId];
}
