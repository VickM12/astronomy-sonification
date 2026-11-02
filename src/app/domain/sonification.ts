import { PlanetaryState } from './planetary-state';

/**
 * Contract shared by the scientific and musical engines.
 * `durationSeconds` of 0 is a sustained drone. Pulses carry a positive duration.
 * The engines report pitches. The audio session is what schedules them.
 */
export interface SonificationEvent {
  planetId: string;
  simulationTime: Date;
  frequencyHz: number;
  velocity: number;
  durationSeconds: number;
  eventType: 'continuous' | 'pulse' | 'alignment';
}

export interface SonificationEngine {
  process(states: PlanetaryState[], simulationTime: Date): SonificationEvent[];
}
