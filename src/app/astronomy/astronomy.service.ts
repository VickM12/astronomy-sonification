import { Injectable } from '@angular/core';
import {
  Body,
  HelioState,
  JupiterMoons,
  Rotation_EQJ_ECL,
  RotateState,
  StateVector,
} from 'astronomy-engine';
import { MOON_IDS, MOONS, MoonId, moonPeriodDays, moonProfile } from '../domain/moons';
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
  planetId: string;
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

  getStates(time: Date, includeMoons = false): PlanetaryState[] {
    const planets = PLANETS.map((planet) => this.getState(planet.id, time));
    return includeMoons ? [...planets, ...this.getMoonStates(time)] : planets;
  }

  /**
   * Galilean moons from Jupiter's center, rotated into the same ecliptic frame
   * as the planets. Distance and longitude are jovicentric, not heliocentric.
   */
  getMoonStates(time: Date): PlanetaryState[] {
    assertUtcInstant(time);
    const cached = MOON_IDS.map((id) => this.cache.get(this.cacheKey(id, time)));
    if (cached.every((state) => state !== undefined)) {
      return cached as PlanetaryState[];
    }

    let info;
    try {
      info = JupiterMoons(time);
    } catch (error) {
      throw new UnsupportedDateError(messageFrom(error));
    }

    const vectors = {
      io: info.io,
      europa: info.europa,
      ganymede: info.ganymede,
      callisto: info.callisto,
    };
    return MOON_IDS.map((id) => {
      const state = this.moonState(id, time, vectors[id]);
      this.remember(this.cacheKey(id, time), state);
      return state;
    });
  }

  getState(planetId: PlanetId, time: Date): PlanetaryState {
    assertUtcInstant(time);
    if (!isPlanetId(planetId)) {
      throw new UnsupportedDateError(`Unknown planet "${planetId}".`);
    }

    const key = this.cacheKey(planetId, time);
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

  /**
   * One sidereal period of each moon, in jovicentric ecliptic coordinates.
   * The view places these points around Jupiter. They are not heliocentric loops.
   */
  sampleMoonTrajectories(epoch: Date, samples: number): TrajectorySample[] {
    if (!Number.isInteger(samples) || samples < 8) {
      throw new Error('A trajectory needs at least 8 samples.');
    }
    return MOONS.map((moon) => {
      const period = moonPeriodDays(moon.id);
      const positionsAU: AuVector[] = [];
      for (let index = 0; index < samples; index += 1) {
        const time = addUtcDays(epoch, (period * index) / samples);
        const match = this.getMoonStates(time).find((state) => state.id === moon.id);
        if (!match) {
          throw new UnsupportedDateError(`Missing moon state for ${moon.id}.`);
        }
        positionsAU.push(match.positionAU);
      }
      return { planetId: moon.id, positionsAU };
    });
  }

  private moonState(
    id: MoonId,
    time: Date,
    equatorial: StateVector,
  ): PlanetaryState {
    const ecliptic = RotateState(ECLIPTIC_FROM_EQUATOR_J2000, equatorial);
    const positionAU = finiteVector(ecliptic.x, ecliptic.y, ecliptic.z);
    const velocityAUPerDay = finiteVector(ecliptic.vx, ecliptic.vy, ecliptic.vz);
    return {
      id,
      name: moonProfile(id)?.name ?? id,
      timestamp: time,
      positionAU,
      velocityAUPerDay,
      distanceAU: vectorLength(positionAU),
      speedAUPerDay: vectorLength(velocityAUPerDay),
      orbitalPeriodDays: moonPeriodDays(id),
      heliocentricLongitudeRad: eclipticLongitudeRad(positionAU),
      frame: 'jovicentric',
    };
  }

  private cacheKey(id: string, time: Date): string {
    return `${id}:${time.getTime()}`;
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
