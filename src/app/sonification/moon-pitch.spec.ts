import { MOON_IDS, MOON_ORBITAL_PERIOD_DAYS, MoonId } from '../domain/moons';
import { PlanetaryState } from '../domain/planetary-state';
import { readPitches } from './pitch';
import { defaultPitchSettings } from './sound-model';

const WHEN = new Date('2000-01-01T12:00:00.000Z');

function moonState(id: MoonId): PlanetaryState {
  return {
    id,
    name: id,
    timestamp: WHEN,
    positionAU: { x: 0.003, y: 0, z: 0 },
    velocityAUPerDay: { x: 0, y: 0.01, z: 0 },
    distanceAU: 0.003,
    speedAUPerDay: 0.01,
    orbitalPeriodDays: MOON_ORBITAL_PERIOD_DAYS[id],
    heliocentricLongitudeRad: 0,
    frame: 'jovicentric',
  };
}

describe('Galilean moon pitches', () => {
  const states = MOON_IDS.map((id) => moonState(id));

  it('keeps the orbital-period ratios with one shared factor', () => {
    const pitches = readPitches(states, defaultPitchSettings());
    const hz = new Map(pitches.map((pitch) => [pitch.planetId, pitch.audibleFrequencyHz]));
    expect(hz.get('ganymede')).toBeCloseTo(110, 6);
    expect((hz.get('io') ?? 0) / (hz.get('europa') ?? 1)).toBeCloseTo(
      MOON_ORBITAL_PERIOD_DAYS.europa / MOON_ORBITAL_PERIOD_DAYS.io,
      6,
    );
    expect((hz.get('europa') ?? 0) / (hz.get('ganymede') ?? 1)).toBeCloseTo(
      MOON_ORBITAL_PERIOD_DAYS.ganymede / MOON_ORBITAL_PERIOD_DAYS.europa,
      6,
    );
    expect((hz.get('io') ?? 0) - (hz.get('ganymede') ?? 0)).toBeGreaterThan(200);
    expect(pitches.find((pitch) => pitch.planetId === 'io')?.formula).toContain('f_Ganymede');
  });

  it('quantizes the resonance onto octave equivalents instead of one shared note', () => {
    const pitches = readPitches(states, {
      ...defaultPitchSettings(),
      mode: 'musical',
      quantize: true,
    });
    const hz = new Map(pitches.map((pitch) => [pitch.planetId, pitch.audibleFrequencyHz]));
    const ratio = (hz.get('io') ?? 0) / (hz.get('ganymede') ?? 1);
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });
});
