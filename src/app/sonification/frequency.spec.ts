import { SIDEREAL_ORBITAL_PERIOD_DAYS } from '../astronomy/orbital-periods';
import { PLANET_IDS } from '../domain/planets';
import {
  angularSpeedRadPerDay,
  foldIntoRegister,
  meanMotionRadPerDay,
  orbitalFrequencyHz,
  uniformScale,
  uniformScaleFactor,
  velocityModulatedFrequency,
} from './frequency';

describe('orbital frequency', () => {
  it('uses one cycle per sidereal period, in hertz', () => {
    expect(orbitalFrequencyHz(1)).toBe(1 / 86400);
    expect(orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.earth)).toBeCloseTo(
      1 / (365.256 * 86400),
      12,
    );
  });

  it('keeps period ratios under one shared scale factor', () => {
    const factor = uniformScaleFactor(110);
    const earth = uniformScale(orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.earth), factor);
    const mercury = uniformScale(orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.mercury), factor);
    const neptune = uniformScale(orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.neptune), factor);
    expect(earth).toBeCloseTo(110, 6);
    expect(mercury / earth).toBeCloseTo(
      SIDEREAL_ORBITAL_PERIOD_DAYS.earth / SIDEREAL_ORBITAL_PERIOD_DAYS.mercury,
      8,
    );
    expect(mercury / neptune).toBeCloseTo(
      SIDEREAL_ORBITAL_PERIOD_DAYS.neptune / SIDEREAL_ORBITAL_PERIOD_DAYS.mercury,
      8,
    );
  });

  it('folds every planet into one octave by an exact power of two', () => {
    for (const id of PLANET_IDS) {
      const orbital = orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS[id]);
      const folded = foldIntoRegister(orbital, 110, 220);
      expect(folded.frequencyHz).toBeGreaterThanOrEqual(110);
      expect(folded.frequencyHz).toBeLessThan(220);
      expect(folded.frequencyHz).toBeCloseTo(orbital * 2 ** folded.octaves, 6);
    }
  });

  it('changes the mercury-to-neptune ratio when each planet takes its own octave', () => {
    const mercury = orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.mercury);
    const neptune = orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.neptune);
    const raw = mercury / neptune;
    const folded =
      foldIntoRegister(mercury, 110, 220).frequencyHz /
      foldIntoRegister(neptune, 110, 220).frequencyHz;
    const octaves = Math.round(Math.log2(raw / folded));
    expect(Math.abs(octaves)).toBeGreaterThan(0);
    expect(folded * 2 ** octaves).toBeCloseTo(raw, 5);
  });

  it('modulates pitch from the state-vector angular speed', () => {
    const angular = angularSpeedRadPerDay({ x: 1, y: 0, z: 0 }, { x: 0, y: 2, z: 0 });
    expect(angular).toBeCloseTo(2, 8);
    expect(meanMotionRadPerDay(Math.PI)).toBeCloseTo(2, 8);
    expect(velocityModulatedFrequency(100, angular, 1, 0)).toBe(100);
    expect(velocityModulatedFrequency(100, angular, 1, 1)).toBeCloseTo(200, 8);
    expect(velocityModulatedFrequency(100, angular, 1, 0.5)).toBeCloseTo(150, 8);
  });
});
