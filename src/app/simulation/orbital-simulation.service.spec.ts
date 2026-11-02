import { AstronomyService } from '../astronomy/astronomy.service';
import { addUtcDays, daysBetween } from '../astronomy/time';
import {
  MAX_SIMULATED_DAYS_PER_TICK,
  OrbitalSimulationService,
} from './orbital-simulation.service';

const START = new Date('2000-01-01T12:00:00.000Z');

function counts(stepDays: number, steps: number): Record<string, number> {
  const simulation = new OrbitalSimulationService(new AstronomyService());
  simulation.setEpoch(START);
  const tally: Record<string, number> = {};
  for (let index = 0; index < steps; index += 1) {
    for (const event of simulation.advanceDays(stepDays)) {
      if (event.type !== 'reference-meridian') {
        continue;
      }
      tally[event.planetId] = (tally[event.planetId] ?? 0) + 1;
    }
  }
  return tally;
}

describe('OrbitalSimulationService', () => {
  it('seeks without emitting skipped crossings, including a backward seek', () => {
    const astronomy = new AstronomyService();
    const simulation = new OrbitalSimulationService(astronomy);
    expect(simulation.setEpoch(START)).toBe(true);

    simulation.seek(addUtcDays(START, 400));
    expect(simulation.eventLog()).toEqual([]);
    expect(simulation.latestEvents()).toEqual([]);

    const destination = astronomy.getStates(addUtcDays(START, 400));
    expect(simulation.states()[0]?.positionAU.x).toBeCloseTo(destination[0]?.positionAU.x ?? 0, 12);
    expect(simulation.states()[7]?.distanceAU).toBeCloseTo(destination[7]?.distanceAU ?? 0, 12);

    expect(simulation.seek(START)).toBe(true);
    expect(simulation.eventLog()).toEqual([]);
    const home = astronomy.getStates(START);
    expect(simulation.states()[2]?.positionAU.y).toBeCloseTo(home[2]?.positionAU.y ?? 0, 12);
  });

  it('detects a crossing again after seeking backward past it', () => {
    const simulation = new OrbitalSimulationService(new AstronomyService());
    simulation.setEpoch(START);

    let crossingTime: Date | null = null;
    for (let day = 0; day < 120 && crossingTime === null; day += 1) {
      const events = simulation.advanceDays(1);
      const hit = events.find(
        (event) => event.type === 'reference-meridian' && event.planetId === 'mercury',
      );
      if (hit) {
        crossingTime = hit.simulationTime;
      }
    }
    expect(crossingTime).not.toBeNull();

    simulation.seek(addUtcDays(crossingTime ?? START, -1));
    expect(simulation.eventLog()).toEqual([]);
    const again = simulation
      .advanceDays(2)
      .filter((event) => event.type === 'reference-meridian' && event.planetId === 'mercury');
    expect(again).toHaveLength(1);
  });

  it('keeps real meridian counts stable across coarse and fine steps', () => {
    const fine = counts(1, 200);
    expect(counts(10, 20)).toEqual(fine);
    expect(counts(200, 1)).toEqual(fine);
    expect(Object.values(fine).some((count) => count > 0)).toBe(true);
  });

  it('returns to the same state when a step is reversed', () => {
    const simulation = new OrbitalSimulationService(new AstronomyService());
    simulation.setEpoch(START);
    const before = simulation.states().map((state) => state.positionAU.x);
    simulation.advanceDays(12.5);
    simulation.advanceDays(-12.5);
    expect(simulation.simulationTime()?.toISOString()).toBe(START.toISOString());
    simulation.states().forEach((state, index) => {
      expect(state.positionAU.x).toBeCloseTo(before[index] ?? 0, 12);
    });
  });

  it('does not move when the destination date is invalid', () => {
    const simulation = new OrbitalSimulationService(new AstronomyService());
    simulation.setEpoch(START);
    expect(simulation.seek(new Date(Number.NaN))).toBe(false);
    expect(simulation.simulationTime()?.toISOString()).toBe(START.toISOString());
    expect(simulation.error()).toBeTruthy();
  });

  it('produces the same states and events from the same steps', () => {
    const run = (): string => {
      const simulation = new OrbitalSimulationService(new AstronomyService());
      simulation.setEpoch(START);
      simulation.advanceDays(123.456);
      simulation.advanceDays(-40);
      return JSON.stringify({
        time: simulation.simulationTime()?.toISOString(),
        positions: simulation.states().map((state) => [
          state.id,
          state.positionAU,
          state.velocityAUPerDay,
          state.heliocentricLongitudeRad,
        ]),
        events: simulation.eventLog().map((event) => [
          event.type,
          event.planetId,
          event.otherPlanetId ?? '',
          event.simulationTime.toISOString(),
        ]),
      });
    };

    expect(run()).toBe(run());
  });

  it('starts and stops the simulation clock without leaving it running', () => {
    const simulation = new OrbitalSimulationService(new AstronomyService());
    simulation.setEpoch(START);
    simulation.setSpeed(10);
    simulation.play();
    try {
      expect(simulation.playing()).toBe(true);
      const origin = performance.now();
      simulation.tick(origin + 1000);
      expect(simulation.simulationTime()?.getTime()).toBeGreaterThan(START.getTime());
      const pausedAt = simulation.simulationTime()?.getTime();
      simulation.pause();
      expect(simulation.playing()).toBe(false);
      simulation.tick(origin + 5000);
      expect(simulation.simulationTime()?.getTime()).toBe(pausedAt);
    } finally {
      simulation.pause();
    }
  });

  it('caps one clock tick so a long stall cannot skip centuries of events', () => {
    const simulation = new OrbitalSimulationService(new AstronomyService());
    simulation.setEpoch(START);
    simulation.setSpeed(5000);
    simulation.play();
    try {
      const origin = performance.now();
      simulation.tick(origin + 10_000);
      const elapsed = daysBetween(START, simulation.simulationTime() ?? START);
      expect(elapsed).toBeGreaterThan(0);
      expect(elapsed).toBeLessThanOrEqual(MAX_SIMULATED_DAYS_PER_TICK + 1e-6);
    } finally {
      simulation.pause();
    }
  });
});
