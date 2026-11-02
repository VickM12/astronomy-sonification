import { AstronomyService } from './astronomy.service';
import { SIDEREAL_ORBITAL_PERIOD_DAYS } from './orbital-periods';
import { UnsupportedDateError, addUtcDays, parseUtcInstant } from './time';
import { eclipticLongitudeRad, vectorLength } from './vectors';

const J2000 = new Date('2000-01-01T12:00:00.000Z');

describe('AstronomyService', () => {
  const service = new AstronomyService();

  it('matches the J2000 Earth ecliptic state from astronomy-engine 2.1.19', () => {
    const earth = service.getState('earth', J2000);

    expect(earth.positionAU.x).toBeCloseTo(-0.1771428212924881, 9);
    expect(earth.positionAU.y).toBeCloseTo(0.9672262338014109, 9);
    expect(earth.positionAU.z).toBeCloseTo(-1.9283128094294e-8, 12);
    expect(earth.velocityAUPerDay.x).toBeCloseTo(-0.01720730574677842, 10);
    expect(earth.velocityAUPerDay.y).toBeCloseTo(-0.0031589079958001826, 10);
    expect(earth.velocityAUPerDay.z).toBeCloseTo(-9.338860755027378e-9, 12);
    expect(earth.distanceAU).toBeCloseTo(0.9833138697735959, 9);
    expect((earth.heliocentricLongitudeRad * 180) / Math.PI).toBeCloseTo(100.37842755377832, 6);
    expect(earth.timestamp).toBe(J2000);
  });

  it('derives distance, speed, and longitude from the state vector', () => {
    const states = service.getStates(new Date('2026-11-01T00:00:00.000Z'));
    expect(states.map((state) => state.id)).toEqual([
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ]);

    for (const state of states) {
      expect(state.distanceAU).toBeCloseTo(vectorLength(state.positionAU), 12);
      expect(state.speedAUPerDay).toBeCloseTo(vectorLength(state.velocityAUPerDay), 12);
      expect(state.heliocentricLongitudeRad).toBeCloseTo(eclipticLongitudeRad(state.positionAU), 12);
      expect(state.orbitalPeriodDays).toBe(SIDEREAL_ORBITAL_PERIOD_DAYS[
        state.id as keyof typeof SIDEREAL_ORBITAL_PERIOD_DAYS
      ]);
      expect(state.speedAUPerDay).toBeGreaterThan(0);
    }

    const distances = states.map((state) => state.distanceAU);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it('returns the same cached state for the same instant', () => {
    const first = service.getState('mars', J2000);
    const second = service.getState('mars', new Date(J2000.getTime()));
    expect(second).toBe(first);
  });

  it('samples a Mercury trajectory that is not a circle', () => {
    const points = service.sampleTrajectory('mercury', J2000, 64);
    const distances = points.map((point) => vectorLength(point));
    const span = Math.max(...distances) - Math.min(...distances);
    expect(points).toHaveLength(64);
    expect(span).toBeGreaterThan(0.1);
    expect(points[0].x).toBeCloseTo(service.getState('mercury', J2000).positionAU.x, 12);
  });

  it('rejects an invalid date without inventing a position', () => {
    expect(() => service.getState('earth', new Date(Number.NaN))).toThrow(UnsupportedDateError);
  });
});

describe('UTC time', () => {
  it('reads calendar fields as UTC', () => {
    const date = parseUtcInstant('2026-11-01T00:30:15Z');
    expect(date.toISOString()).toBe('2026-11-01T00:30:15.000Z');
  });

  it('rejects dates that are not real or not marked UTC', () => {
    expect(() => parseUtcInstant('2026-02-31T00:00:00Z')).toThrow(UnsupportedDateError);
    expect(() => parseUtcInstant('2026-11-01T00:00:00')).toThrow(UnsupportedDateError);
  });

  it('adds days on the astronomy-engine UT scale', () => {
    const start = parseUtcInstant('2000-01-01T12:00:00Z');
    expect(addUtcDays(start, 1).toISOString()).toBe('2000-01-02T12:00:00.000Z');
    expect(addUtcDays(start, -1.5).toISOString()).toBe('1999-12-31T00:00:00.000Z');
  });
});
