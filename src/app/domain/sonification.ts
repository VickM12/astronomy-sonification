import { PlanetaryState } from './planetary-state';

/**
 * Contract shared by the scientific and musical engines.
 * Milestone 1 defines the contract and does not synthesize sound.
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
