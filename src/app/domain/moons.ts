import type { PlanetId } from './planets';

export const MOON_IDS = ['io', 'europa', 'ganymede', 'callisto'] as const;

export type MoonId = (typeof MOON_IDS)[number];

export type AudibleId = PlanetId | MoonId;

export type OrbitFrame = 'heliocentric' | 'jovicentric';

/**
 * NASA NSSDCA Jovian Satellite Fact Sheet, column "Orbital Period (days)",
 * retrieved 2026-11-02.
 * https://nssdc.gsfc.nasa.gov/planetary/factsheet/joviansatfact.html
 * These are that sheet's orbital periods, not a fitted 4:2:1.
 */
export const MOON_ORBITAL_PERIOD_DAYS: Record<MoonId, number> = {
  io: 1.769138,
  europa: 3.551181,
  ganymede: 7.154553,
  callisto: 16.689017,
};

export const MOON_PERIOD_SOURCE =
  'NASA NSSDCA Jovian Satellite Fact Sheet, Orbital Period (days), retrieved 2026-11-02. https://nssdc.gsfc.nasa.gov/planetary/factsheet/joviansatfact.html';

export interface MoonProfile {
  id: MoonId;
  name: string;
  swatch: string;
  sceneColor: number;
  /** Scene radius in display units. This is not a physical radius. */
  sceneRadius: number;
}

export const MOONS: readonly MoonProfile[] = [
  { id: 'io', name: 'Io', swatch: '#f2e27a', sceneColor: 0xf2e27a, sceneRadius: 0.09 },
  { id: 'europa', name: 'Europa', swatch: '#d7e4ef', sceneColor: 0xd7e4ef, sceneRadius: 0.08 },
  { id: 'ganymede', name: 'Ganymede', swatch: '#c4a882', sceneColor: 0xc4a882, sceneRadius: 0.11 },
  { id: 'callisto', name: 'Callisto', swatch: '#8a8178', sceneColor: 0x8a8178, sceneRadius: 0.1 },
];

const PROFILES = new Map(MOONS.map((moon) => [moon.id, moon]));

export function isMoonId(value: string): value is MoonId {
  return PROFILES.has(value as MoonId);
}

export function moonProfile(id: string): MoonProfile | undefined {
  return PROFILES.get(id as MoonId);
}

export function moonPeriodDays(id: MoonId): number {
  return MOON_ORBITAL_PERIOD_DAYS[id];
}
