import { Injectable } from '@angular/core';
import { Body, HelioState, Rotation_EQJ_ECL, RotateState } from 'astronomy-engine';
import { PlanetaryState } from '../domain/planetary-state';
import { PLANETS, PlanetId, isPlanetId } from '../domain/planets';
import { ORBITAL_PERIOD_SOURCE, siderealPeriodDays } from './orbital-periods';
import { UnsupportedDateError, addUtcDays, assertUtcInstant } from './time';
import { AuVector, eclipticLongitudeRad, vectorLength } from './vectors';

const BODY_BY_ID: Record<PlanetId, Body> = {
  mercury: Body.Mercury,
  venus: Body.Venus,
  earth: Body.Earth,
  mars: Body.Mars,
  jupiter: Body.Jupiter,
  saturn: Body.Saturn,
  uranus: Body.Uranus,
  neptune: Body.Neptune,
};

/**
 * EQJ → ECL is a fixed rotation (mean obliquity at J2000), so the matrix
 * can be reused. RotateState applies it to position and velocity together.
 */
const ECLIPTIC_FROM_EQUATOR_J2000 = Rotation_EQJ_ECL();

export interface TrajectorySample {
  planetId: PlanetId;
  positionsAU: AuVector[];
}

/**
 * Planetary states from astronomy-engine. This service has no audio or UI code.
 * Coordinates are heliocentric J2000 mean ecliptic, not circular-orbit approximations.
 */
@Injectable({ providedIn: 'root' })
export class AstronomyService {
  static readonly periodSource = ORBITAL_PERIOD_SOURCE;
  private readonly cache = new Map<string, PlanetaryState>();
  private readonly cacheLimit = 4096;

  getStates(time: Date): PlanetaryState[] {
    return PLANETS.map((planet) => this.getState(planet.id, time));
  }

  getState(planetId: PlanetId, time: Date): PlanetaryState {
    assertUtcInstant(time);
    if (!isPlanetId(planetId)) {
      throw new UnsupportedDateError(`Unknown planet "${planetId}".`);
    }

    const key = `${planetId}:${time.getTime()}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    let equatorial;
    try {
      equatorial = HelioState(BODY_BY_ID[planetId], time);
    } catch (error) {
      throw new UnsupportedDateError(messageFrom(error));
    }

    const ecliptic = RotateState(ECLIPTIC_FROM_EQUATOR_J2000, equatorial);
    const positionAU = finiteVector(ecliptic.x, ecliptic.y, ecliptic.z);
    const velocityAUPerDay = finiteVector(ecliptic.vx, ecliptic.vy, ecliptic.vz);
    const state: PlanetaryState = {
      id: planetId,
      name: PLANETS.find((planet) => planet.id === planetId)?.name ?? planetId,
      timestamp: time,
      positionAU,
      velocityAUPerDay,
      distanceAU: vectorLength(positionAU),
      speedAUPerDay: vectorLength(velocityAUPerDay),
      orbitalPeriodDays: siderealPeriodDays(planetId),
      heliocentricLongitudeRad: eclipticLongitudeRad(positionAU),
    };

    this.remember(key, state);
    return state;
  }

  /**
   * Samples one sidereal period of the calculated trajectory starting at `epoch`.
   * The curve is not a Keplerian ellipse fit and is not a circle.
   */
  sampleTrajectory(planetId: PlanetId, epoch: Date, samples: number): AuVector[] {
    if (!Number.isInteger(samples) || samples < 8) {
      throw new Error('A trajectory needs at least 8 samples.');
    }
    const period = siderealPeriodDays(planetId);
    const points: AuVector[] = [];
    for (let index = 0; index < samples; index += 1) {
      const time = addUtcDays(epoch, (period * index) / samples);
      points.push(this.getState(planetId, time).positionAU);
    }
    return points;
  }

  sampleTrajectories(epoch: Date, samples: number): TrajectorySample[] {
    return PLANETS.map((planet) => ({
      planetId: planet.id,
      positionsAU: this.sampleTrajectory(planet.id, epoch, samples),
    }));
  }

  private remember(key: string, state: PlanetaryState): void {
    if (this.cache.size >= this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, state);
  }
}

function finiteVector(x: number, y: number, z: number): AuVector {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new UnsupportedDateError('The ephemeris returned a non-finite coordinate.');
  }
  return { x, y, z };
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return 'Astronomy Engine could not evaluate that date.';
}
