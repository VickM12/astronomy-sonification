import { SIDEREAL_ORBITAL_PERIOD_DAYS } from '../astronomy/orbital-periods';

const SECONDS_PER_DAY = 86400;

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface FoldedFrequency {
  frequencyHz: number;
  octaves: number;
}

/** Sidereal orbital frequency in hertz: 1 / (P × 86400). */
export function orbitalFrequencyHz(periodDays: number): number {
  if (!(periodDays > 0)) {
    throw new Error('Orbital period must be positive.');
  }
  return 1 / (periodDays * SECONDS_PER_DAY);
}

/**
 * One constant K for every planet. Earth is placed at `targetEarthHz`
 * and every other planet keeps the sidereal period ratio.
 */
export function uniformScaleFactor(targetEarthHz = 110): number {
  return targetEarthHz / orbitalFrequencyHz(SIDEREAL_ORBITAL_PERIOD_DAYS.earth);
}

export function uniformScale(orbitalHz: number, scaleFactor: number): number {
  return orbitalHz * scaleFactor;
}

/**
 * Move `frequencyHz` by whole octaves until it sits in `[lowHz, highHz)`.
 * The returned frequency is exactly `frequencyHz × 2^octaves`.
 */
export function foldIntoRegister(
  frequencyHz: number,
  lowHz: number,
  highHz: number,
): FoldedFrequency {
  if (!(frequencyHz > 0) || !(lowHz > 0) || !(highHz > lowHz)) {
    throw new Error('Octave folding needs a positive frequency and a register above it.');
  }
  let octaves = Math.ceil(Math.log2(lowHz / frequencyHz) - 1e-12);
  let folded = frequencyHz * 2 ** octaves;
  if (folded >= highHz) {
    octaves -= 1;
    folded = frequencyHz * 2 ** octaves;
  }
  if (folded < lowHz) {
    octaves += 1;
    folded = frequencyHz * 2 ** octaves;
  }
  return { frequencyHz: folded, octaves };
}

/** Instantaneous angular speed in radians per day: |r × v| / |r|². */
export function angularSpeedRadPerDay(position: Vector3, velocity: Vector3): number {
  const radiusSquared = position.x ** 2 + position.y ** 2 + position.z ** 2;
  if (radiusSquared === 0) {
    return 0;
  }
  const crossX = position.y * velocity.z - position.z * velocity.y;
  const crossY = position.z * velocity.x - position.x * velocity.z;
  const crossZ = position.x * velocity.y - position.y * velocity.x;
  return Math.hypot(crossX, crossY, crossZ) / radiusSquared;
}

export function meanMotionRadPerDay(periodDays: number): number {
  if (!(periodDays > 0)) {
    throw new Error('Orbital period must be positive.');
  }
  return (2 * Math.PI) / periodDays;
}

/**
 * f = f_base × (1 + depth × (ω / ω_mean − 1)).
 * Depth 0 leaves the pitch fixed. Depth 1 follows the angular-speed ratio.
 */
export function velocityModulatedFrequency(
  baseHz: number,
  angularSpeed: number,
  meanMotion: number,
  depth: number,
): number {
  if (!(meanMotion > 0) || depth === 0) {
    return baseHz;
  }
  const ratio = angularSpeed / meanMotion;
  return baseHz * (1 + depth * (ratio - 1));
}

export function formatHz(hz: number): string {
  if (!Number.isFinite(hz)) {
    return '—';
  }
  if (hz >= 100) {
    return `${hz.toFixed(1)} Hz`;
  }
  if (hz >= 10) {
    return `${hz.toFixed(2)} Hz`;
  }
  if (hz >= 1) {
    return `${hz.toFixed(3)} Hz`;
  }
  return `${hz.toExponential(2)} Hz`;
}
