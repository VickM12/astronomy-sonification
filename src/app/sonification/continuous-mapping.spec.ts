import { PlanetaryState } from '../domain/planetary-state';
import { conjunctionCloseness, continuousParameters, solarProximity } from './continuous-mapping';

describe('continuous orbital mappings', () => {
  it('bounds distance, pan, filter, resonance, and relationship detune', () => {
    const states = [
      state('mercury', 0.31, 0),
      state('venus', 0.72, 0.02),
      state('earth', 1, 0.1),
      state('mars', 1.5, 0.12),
      state('jupiter', 5.2, 1),
      state('saturn', 9.5, 1.1),
    ];
    const mapped = continuousParameters(states, new Set(states.map((item) => item.id)), 0.65, 1);
    for (const item of mapped) {
      expect(item.filterHz).toBeGreaterThanOrEqual(500);
      expect(item.filterHz).toBeLessThanOrEqual(7000);
      expect(item.pan).toBeGreaterThanOrEqual(-1);
      expect(item.pan).toBeLessThanOrEqual(1);
      expect(item.resonance).toBeLessThanOrEqual(8);
      expect(Math.abs(item.detuneCents)).toBeLessThanOrEqual(6);
    }
    expect(mapped.find((item) => item.id === 'venus')?.gainMultiplier).toBeGreaterThan(1);
    expect(mapped.find((item) => item.id === 'jupiter')?.resonance).toBeGreaterThan(0.7);
    expect(mapped.find((item) => item.id === 'earth')?.resonance).toBeGreaterThan(0.7);
  });

  it('maps perihelion bright, aphelion dark, and conjunctions smoothly', () => {
    const elements = { semiMajorAxisAU: 1, eccentricity: 0.1 };
    expect(solarProximity(0.9, elements)).toBeCloseTo(1);
    expect(solarProximity(1.1, elements)).toBeCloseTo(0);
    expect(conjunctionCloseness(0)).toBe(1);
    expect(conjunctionCloseness(Math.PI / 12)).toBe(0);
  });
});

function state(id: string, distanceAU: number, longitude: number): PlanetaryState {
  return {
    id,
    name: id,
    timestamp: new Date(0),
    positionAU: { x: distanceAU * Math.cos(longitude), y: distanceAU * Math.sin(longitude), z: 0 },
    velocityAUPerDay: { x: 0, y: 0.02, z: 0 },
    distanceAU,
    speedAUPerDay: 0.02,
    orbitalPeriodDays: id === 'mercury' ? 87.97 : 365.25,
    heliocentricLongitudeRad: longitude,
  };
}
