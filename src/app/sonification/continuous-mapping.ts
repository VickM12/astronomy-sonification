import { ORBITAL_ELEMENTS } from '../astronomy/orbital-elements';
import { PlanetaryState } from '../domain/planetary-state';
import { isPlanetId } from '../domain/planets';
import { angularSpeedRadPerDay, meanMotionRadPerDay } from './frequency';

export interface ContinuousParameters {
  id: string;
  frequencyMultiplier: number;
  filterHz: number;
  pan: number;
  resonance: number;
  gainMultiplier: number;
  angularRatio: number;
  detuneCents: number;
}

/** Creative, bounded mappings derived only from the supplied astronomical state. */
export function continuousParameters(
  states: readonly PlanetaryState[],
  soundingIds: ReadonlySet<string>,
  motionDepth: number,
  relationshipAmount: number,
): ContinuousParameters[] {
  const sounding = states.filter((state) => soundingIds.has(state.id));
  const planets = sounding.filter((state) => isPlanetId(state.id));
  const relation = clamp01(relationshipAmount);
  const conjunction = closestConjunction(planets);
  const crescendo = 1 + 0.35 * relation * conjunction;
  const mercury = planets.find((state) => state.id === 'mercury');
  const venusGain = mercury ? 1 + 0.15 * relation * Math.sin(mercury.heliocentricLongitudeRad) : 1;
  const jupiter = planets.find((state) => state.id === 'jupiter');
  const saturn = planets.find((state) => state.id === 'saturn');
  const jupiterSaturn =
    jupiter && saturn
      ? 0.5 +
        0.5 *
          Math.cos(shortAngle(jupiter.heliocentricLongitudeRad - saturn.heliocentricLongitudeRad))
      : 0;
  const earth = planets.find((state) => state.id === 'earth');
  const mars = planets.find((state) => state.id === 'mars');
  const earthMars = earth && mars ? earthMarsCloseness(earth, mars) : 0;

  return sounding.map((state, index) => {
    const elements = isPlanetId(state.id) ? ORBITAL_ELEMENTS[state.id] : null;
    const angular = angularSpeedRadPerDay(state.positionAU, state.velocityAUPerDay);
    const mean = meanMotionRadPerDay(state.orbitalPeriodDays);
    const angularRatio = mean > 0 ? angular / mean : 1;
    const eccentricityScale = elements
      ? 0.15 + 0.85 * (elements.eccentricity / ORBITAL_ELEMENTS.mercury.eccentricity)
      : 0.15;
    const depth = clamp01(motionDepth) * eccentricityScale;
    const angularMultiplier = clamp(1 + depth * (angularRatio - 1), 0.5, 2);
    const detuneCents = relativeDetune(state, planets, index, relation);
    const proximity = elements ? solarProximity(state.distanceAU, elements) : 0.5;
    let resonance = 0.7;
    if (state.id === 'jupiter' || state.id === 'saturn') {
      resonance += 3 * relation * jupiterSaturn;
    }
    if (state.id === 'earth' || state.id === 'mars') {
      resonance += 4 * relation * earthMars;
    }
    return {
      id: state.id,
      frequencyMultiplier: angularMultiplier * 2 ** (detuneCents / 1200),
      filterHz: 500 + 6500 * proximity,
      pan: clamp(Math.sin(state.heliocentricLongitudeRad), -1, 1),
      resonance: clamp(resonance, 0, 8),
      gainMultiplier: crescendo * (state.id === 'venus' ? venusGain : 1),
      angularRatio,
      detuneCents,
    };
  });
}

export function solarProximity(
  distanceAU: number,
  elements: { semiMajorAxisAU: number; eccentricity: number },
): number {
  const perihelion = elements.semiMajorAxisAU * (1 - elements.eccentricity);
  const aphelion = elements.semiMajorAxisAU * (1 + elements.eccentricity);
  return clamp01((aphelion - distanceAU) / Math.max(1e-9, aphelion - perihelion));
}

export function conjunctionCloseness(angleRad: number): number {
  const threshold = Math.PI / 12;
  const linear = 1 - Math.abs(shortAngle(angleRad)) / threshold;
  const value = clamp01(linear);
  return value * value * (3 - 2 * value);
}

function closestConjunction(states: readonly PlanetaryState[]): number {
  let closest = 0;
  for (let left = 0; left < states.length; left += 1) {
    for (let right = left + 1; right < states.length; right += 1) {
      closest = Math.max(
        closest,
        conjunctionCloseness(
          (states[left]?.heliocentricLongitudeRad ?? 0) -
            (states[right]?.heliocentricLongitudeRad ?? 0),
        ),
      );
    }
  }
  return closest;
}

function relativeDetune(
  state: PlanetaryState,
  planets: readonly PlanetaryState[],
  index: number,
  amount: number,
): number {
  if (!isPlanetId(state.id) || planets.length < 2) {
    return 0;
  }
  const interaction = planets
    .filter((other) => other.id !== state.id)
    .reduce(
      (sum, other) =>
        sum + Math.cos(shortAngle(state.heliocentricLongitudeRad - other.heliocentricLongitudeRad)),
      0,
    );
  const sign = index % 2 === 0 ? 1 : -1;
  return clamp(sign * 6 * amount * (interaction / (planets.length - 1)), -6, 6);
}

function earthMarsCloseness(earth: PlanetaryState, mars: PlanetaryState): number {
  const dx = earth.positionAU.x - mars.positionAU.x;
  const dy = earth.positionAU.y - mars.positionAU.y;
  const dz = earth.positionAU.z - mars.positionAU.z;
  const distance = Math.hypot(dx, dy, dz);
  const minimum = ORBITAL_ELEMENTS.mars.semiMajorAxisAU - ORBITAL_ELEMENTS.earth.semiMajorAxisAU;
  const maximum = ORBITAL_ELEMENTS.mars.semiMajorAxisAU + ORBITAL_ELEMENTS.earth.semiMajorAxisAU;
  return clamp01((maximum - distance) / (maximum - minimum));
}

function shortAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));
}
