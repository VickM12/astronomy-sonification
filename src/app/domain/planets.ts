export const PLANET_IDS = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
] as const;

export type PlanetId = (typeof PLANET_IDS)[number];

export interface PlanetProfile {
  id: PlanetId;
  name: string;
  swatch: string;
  sceneColor: number;
  /** Scene radius in display units. This is not a physical radius. */
  sceneRadius: number;
}

export const PLANETS: readonly PlanetProfile[] = [
  { id: 'mercury', name: 'Mercury', swatch: '#c5c1b6', sceneColor: 0xc5c1b6, sceneRadius: 0.22 },
  { id: 'venus', name: 'Venus', swatch: '#e6c27a', sceneColor: 0xe6c27a, sceneRadius: 0.32 },
  { id: 'earth', name: 'Earth', swatch: '#6aa6e6', sceneColor: 0x6aa6e6, sceneRadius: 0.34 },
  { id: 'mars', name: 'Mars', swatch: '#d46a4c', sceneColor: 0xd46a4c, sceneRadius: 0.26 },
  { id: 'jupiter', name: 'Jupiter', swatch: '#d4a574', sceneColor: 0xd4a574, sceneRadius: 0.72 },
  { id: 'saturn', name: 'Saturn', swatch: '#e3d2a1', sceneColor: 0xe3d2a1, sceneRadius: 0.62 },
  { id: 'uranus', name: 'Uranus', swatch: '#8fd6cf', sceneColor: 0x8fd6cf, sceneRadius: 0.48 },
  { id: 'neptune', name: 'Neptune', swatch: '#5b7cfa', sceneColor: 0x5b7cfa, sceneRadius: 0.46 },
];

const PROFILES = new Map(PLANETS.map((planet) => [planet.id, planet]));

export function isPlanetId(value: string): value is PlanetId {
  return PROFILES.has(value as PlanetId);
}

export function planetProfile(id: string): PlanetProfile | undefined {
  return PROFILES.get(id as PlanetId);
}

export function planetName(id: string): string {
  return planetProfile(id)?.name ?? id;
}
